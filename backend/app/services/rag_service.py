"""
RAG 서비스 - 지식 검색 + Reranking.
cross-encoder 지연 로딩, 최초 호출 시 초기화.
전체 함수를 try/except로 감쌈 — 오류 시 빈 리스트 반환.

v4 추가:
- u_shape_sort: Lost-in-the-Middle 완화를 위한 U형 재정렬
- bm25_search: PostgreSQL tsvector 기반 키워드 검색
- rrf_fusion: Reciprocal Rank Fusion (Dense + BM25 통합)
- retrieve_knowledge: HyDE 벡터 + 원본 쿼리 벡터 평균, RRF 융합, U형 정렬까지 적용
- mmr_select: Maximal Marginal Relevance (λ=0.7, 관련성 70% + 다양성 30%)
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


# ── MMR 다양성 선택 ───────────────────────────────────────────────────────────

def mmr_select(candidates: list[dict], top_k: int, lambda_: float = 0.7) -> list[dict]:
    """
    Maximal Marginal Relevance로 관련성과 다양성을 균형 있게 선택.
    lambda_=0.7: 관련성 70%, 다양성 30%

    관련성: CrossEncoder score (min-max 정규화)
    다양성: 문서 간 토큰 집합 Jaccard 유사도
    """
    if len(candidates) <= top_k:
        return candidates

    # min-max 정규화
    scores = [d["score"] for d in candidates]
    min_s, max_s = min(scores), max(scores)
    rng = max_s - min_s if max_s != min_s else 1.0
    norm = [(s - min_s) / rng for s in scores]

    # 토큰 집합 (소문자 공백 분리)
    tok = [set(d["content"].lower().split()) for d in candidates]

    selected: list[int] = []
    remaining = list(range(len(candidates)))

    while len(selected) < top_k and remaining:
        best_i, best_score = None, float("-inf")
        for i in remaining:
            rel = norm[i]
            if not selected:
                mmr = rel
            else:
                # 이미 선택된 문서들과의 최대 Jaccard 유사도
                max_sim = max(
                    len(tok[i] & tok[j]) / len(tok[i] | tok[j])
                    if tok[i] | tok[j] else 0.0
                    for j in selected
                )
                mmr = lambda_ * rel - (1 - lambda_) * max_sim
            if mmr > best_score:
                best_score, best_i = mmr, i
        selected.append(best_i)
        remaining.remove(best_i)

    return [candidates[i] for i in selected]


# ── U형 정렬 ──────────────────────────────────────────────────────────────────

def u_shape_sort(docs: list) -> list:
    """
    가장 관련성 높은 문서를 첫 번째와 마지막에 배치.
    중간에 덜 중요한 문서를 배치해 Lost-in-the-Middle 문제를 완화.

    예) 점수 순 [A, B, C, D, E] → U형 [A, C, E, D, B]
    """
    if len(docs) <= 2:
        return docs
    result = []
    left, right = 0, len(docs) - 1
    turn = True
    while left <= right:
        if turn:
            result.append(docs[left])
            left += 1
        else:
            result.append(docs[right])
            right -= 1
        turn = not turn
    return result


# ── BM25 키워드 검색 ──────────────────────────────────────────────────────────

async def bm25_search(query: str, top_k: int) -> list[dict]:
    """
    PostgreSQL tsvector 기반 키워드 검색.
    knowledge_base.content_tsv 컬럼에 GIN 인덱스가 있어야 동작.
    실패 시 빈 리스트 반환 — 메인 플로우 차단 안 함.
    """
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text

        # plainto_tsquery: 특수문자(&, |, () 등) 자동 처리 — to_tsquery보다 안전
        stmt = text(
            """
            SELECT content, source,
                   ts_rank(content_tsv, plainto_tsquery('simple', :query)) AS score
            FROM knowledge_base
            WHERE content_tsv @@ plainto_tsquery('simple', :query)
              AND content_tsv IS NOT NULL
            ORDER BY score DESC
            LIMIT :top_k
            """
        )

        async with AsyncSessionLocal() as db:
            result = await db.execute(stmt, {"query": query, "top_k": top_k})
            rows = result.fetchall()

        return [
            {"content": row.content, "source": row.source or "", "score": float(row.score)}
            for row in rows
        ]

    except Exception as exc:
        logger.warning("[rag] bm25_search 실패: %s", exc)
        return []


# ── RRF 융합 ──────────────────────────────────────────────────────────────────

def rrf_fusion(dense_results: list, sparse_results: list, k: int = 60) -> list:
    """
    Reciprocal Rank Fusion으로 Dense(벡터) + Sparse(BM25) 결과를 통합.
    동일 content를 기준으로 점수를 합산하고 내림차순 정렬.

    RRF 공식: score(d) = Σ 1 / (k + rank(d))
    """
    scores: dict[str, float] = {}
    contents: dict[str, dict] = {}

    for rank, doc in enumerate(dense_results, start=1):
        key = doc["content"]
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
        contents[key] = doc

    for rank, doc in enumerate(sparse_results, start=1):
        key = doc["content"]
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
        contents.setdefault(key, doc)

    fused = sorted(
        [{"content": k, "source": contents[k]["source"], "score": v} for k, v in scores.items()],
        key=lambda d: d["score"],
        reverse=True,
    )
    return fused


# ── 메인 검색 함수 ────────────────────────────────────────────────────────────

async def retrieve_knowledge(
    rewritten_query: str,
    top_k_recall: int = 10,
    top_k_final: int = 3,
    hyde_text: str | None = None,
) -> list[dict]:
    """
    1. 쿼리 임베딩 생성 (+ HyDE 텍스트가 있으면 평균 벡터 사용)
    2. Dense 벡터 검색 + BM25 키워드 검색 병렬 실행
    3. RRF 융합으로 top_k_recall 선정
    4. CrossEncoder rerank
    5. U형 정렬 후 top_k_final 반환

    반환: [{"content": str, "source": str, "score": float}]
    """
    try:
        import asyncio

        # ── 1. 임베딩 생성 ──────────────────────────────────────────
        if hyde_text:
            q_vec_task = get_embedding(rewritten_query)
            h_vec_task = get_embedding(hyde_text)
            q_vec, h_vec = await asyncio.gather(q_vec_task, h_vec_task)

            # 두 벡터 중 하나라도 영벡터면 영벡터가 아닌 것 사용
            q_is_zero = all(v == 0.0 for v in q_vec)
            h_is_zero = all(v == 0.0 for v in h_vec)

            if q_is_zero and h_is_zero:
                return []
            elif q_is_zero:
                final_vec = h_vec
            elif h_is_zero:
                final_vec = q_vec
            else:
                # 평균 벡터
                final_vec = [(a + b) / 2.0 for a, b in zip(q_vec, h_vec)]
        else:
            final_vec = await get_embedding(rewritten_query)
            if all(v == 0.0 for v in final_vec):
                return []

        # ── 2. Dense 검색 + BM25 병렬 실행 ────────────────────────
        from app.database import AsyncSessionLocal
        from sqlalchemy import text

        vec_str = "[" + ",".join(str(v) for v in final_vec) + "]"
        # CAST() 방식 사용 — ::vector 캐스팅은 asyncpg 파라미터 바인딩과 충돌
        dense_stmt = text(
            """
            SELECT id::text, content, source,
                   1 - (embedding <=> CAST(:qvec AS vector)) AS score
            FROM knowledge_base
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:qvec AS vector)
            LIMIT :top_k
            """
        )

        async def _dense_search() -> list[dict]:
            async with AsyncSessionLocal() as db:
                result = await db.execute(dense_stmt, {"qvec": vec_str, "top_k": top_k_recall})
                rows = result.fetchall()
            return [
                {"content": row.content, "source": row.source or "", "score": float(row.score)}
                for row in rows
            ]

        dense_results, sparse_results = await asyncio.gather(
            _dense_search(),
            bm25_search(rewritten_query, top_k_recall),
        )

        if not dense_results and not sparse_results:
            return []

        # ── 3. RRF 융합 ─────────────────────────────────────────────
        fused = rrf_fusion(dense_results, sparse_results)
        candidates = fused[:top_k_recall]

        # ── 4. CrossEncoder rerank ──────────────────────────────────
        reranker = _get_reranker()
        if reranker is not None and len(candidates) > top_k_final:
            try:
                pairs = [(rewritten_query, doc["content"]) for doc in candidates]
                scores: list[float] = reranker.predict(pairs).tolist()
                for i, doc in enumerate(candidates):
                    doc["score"] = scores[i]
                candidates.sort(key=lambda d: d["score"], reverse=True)
            except Exception as exc:
                logger.warning("[rag] rerank 실패, RRF 점수 순 사용: %s", exc)

        # ── 5. MMR 다양성 선택 → U형 정렬 ─────────────────────────
        top = mmr_select(candidates, top_k_final, lambda_=0.7)
        return u_shape_sort(top)

    except Exception as exc:
        logger.warning("[rag] retrieve_knowledge 실패: %s", exc)
        return []
