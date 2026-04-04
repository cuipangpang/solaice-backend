"""
임베딩 생성 서비스.
Qwen text-embedding-v3 API 사용 (백엔드 QWEN_API_KEY 사용).
실패 시 [0.0] * 1536 반환 — 메인 플로우 차단 안 함.
把一段文字发送给 AI（阿里云的千问大模型），然后获取这段文字的"数学表达形式"（即 Embedding 向量）
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
EMBEDDING_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings"
EMBEDDING_MODEL = "text-embedding-v3"
EMBEDDING_DIM = 1024  # text-embedding-v3 실제 출력 차원 (1536 아님)
_ZERO_VECTOR: list[float] = [0.0] * EMBEDDING_DIM

"""
异步函数：使用异步，Python 可以在等待网络响应时去处理其他用户的请求
"""
async def get_embedding(text: str) -> list[float]:
    """
    1024차원 float 리스트 반환.
    호출 실패 시 [0.0] * 1024 반환 (메인 플로우 차단 안 함).
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
                    # dimensions 파라미터 제거: compatible-mode에서 미지원,
                    # text-embedding-v3 고정 출력 = 1024차원
                },
            )
            response.raise_for_status()
            data = response.json()  # 把返回的 JSON 字符串转成 Python 字典
            embedding: list[float] = data["data"][0]["embedding"]  # 【防御性编程】双重保险检查：服务器返回的长度是不是真的是 1536？
            if len(embedding) != EMBEDDING_DIM:
                logger.warning(
                    "[embedding] 차원 불일치: expected %d, got %d",
                    EMBEDDING_DIM, len(embedding),
                )
                return _ZERO_VECTOR  # 如果长度不对，说明数据脏了，宁可不要，返回 0 向量
            return embedding # 一切顺利，返回正确的向量
    except Exception as exc:
        logger.warning("[embedding] get_embedding 실패: %s", exc)
        return _ZERO_VECTOR
