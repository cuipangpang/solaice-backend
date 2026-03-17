"""
컨텍스트 서비스.
asyncio.gather로 3가지 컨텍스트를 병렬로 가져옵니다.
"""

import asyncio
import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import embedding_service, redis_service

logger = logging.getLogger(__name__)


async def _get_pet_profile(pet_id: str, db: AsyncSession) -> dict:
    """pet_profiles 테이블에서 조회. deleted_at IS NULL 필터."""
    try:
        from app.models.pet_profile import PetProfile
        import uuid as _uuid

        result = await db.execute(
            select(PetProfile).where(
                PetProfile.id == _uuid.UUID(pet_id),
                PetProfile.deleted_at.is_(None),
            )
        )
        pet = result.scalar_one_or_none()
        if not pet:
            return {}

        return {
            "id": str(pet.id),
            "name": pet.name,
            "species": pet.species,
            "age": str(pet.age_years) if pet.age_years is not None else "",
            "age_years": pet.age_years,
            "breed": pet.breed,
            "medical_history": pet.medical_history or "",
            "allergies": pet.allergies or "",
            "neutered": pet.neutered,
            "birthday": str(pet.birthday) if pet.birthday else "",
            "gender": pet.gender or "",
        }
    except Exception as exc:
        logger.warning("[context] get_pet_profile 실패: %s", exc)
        return {}


async def _get_long_term_memory(pet_id: str, rewritten_query: str, db: AsyncSession) -> list[dict]:
    """conversation_summaries에서 pgvector cosine 검색, top-3 반환."""
    try:
        q_vec = await embedding_service.get_embedding(rewritten_query)

        # 제로 벡터 시 검색 건너뜀
        if all(v == 0.0 for v in q_vec):
            return []

        vec_str = "[" + ",".join(str(v) for v in q_vec) + "]"
        stmt = text(
            """
            SELECT summary_text,
                   created_at::text AS created_at,
                   1 - (embedding <=> :qvec::vector) AS similarity
            FROM conversation_summaries
            WHERE pet_id = :pet_id
              AND embedding IS NOT NULL
            ORDER BY embedding <=> :qvec::vector
            LIMIT 3
            """
        )
        result = await db.execute(stmt, {"pet_id": pet_id, "qvec": vec_str})
        rows = result.fetchall()
        return [
            {
                "summary_text": row.summary_text,
                "similarity": float(row.similarity),
                "created_at": row.created_at,
            }
            for row in rows
        ]
    except Exception as exc:
        logger.warning("[context] get_long_term_memory 실패: %s", exc)
        return []


async def get_full_context(
    pet_id: str,
    session_id: str,
    rewritten_query: str,
    db: AsyncSession,
) -> dict:
    """
    asyncio.gather로 병렬 실행:
    1. pet_profile
    2. short_term_memory (Redis)
    3. long_term_memory (pgvector)

    반환:
    {
      "pet_profile": dict,
      "short_term_memory": list[dict],
      "long_term_memory": list[dict]
    }
    """
    pet_task = _get_pet_profile(pet_id, db)
    short_term_task = redis_service.get_chat_history(pet_id, session_id)
    long_term_task = _get_long_term_memory(pet_id, rewritten_query, db)

    pet_profile, short_term_memory, long_term_memory = await asyncio.gather(
        pet_task,
        short_term_task,
        long_term_task,
        return_exceptions=False,
    )

    return {
        "pet_profile": pet_profile if isinstance(pet_profile, dict) else {},
        "short_term_memory": short_term_memory if isinstance(short_term_memory, list) else [],
        "long_term_memory": long_term_memory if isinstance(long_term_memory, list) else [],
    }
