"""
RAG 서비스 - 지식 검색 + Reranking.
cross-encoder 지연 로딩, 최초 호출 시 초기화.
전체 함수를 try/except로 감쌈 — 오류 시 빈 리스트 반환.
"""

import logging

from app.services.embedding_service import get_embedding

logger = logging.getLogger(__name__)

_reranker = None


def _get_reranker():
    global _reranker
    if _reranker is None:
        try:
            from sentence_transformers import CrossEncoder
            _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            logger.info("[rag] CrossEncoder 로드 완료")
        except Exception as exc:
            logger.warning("[rag] CrossEncoder 로드 실패 (rerank 건너뜀): %s", exc)
            _reranker = None
    return _reranker


async def retrieve_knowledge(
    rewritten_query: str,
    top_k_recall: int = 10,
    top_k_final: int = 3,
) -> list[dict]:
    """
    1. 쿼리 임베딩 생성
    2. knowledge_base 테이블 pgvector 검색 (top_k_recall)
    3. cross-encoder rerank → top_k_final 반환
    반환: [{"content": str, "source": str, "score": float}]
    """
    try:
        q_vec = await get_embedding(rewritten_query)
        if all(v == 0.0 for v in q_vec):
            return []

        from app.database import AsyncSessionLocal
        from sqlalchemy import text

        vec_str = "[" + ",".join(str(v) for v in q_vec) + "]"
        stmt = text(
            """
            SELECT id::text, content, source,
                   1 - (embedding <=> :qvec::vector) AS score
            FROM knowledge_base
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> :qvec::vector
            LIMIT :top_k
            """
        )

        async with AsyncSessionLocal() as db:
            result = await db.execute(stmt, {"qvec": vec_str, "top_k": top_k_recall})
            rows = result.fetchall()

        if not rows:
            return []

        candidates = [
            {"content": row.content, "source": row.source or "", "score": float(row.score)}
            for row in rows
        ]

        # cross-encoder rerank
        reranker = _get_reranker()
        if reranker is not None and len(candidates) > top_k_final:
            try:
                pairs = [(rewritten_query, doc["content"]) for doc in candidates]
                scores: list[float] = reranker.predict(pairs).tolist()
                for i, doc in enumerate(candidates):
                    doc["score"] = scores[i]
                candidates.sort(key=lambda d: d["score"], reverse=True)
            except Exception as exc:
                logger.warning("[rag] rerank 실패, 벡터 유사도 순 사용: %s", exc)

        return candidates[:top_k_final]

    except Exception as exc:
        logger.warning("[rag] retrieve_knowledge 실패: %s", exc)
        return []
