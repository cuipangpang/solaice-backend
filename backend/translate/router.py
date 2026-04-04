"""
translate/router.py — 반려동물 번역 API 라우터

prefix: /api/v1/translate (main.py에서 등록)

엔드포인트:
  POST /translate/pet-to-human   — 오디오 → 자연어 번역
  POST /translate/human-to-pet   — 텍스트 → 반려동물 감정 키
"""

import logging
import os
import uuid

import speech_recognition as sr
from fastapi import APIRouter, Body, HTTPException
from pydub import AudioSegment

from translate.audio_utils import check_audio_quality, decode_base64_audio
from translate.schemas import (
    HumanToPetRequest,
    HumanToPetResponse,
    PetToHumanRequest,
    PetToHumanResponse,
)
from translate import service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/pet-to-human", response_model=PetToHumanResponse)
async def pet_to_human(req: PetToHumanRequest):
    """
    반려동물 울음소리(m4a base64) → 자연어 번역 + 감정 분류.

    오류:
      422 — 음질 불량 (너무 짧음 / 노이즈 과다)
      500 — API 호출 실패
    """
    try:
        return await service.pet_to_human(req)
    except ValueError as exc:
        # 음질 검사 실패, base64 오류 등 예측 가능한 오류 → 422
        logger.info("[translate] pet_to_human 검증 실패: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("[translate] pet_to_human 처리 중 오류")
        raise HTTPException(
            status_code=500,
            detail="번역에 실패했어요. 잠시 후 다시 시도해주세요.",
        )


@router.post("/transcribe")
async def transcribe_audio(
    audio_base64: str = Body(...),
    language: str = Body(default="ko"),
):
    """
    반려동물 주인의 음성(m4a/m4a base64) → 한국어 텍스트 (ASR).
    pydub으로 WAV 변환 후 Google Web Speech API 사용.
    """
    hex_id = uuid.uuid4().hex
    tmp_m4a = f"/tmp/solaice_asr_{hex_id}.m4a"
    tmp_wav = f"/tmp/solaice_asr_{hex_id}.wav"

    if not decode_base64_audio(audio_base64, tmp_m4a):
        raise HTTPException(status_code=422, detail="오디오 파일을 읽을 수 없어요.")

    try:
        quality = check_audio_quality(tmp_m4a)
        if not quality.passed:
            raise HTTPException(status_code=422, detail=quality.reason)

        # m4a → wav (ffmpeg 필요, Dockerfile에 설치돼 있음)
        audio = AudioSegment.from_file(tmp_m4a)
        audio.export(tmp_wav, format="wav")

        # Google Web Speech API로 STT
        recognizer = sr.Recognizer()
        with sr.AudioFile(tmp_wav) as source:
            audio_data = recognizer.record(source)

        text = recognizer.recognize_google(audio_data, language="ko-KR")
        return {"text": text, "language": language}

    except sr.UnknownValueError:
        # 음성을 인식할 수 없는 경우 — 빈 텍스트 반환 (에러 아님)
        return {"text": "", "language": language}
    except sr.RequestError as exc:
        logger.warning("[translate] Google STT 요청 실패: %s", exc)
        raise HTTPException(status_code=503, detail="음성 인식 서비스에 접근할 수 없어요.")
    except HTTPException:
        raise
    except Exception:
        logger.exception("[translate] transcribe 처리 중 오류")
        raise HTTPException(status_code=500, detail="음성 인식에 실패했어요. 다시 시도해주세요.")
    finally:
        for path in (tmp_m4a, tmp_wav):
            try:
                os.remove(path)
            except OSError:
                pass


@router.post("/human-to-pet", response_model=HumanToPetResponse)
async def human_to_pet(req: HumanToPetRequest):
    """
    한국어 텍스트 → 반려동물 감정 레이블 + pet_sound_key.

    오류:
      500 — API 호출 실패
    """
    try:
        return await service.human_to_pet(req)
    except ValueError as exc:
        logger.info("[translate] human_to_pet 검증 실패: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("[translate] human_to_pet 처리 중 오류")
        raise HTTPException(
            status_code=500,
            detail="번역에 실패했어요. 잠시 후 다시 시도해주세요.",
        )
