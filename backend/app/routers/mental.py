"""
mental.py — 정신 건강 모듈 라우터
prefix: /api/v1/mental (main.py에서 등록)

엔드포인트:
  GET  /mental/profile/{pet_id}   — 정신 건강 프로필 조회
  POST /mental/interaction         — 상호작용 로그 기록
  POST /mental/diary/generate      — AI 일기 생성
  GET  /mental/diary/{pet_id}      — 일기 목록 조회
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from app.schemas.mental_schemas import (
    DiaryGenerateRequest,
    DiaryOut,
    InteractionCreate,
    InteractionOut,
    MentalProfileOut,
)
from app.schemas.response import APIResponse
from app.services import mental_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/profile/{pet_id}", response_model=APIResponse[MentalProfileOut])
async def get_mental_profile(pet_id: str):
    try:
        profile = await mental_service.get_profile(pet_id)
        return APIResponse.ok(MentalProfileOut.model_validate(profile))
    except Exception as exc:
        logger.exception("[mental] 프로필 조회 실패")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/interaction", response_model=APIResponse[InteractionOut])
async def log_interaction(body: InteractionCreate):
    try:
        log, _profile = await mental_service.log_interaction(body)
        return APIResponse.ok(InteractionOut.model_validate(log))
    except Exception as exc:
        logger.exception("[mental] 상호작용 로그 실패")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/diary/generate", response_model=APIResponse[DiaryOut])
async def generate_diary(body: DiaryGenerateRequest):
    try:
        diary = await mental_service.generate_diary(body)
        return APIResponse.ok(DiaryOut.model_validate(diary))
    except Exception as exc:
        logger.exception("[mental] 일기 생성 실패")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/diary/{pet_id}", response_model=APIResponse[list[DiaryOut]])
async def list_diaries(
    pet_id: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    try:
        diaries = await mental_service.list_diaries(pet_id, limit=limit)
        return APIResponse.ok([DiaryOut.model_validate(d) for d in diaries])
    except Exception as exc:
        logger.exception("[mental] 일기 목록 조회 실패")
        raise HTTPException(status_code=500, detail=str(exc))
