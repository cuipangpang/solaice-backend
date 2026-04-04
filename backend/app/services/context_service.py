"""
컨텍스트 서비스.
asyncio.gather로 3가지 컨텍스트를 병렬로 가져옵니다.

v4 변경:
- _get_long_term_memory: structured_facts 컬럼도 함께 조회
- _merge_structured_facts: 여러 요약의 structured_facts를 병합
- get_full_context: structured_facts 포함해서 반환
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


def _merge_structured_facts(summaries: list[dict]) -> dict:
    """
    여러 요약의 structured_facts를 병합.
    각 배열은 중복 없이 합산.
    """
    merged: dict = {
        "allergies": [],
        "diagnosed_conditions": [],
        "medications": [],
        "symptoms_history": [],
        "vet_advice": [],
    }
    for s in summaries:
        sf = s.get("structured_facts") or {}
        if not isinstance(sf, dict):
            continue
        for key in merged:
            items = sf.get(key) or []
            if not isinstance(items, list):
                continue
            for item in items:
                if item and item not in merged[key]:
                    merged[key].append(item)
    return merged


async def _get_long_term_memory(pet_id: str, rewritten_query: str, db: AsyncSession) -> list[dict]:
    """
    conversation_summaries에서 pgvector cosine 검색, top-3 반환.
    structured_facts 컬럼도 함께 반환 (v4).
    """
    try:
        q_vec = await embedding_service.get_embedding(rewritten_query)

        if all(v == 0.0 for v in q_vec):
            return []

        vec_str = "[" + ",".join(str(v) for v in q_vec) + "]"
        # CAST() 방식 사용 — ::vector 캐스팅은 asyncpg 파라미터 바인딩과 충돌
        stmt = text(
            """
            SELECT summary_text,
                   structured_facts,
                   created_at::text AS created_at,
                   1 - (embedding <=> CAST(:qvec AS vector)) AS similarity
            FROM conversation_summaries
            WHERE pet_id = :pet_id
              AND embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:qvec AS vector)
            LIMIT 3
            """
        )
        result = await db.execute(stmt, {"pet_id": str(pet_id), "qvec": vec_str})
        rows = result.fetchall()
        return [
            {
                "summary_text": row.summary_text,
                "structured_facts": row.structured_facts or {},
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
    3. long_term_memory (pgvector, structured_facts 포함)

    반환:
    {
      "pet_profile": dict,
      "short_term_memory": list[dict],
      "long_term_memory": list[dict],
      "structured_facts": dict,   # 모든 요약에서 병합된 필수 정보 (v4)
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

    # structured_facts 병합
    ltm = long_term_memory if isinstance(long_term_memory, list) else []
    merged_sf = _merge_structured_facts(ltm)

    return {
        "pet_profile": pet_profile if isinstance(pet_profile, dict) else {},
        "short_term_memory": short_term_memory if isinstance(short_term_memory, list) else [],
        "long_term_memory": ltm,
        "structured_facts": merged_sf,
    }
