"""
translate/audio_utils.py — 오디오 처리 유틸리티

함수:
  decode_base64_audio(audio_base64, output_path) -> bool
  check_audio_quality(file_path) -> AudioQualityResult
"""

import base64
import logging

from translate.schemas import AudioQualityResult

logger = logging.getLogger(__name__)

# ── 품질 기준 ──────────────────────────────────────────────────
MIN_DURATION_SEC = 0.5
MIN_SNR_DB = 10.0


def decode_base64_audio(audio_base64: str, output_path: str) -> bool:
    """
    base64 문자열을 디코딩해 파일로 저장.
    성공 시 True, 실패 시 False 반환.
    """
    try:
        # 데이터 URI 프리픽스 제거 (data:audio/m4a;base64,...)
        if "," in audio_base64:
            audio_base64 = audio_base64.split(",", 1)[1]

        audio_bytes = base64.b64decode(audio_base64)
        with open(output_path, "wb") as f:
            f.write(audio_bytes)
        return True
    except Exception as exc:
        logger.warning("[audio_utils] base64 디코딩 실패: %s", exc)
        return False


def check_audio_quality(file_path: str) -> AudioQualityResult:
    """
    librosa로 오디오를 로드해 다음을 검사:
      1. 시간 길이 >= MIN_DURATION_SEC
      2. 추정 SNR >= MIN_SNR_DB

    SNR 추정: 전체 신호 RMS / 가장 조용한 구간의 RMS 비율을 dB로 환산.
    librosa 로드 실패 시 passed=True로 통과 처리 (오탐 최소화).
    """
    try:
        import numpy as np
        import librosa

        y, sr = librosa.load(file_path, sr=None, mono=True)

        # ── 1. 시간 길이 검사 ──────────────────────────────────
        duration = len(y) / sr
        if duration < MIN_DURATION_SEC:
            return AudioQualityResult(
                passed=False,
                snr_db=0.0,
                reason="너무 짧아요. 0.5초 이상 녹음해주세요.",
            )

        # ── 2. SNR 추정 ────────────────────────────────────────
        # 20ms 프레임으로 분할해 RMS 계산
        frame_length = int(sr * 0.02)   # 20ms
        hop_length = frame_length // 2  # 50% 겹침

        rms_frames = librosa.feature.rms(
            y=y, frame_length=frame_length, hop_length=hop_length
        )[0]

        if len(rms_frames) == 0:
            return AudioQualityResult(passed=True, snr_db=99.0)

        signal_rms = float(np.percentile(rms_frames, 90))   # 상위 10% → 신호
        noise_rms = float(np.percentile(rms_frames, 10))    # 하위 10% → 노이즈

        if noise_rms < 1e-9:
            snr_db = 99.0
        else:
            ratio = signal_rms / noise_rms
            snr_db = float(20.0 * np.log10(ratio)) if ratio > 0 else 0.0

        if snr_db < MIN_SNR_DB:
            return AudioQualityResult(
                passed=False,
                snr_db=round(snr_db, 1),
                reason="녹음 환경이 너무 시끄러워요. 조용한 곳에서 다시 시도해주세요.",
            )

        return AudioQualityResult(passed=True, snr_db=round(snr_db, 1))

    except ImportError:
        logger.warning("[audio_utils] librosa 미설치 → 품질 검사 건너뜀")
        return AudioQualityResult(passed=True, snr_db=99.0)
    except Exception as exc:
        logger.warning("[audio_utils] 오디오 품질 검사 실패 (통과 처리): %s", exc)
        return AudioQualityResult(passed=True, snr_db=99.0)
