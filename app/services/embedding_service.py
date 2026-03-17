"""
임베딩 생성 서비스.
Qwen text-embedding-v3 API 사용 (백엔드 QWEN_API_KEY 사용).
실패 시 [0.0] * 1536 반환 — 메인 플로우 차단 안 함.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
EMBEDDING_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings"
EMBEDDING_MODEL = "text-embedding-v3"
EMBEDDING_DIM = 1536

_ZERO_VECTOR: list[float] = [0.0] * EMBEDDING_DIM


async def get_embedding(text: str) -> list[float]:
    """
    1536차원 float 리스트 반환.
    호출 실패 시 [0.0] * 1536 반환 (메인 플로우 차단 안 함).
    httpx.AsyncClient 사용, timeout=15s.
    """
    if not QWEN_API_KEY or not text.strip():
        return _ZERO_VECTOR

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                EMBEDDING_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {QWEN_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": EMBEDDING_MODEL,
                    "input": text,
                    "dimensions": EMBEDDING_DIM,
                },
            )
            response.raise_for_status()
            data = response.json()
            embedding: list[float] = data["data"][0]["embedding"]
            if len(embedding) != EMBEDDING_DIM:
                logger.warning(
                    "[embedding] 차원 불일치: expected %d, got %d",
                    EMBEDDING_DIM, len(embedding),
                )
                return _ZERO_VECTOR
            return embedding
    except Exception as exc:
        logger.warning("[embedding] get_embedding 실패: %s", exc)
        return _ZERO_VECTOR
