"""
mental_service.py — 정신 건강 모듈 비즈니스 로직

XP / 친밀도 계산 규칙:
  기본값 (interaction_type별):
    feeding   → xp=10, intimacy=1.0
    playing   → xp=15, intimacy=2.0
    grooming  → xp=10, intimacy=1.5
    cuddling  → xp=20, intimacy=3.0
    training  → xp=25, intimacy=1.5
    walking   → xp=20, intimacy=2.5
    game      → xp=30, intimacy=4.0

  intensity 배율: low=0.5x, medium=1.0x, high=1.5x
  duration 배율: <60s=0.5x, 60-300s=1.0x, >300s=1.5x
  game_score 보너스: score//10 * 2 XP 추가
"""

import logging
import os
from datetime import datetime, timezone, date as _date

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.mental_models import (
    IntimacyRecord,
    InteractionLog,
    PetDiary,
    PetMentalProfile,
)
from app.schemas.mental_schemas import DiaryGenerateRequest, InteractionCreate

logger = logging.getLogger(__name__)

_QWEN_API_KEY = os.getenv("QWEN_API_KEY", "")
_QWEN_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"

# ─── XP / 친밀도 기본값 ─────────────────────────────────────────
_BASE = {
    "feeding":  (10, 1.0),
    "playing":  (15, 2.0),
    "grooming": (10, 1.5),
    "cuddling": (20, 3.0),
    "training": (25, 1.5),
    "walking":  (20, 2.5),
    "game":     (30, 4.0),
}
_INTENSITY = {"low": 0.5, "medium": 1.0, "high": 1.5}
_MOOD_MAP = {
    (0,   30):  "anxious",
    (30,  50):  "bored",
    (50,  70):  "calm",
    (70,  90):  "happy",
    (90,  101): "excited",
}


def _compute_reward(data: InteractionCreate) -> tuple[int, float]:
    base_xp, base_int = _BASE.get(data.interaction_type, (5, 0.5))
    intensity_mul = _INTENSITY.get(data.intensity, 1.0)

    dur = data.duration_seconds or 0
    if dur < 60:
        dur_mul = 0.5
    elif dur <= 300:
        dur_mul = 1.0
    else:
        dur_mul = 1.5

    xp = int(base_xp * intensity_mul * dur_mul)
    if data.game_score:
        xp += (data.game_score // 10) * 2
    intimacy = round(base_int * intensity_mul * dur_mul, 2)
    return xp, intimacy


def _infer_mood(intimacy: float) -> str:
    for (lo, hi), mood in _MOOD_MAP.items():
        if lo <= intimacy < hi:
            return mood
    return "calm"


# ─── DB 헬퍼 ────────────────────────────────────────────────────

async def _get_or_create_profile(db: AsyncSession, pet_id: str) -> PetMentalProfile:
    result = await db.execute(
        select(PetMentalProfile).where(PetMentalProfile.pet_id == pet_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = PetMentalProfile(pet_id=pet_id)
        db.add(profile)
        await db.flush()
    return profile


# ─── 공개 API ───────────────────────────────────────────────────

async def get_profile(pet_id: str) -> PetMentalProfile:
    async with AsyncSessionLocal() as db:
        return await _get_or_create_profile(db, pet_id)


async def log_interaction(data: InteractionCreate) -> tuple[InteractionLog, PetMentalProfile]:
    xp, intimacy_delta = _compute_reward(data)

    async with AsyncSessionLocal() as db:
        async with db.begin():
            profile = await _get_or_create_profile(db, data.pet_id)

            # 친밀도 상한 100
            new_intimacy = min(100.0, profile.intimacy_score + intimacy_delta)
            new_mhs = min(100.0, profile.mental_health_score + intimacy_delta * 0.5)

            profile.intimacy_score      = new_intimacy
            profile.mental_health_score = new_mhs
            profile.mood_today          = _infer_mood(new_intimacy)
            profile.total_interactions  += 1
            if data.interaction_type == "game":
                profile.games_played += 1
            profile.last_interaction_at = datetime.now(timezone.utc)

            log = InteractionLog(
                pet_id           = data.pet_id,
                profile_id       = profile.id,
                interaction_type = data.interaction_type,
                game_key         = data.game_key,
                duration_seconds = data.duration_seconds,
                intensity        = data.intensity,
                notes            = data.notes,
                xp_gained        = xp,
                intimacy_gained  = intimacy_delta,
            )
            db.add(log)

            intimacy_rec = IntimacyRecord(
                pet_id      = data.pet_id,
                delta       = intimacy_delta,
                reason      = f"{data.interaction_type}:{data.game_key or 'none'}",
                total_after = new_intimacy,
            )
            db.add(intimacy_rec)

        await db.refresh(profile)
        await db.refresh(log)
        return log, profile


async def generate_diary(req: DiaryGenerateRequest) -> PetDiary:
    """Qwen-max로 반려동물 시점 일기 생성 후 DB 저장."""
    today = _date.today().isoformat()

    system_prompt = (
        "당신은 반려동물입니다. 오늘 하루를 반려동물의 시점에서 짧은 일기(3~5문장)로 써주세요. "
        "귀엽고 감성적인 문체로, 주인과의 교감을 중심으로 작성합니다. "
        "반드시 한국어로만 답하세요."
    )
    user_prompt = (
        f"나는 {req.pet_name}이야. 종류는 {req.pet_species}. "
        f"오늘({today}) 주인과 함께 놀고, 밥도 먹고, 많이 사랑받은 하루를 일기로 써줘."
    )

    mood = "happy"
    content = f"오늘도 {req.pet_name}는 행복한 하루를 보냈어요. 주인이랑 많이 놀았고 맛있는 것도 먹었어요!"

    if _QWEN_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    _QWEN_URL,
                    headers={"Authorization": f"Bearer {_QWEN_API_KEY}"},
                    json={
                        "model": "qwen-max",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user",   "content": user_prompt},
                        ],
                        "max_tokens": 300,
                    },
                )
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            logger.warning("[mental] 일기 생성 실패, 기본값 사용: %s", exc)

    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await db.execute(
                select(PetMentalProfile).where(PetMentalProfile.pet_id == req.pet_id)
            )
            profile = result.scalar_one_or_none()

            diary = PetDiary(
                pet_id     = req.pet_id,
                profile_id = profile.id if profile else None,
                content    = content,
                mood       = mood,
                date       = today,
            )
            db.add(diary)

        await db.refresh(diary)
        return diary


async def list_diaries(pet_id: str, limit: int = 10) -> list[PetDiary]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PetDiary)
            .where(PetDiary.pet_id == pet_id)
            .order_by(PetDiary.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
