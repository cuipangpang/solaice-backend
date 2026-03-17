"""
Redis 연결 및 작업 래핑.
연결 설정은 환경변수 REDIS_URL에서 읽음, 기본값 redis://localhost:6379/0.
redis.asyncio 사용 (redis[hiredis] 패키지 내장).
모듈 레벨 싱글톤 클라이언트, lazy init.
모든 함수는 Redis 예외를 내부에서 처리 — 실패해도 메인 플로우 차단 안 함.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

_redis_client: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    """Redis 싱글톤 반환, 최초 호출 시 초기화 및 ping 검증."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        await _redis_client.ping()
    except Exception as exc:
        logger.warning("[redis] ping failed: %s", exc)
    return _redis_client


async def close_redis() -> None:
    """Redis 연결 종료, app shutdown 시 호출."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception as exc:
            logger.warning("[redis] close failed: %s", exc)
        finally:
            _redis_client = None


# ── 단기 대화 기억 ──────────────────────────────────────────────
# key 형식: "chat:{pet_id}:{session_id}"
# value: Redis list, 각 요소는 JSON 문자열
# 각 메시지 구조: {"role": "user"|"assistant", "content": str,
#                  "turn_index": int, "image_url": str|None}

def _chat_key(pet_id: str, session_id: str) -> str:
    return f"chat:{pet_id}:{session_id}"


async def get_chat_history(pet_id: str, session_id: str) -> list[dict]:
    """
    LRANGE로 전체 조회, 역직렬화 후 반환.
    최대 12개 반환 (6턴), Redis 예외 발생 시 빈 리스트 반환.
    """
    try:
        r = await get_redis()
        raw_list: list[str] = await r.lrange(_chat_key(pet_id, session_id), 0, -1)
        messages = [json.loads(item) for item in raw_list]
        return messages[-12:]
    except Exception as exc:
        logger.warning("[redis] get_chat_history failed: %s", exc)
        return []


async def append_chat_message(pet_id: str, session_id: str, message: dict) -> None:
    """
    RPUSH로 메시지 추가 (JSON 직렬화), LTRIM으로 최근 12개 유지, EXPIRE 86400s.
    """
    try:
        r = await get_redis()
        key = _chat_key(pet_id, session_id)
        await r.rpush(key, json.dumps(message, ensure_ascii=False))
        await r.ltrim(key, -12, -1)
        await r.expire(key, 86400)
    except Exception as exc:
        logger.warning("[redis] append_chat_message failed: %s", exc)


# ── 세션 상태 ────────────────────────────────────────────────────
# key 형식: "session_state:{session_id}"
# value: Redis hash
# 필드: turn_count(str), stage(str), lang(str), last_updated(str)

def _state_key(session_id: str) -> str:
    return f"session_state:{session_id}"


async def get_session_state(session_id: str) -> dict | None:
    """HGETALL, key 없으면 None 반환."""
    try:
        r = await get_redis()
        data = await r.hgetall(_state_key(session_id))
        return dict(data) if data else None
    except Exception as exc:
        logger.warning("[redis] get_session_state failed: %s", exc)
        return None


async def set_session_state(session_id: str, state: dict) -> None:
    """HSET 전체 업데이트, EXPIRE 86400s."""
    try:
        r = await get_redis()
        key = _state_key(session_id)
        await r.hset(key, mapping={k: str(v) for k, v in state.items()})
        await r.expire(key, 86400)
    except Exception as exc:
        logger.warning("[redis] set_session_state failed: %s", exc)


# ── 쿼리 재작성 캐시 ────────────────────────────────────────────
# key 형식: "rewrite:{session_id}"
# value: Redis list, 재작성된 query 문자열 저장 (JSON 아님)

def _rewrite_key(session_id: str) -> str:
    return f"rewrite:{session_id}"


async def get_rewrite_cache(session_id: str) -> list[str]:
    """LRANGE 전체 조회, 문자열 리스트 반환, 최대 3개."""
    try:
        r = await get_redis()
        raw_list: list[str] = await r.lrange(_rewrite_key(session_id), 0, -1)
        return raw_list[-3:]
    except Exception as exc:
        logger.warning("[redis] get_rewrite_cache failed: %s", exc)
        return []


async def append_rewrite_cache(session_id: str, rewritten_query: str) -> None:
    """RPUSH, LTRIM으로 최근 3개 유지, EXPIRE 3600s."""
    try:
        r = await get_redis()
        key = _rewrite_key(session_id)
        await r.rpush(key, rewritten_query)
        await r.ltrim(key, -3, -1)
        await r.expire(key, 3600)
    except Exception as exc:
        logger.warning("[redis] append_rewrite_cache failed: %s", exc)


# ── 정신 건강 상태 ───────────────────────────────────────────────
# key 형식: "mental:{session_id}"
# value: Redis hash
# 필드: emotion(str), is_crisis(str "true"/"false"), last_updated(str)

def _mental_key(session_id: str) -> str:
    return f"mental:{session_id}"


async def get_mental_state(session_id: str) -> dict | None:
    """HGETALL, key 없으면 None 반환."""
    try:
        r = await get_redis()
        data = await r.hgetall(_mental_key(session_id))
        return dict(data) if data else None
    except Exception as exc:
        logger.warning("[redis] get_mental_state failed: %s", exc)
        return None


async def set_mental_state(session_id: str, state: dict) -> None:
    """HSET, EXPIRE 86400s."""
    try:
        r = await get_redis()
        key = _mental_key(session_id)
        await r.hset(key, mapping={k: str(v) for k, v in state.items()})
        await r.expire(key, 86400)
    except Exception as exc:
        logger.warning("[redis] set_mental_state failed: %s", exc)
