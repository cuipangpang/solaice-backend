"""
translate/service.py — 반려동물 번역 비즈니스 로직

[A] pet_to_human(req) — 오디오 → librosa 특징 추출 → qwen-max 감정 분류 → qwen-max 번역
[B] human_to_pet(req) — 텍스트 → 감정 분류 → pet_sound_key 매핑
"""

import base64 as _b64
import logging
import os
import time
import uuid

import httpx
import librosa
import numpy as np

from translate.audio_utils import check_audio_quality, decode_base64_audio
from translate.schemas import (
    AudioQualityResult,
    HumanToPetRequest,
    HumanToPetResponse,
    PetToHumanRequest,
    PetToHumanResponse,
)

logger = logging.getLogger(__name__)

# ── Qwen API 설정 ─────────────────────────────────────────────
QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_TEXT_MODEL = "qwen-max"

# ── 감정 매핑 테이블 ──────────────────────────────────────────
PET_EMOTION_TO_KEY: dict[str, str] = {
    "기쁨": "happy",
    "사랑": "love",
    "불안": "anxious",
    "화남": "angry",
    "슬픔": "sad",
    "호기심": "curious",
    "배고픔": "hungry",
    "졸림": "sleepy",
}

HUMAN_EMOTION_TO_KEY: dict[str, str] = {
    "사랑":    "love",         # 사랑해, 보고 싶어
    "애정":    "affectionate", # 예뻐, 잘 생겼다
    "안아줄게": "cuddle",       # 안아줄게, 꼭 안아
    "아가야":  "baby",          # 아기야, 우리 아가
    "안녕":    "hello",         # 안녕, 왔어, 잘 잤어?
    "놀자":    "playful",       # 놀자, 같이 놀까
    "사냥놀이": "prey",          # 잡아봐, 사냥 놀이
    "밥줄게":  "feeding",       # 밥 먹자, 간식 줄게
    "이리와":  "come",          # 이리와, 어서 와
    "잘자":    "sleep",         # 잘 자, 자야지
    "안돼":    "no",            # 안 돼, 하지 마
    "그만해":  "stop",          # 그만해, 멈춰
    "혼날거야": "scold",         # 혼날 거야, 왜 그랬어
    "미안해":  "sorry",         # 미안해, 잘못했어
    "진정해":  "relax",         # 진정해, 괜찮아
    "뭐해":    "curious",       # 뭐해?, 거기서 뭐 해
}

PET_TYPE_KO: dict[str, str] = {
    "cat": "고양이",
    "dog": "강아지",
    "other": "반려동물",
}


# ── 내부 Qwen 호출 헬퍼 ───────────────────────────────────────

async def _call_qwen_text(system_prompt: str, user_prompt: str) -> str:
    """
    Qwen 텍스트 모델 단일 호출.
    실패 시 빈 문자열 반환.
    """
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                QWEN_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {QWEN_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": QWEN_TEXT_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 100,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("[translate] Qwen 텍스트 호출 실패: %s", exc)
        return ""


def _normalize_emotion(raw: str, mapping: dict[str, str], default: str = "기쁨") -> str:
    """
    API 응답에서 감정 레이블을 정규화.
    매핑 테이블의 키 중 하나가 포함되어 있으면 그 키 반환.
    없으면 default 반환.
    """
    raw = raw.strip()
    if raw in mapping:
        return raw
    for key in mapping:
        if key in raw:
            return key
    return default


# ── [A] pet_to_human ──────────────────────────────────────────

async def pet_to_human(req: PetToHumanRequest) -> PetToHumanResponse:
    """
    단계:
      1. base64 → 임시 파일 저장
      2. 음질 검사 (librosa)
      3. librosa 음성 특징 추출 (RMS, F0, f0_std, duration, ZCR)
      4. 특징 → qwen-max 감정 분류
      5. 감정 → qwen-max 자연어 번역
      6. 감정 → pet_sound_key 매핑
      7. 임시 파일 정리
    """
    start_ms = int(time.time() * 1000)
    tmp_path = f"/tmp/solaice_audio_{uuid.uuid4().hex}.m4a"
    pet_type_ko = PET_TYPE_KO.get(req.pet_type, "반려동물")

    # ── 1. 디코딩 ─────────────────────────────────────────────
    if not decode_base64_audio(req.audio_base64, tmp_path):
        raise ValueError("오디오 파일을 읽을 수 없어요.")

    emotion = "기쁨"
    translated_text = ""

    try:
        # ── 2. 음질 검사 ──────────────────────────────────────
        quality: AudioQualityResult = check_audio_quality(tmp_path)
        if not quality.passed:
            raise ValueError(quality.reason)

        # ── 3. librosa 음성 특징 추출 ─────────────────────────
        y, sr = librosa.load(tmp_path, sr=None)
        rms = float(np.mean(librosa.feature.rms(y=y)))
        duration = librosa.get_duration(y=y, sr=sr)
        zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
        f0, voiced, _ = librosa.pyin(y, fmin=50, fmax=2000)
        mean_f0 = float(np.nanmean(f0)) if np.any(voiced) else 0.0
        f0_std = float(np.nanstd(f0)) if np.any(voiced) else 0.0

        # ── 4. 감정 분류 (qwen-max) ───────────────────────────
        audio_feature_prompt = (
            f"반려동물 소리 분석 결과:\n"
            f"- 음량(RMS): {rms:.4f} (0.08 이상=큰소리, 0.02 이하=작은소리)\n"
            f"- 음조(F0): {mean_f0:.1f}Hz (600 이상=높은음, 300 이하=낮은음)\n"
            f"- 음조변화: {f0_std:.1f} (80 이상=불안정)\n"
            f"- 길이: {duration:.1f}초\n"
            f"- 과제로율: {zcr:.3f} (0.15 이상=짧고빠름)\n\n"
            f"위 특징을 바탕으로 {pet_type_ko}({req.pet_name})의 감정을 "
            f"아래 중 하나만 선택하세요:\n"
            f"기쁨 / 사랑 / 불안 / 화남 / 슬픔 / 호기심 / 배고픔 / 졸림\n"
            f"반드시 한 단어만 출력하세요."
        )

        raw_emotion = await _call_qwen_text(
            "당신은 반려동물 행동 전문가입니다.",
            audio_feature_prompt,
        )

        if not raw_emotion:
            logger.warning("[translate] 감정 분류 실패 → 기본 감정 사용")
            emotion = "기쁨"
        else:
            emotion = _normalize_emotion(raw_emotion, PET_EMOTION_TO_KEY, default="기쁨")

        # ── 5. 자연어 번역 생성 (qwen-max) ───────────────────
        translate_system = (
            "당신은 반려동물의 감정을 인간의 말로 전달해 주는 통역사입니다. "
            "짧고 자연스러운 한국어 한 문장으로 말해주세요."
        )
        translate_user = (
            f"{req.pet_name}(이)가 방금 소리를 냈습니다. 감정은 \"{emotion}\"입니다.\n"
            f"{req.pet_name}의 입장에서 한 문장으로 말해주세요. 반드시 짧고 자연스럽게.\n"
            "예시: \"나 배고파요, 밥 주세요!\" / \"같이 놀아요!\"\n"
            "한국어로만 출력하세요."
        )

        translated_text = await _call_qwen_text(translate_system, translate_user)
        if not translated_text:
            logger.warning("[translate] 번역 생성 실패 → 기본 응답 사용")
            translated_text = f"{req.pet_name}(이)가 무언가를 말하고 싶은 것 같아요."

    except ValueError:
        raise
    except Exception as exc:
        logger.error("[translate] pet_to_human 처리 중 예외: %s", exc)
        translated_text = f"{req.pet_name}(이)가 무언가를 말하고 싶은 것 같아요."
    finally:
        # ── 7. 임시 파일 정리 ─────────────────────────────────
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    # ── 6. pet_sound_key 매핑 ─────────────────────────────────
    pet_sound_key = f"{req.pet_type}_{PET_EMOTION_TO_KEY.get(emotion, 'happy')}"

    elapsed_ms = int(time.time() * 1000) - start_ms

    return PetToHumanResponse(
        translated_text=translated_text,
        emotion=emotion,
        pet_sound_key=pet_sound_key,
        processing_time_ms=elapsed_ms,
    )


# ── [B] human_to_pet ─────────────────────────────────────────

async def human_to_pet(req: HumanToPetRequest) -> HumanToPetResponse:
    """
    단계:
      1. Qwen 텍스트 감정 분류
      2. 감정 → pet_sound_key 매핑
      3. 반환 (프론트엔드가 로컬 오디오 재생)
    """
    start_ms = int(time.time() * 1000)

    # ── 1. 감정 분류 ──────────────────────────────────────────
    classify_system = "당신은 반려동물에게 전하는 말의 의도를 분류하는 전문가입니다. 반드시 한 단어만 출력하세요."
    classify_user = (
        "아래 문장이 반려동물에게 전하는 말의 의도를 다음 목록에서 가장 가까운 것 하나만 선택하세요:\n"
        "사랑 / 애정 / 안아줄게 / 아가야 / 안녕 / 놀자 / 사냥놀이 / 밥줄게 / 이리와 / 잘자 / 안돼 / 그만해 / 혼날거야 / 미안해 / 진정해 / 뭐해\n\n"
        "예시:\n"
        "\"사랑해\" → 사랑\n"
        "\"밥 먹자\" → 밥줄게\n"
        "\"하지 마\" → 안돼\n"
        "\"잘 자\" → 잘자\n"
        "\"같이 놀자\" → 놀자\n\n"
        f"문장: \"{req.text}\"\n"
        "반드시 목록 중 한 단어만 출력하세요."
    )

    raw_emotion = await _call_qwen_text(classify_system, classify_user)

    if not raw_emotion:
        raise ValueError("번역에 실패했어요. 잠시 후 다시 시도해주세요.")

    emotion = _normalize_emotion(raw_emotion, HUMAN_EMOTION_TO_KEY, default="기쁨")

    # ── 2. pet_sound_key 매핑 ─────────────────────────────────
    sound_suffix = HUMAN_EMOTION_TO_KEY.get(emotion, "happy")
    pet_sound_key = f"{req.pet_type}_{sound_suffix}"

    elapsed_ms = int(time.time() * 1000) - start_ms

    return HumanToPetResponse(
        emotion_label=emotion,
        pet_sound_key=pet_sound_key,
        processing_time_ms=elapsed_ms,
    )
