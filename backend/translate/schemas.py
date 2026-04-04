"""
translate/schemas.py — 반려동물 번역 모듈 Pydantic 스키마
"""

from typing import Literal

from pydantic import BaseModel, Field


# ── 요청 ──────────────────────────────────────────────────────

class PetToHumanRequest(BaseModel):
    audio_base64: str = Field(..., description="m4a 오디오를 base64로 인코딩한 문자열")
    pet_type: Literal["cat", "dog", "other"] = Field(..., description="반려동물 종류")
    pet_name: str = Field(..., min_length=1, max_length=50, description="반려동물 이름")


class HumanToPetRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500, description="한국어 텍스트 입력")
    pet_type: Literal["cat", "dog", "other"] = Field(..., description="반려동물 종류")


# ── 응답 ──────────────────────────────────────────────────────

class PetToHumanResponse(BaseModel):
    translated_text: str = Field(..., description="번역된 자연어 텍스트")
    emotion: str = Field(..., description="감정 레이블 (한국어), 예: 기쁨")
    pet_sound_key: str = Field(..., description="프론트엔드 로컬 오디오 키, 예: cat_happy")
    processing_time_ms: int = Field(..., description="처리 소요 시간 (밀리초)")


class HumanToPetResponse(BaseModel):
    emotion_label: str = Field(..., description="감정 레이블 (한국어), 예: 기쁨")
    pet_sound_key: str = Field(..., description="프론트엔드 로컬 오디오 키, 예: cat_happy")
    processing_time_ms: int = Field(..., description="처리 소요 시간 (밀리초)")


# ── 내부 유틸 ─────────────────────────────────────────────────

class AudioQualityResult(BaseModel):
    passed: bool
    snr_db: float
    reason: str = Field(default="", description="실패 시 한국어 원인 설명")
