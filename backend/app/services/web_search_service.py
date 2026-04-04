"""
Web 검색 서비스 — Tavily API 기반.
Thinking 모드 + 시효성 키워드 감지 시 자동 실행.
TAVILY_API_KEY 없으면 빈 문자열 반환 — 메인 플로우 차단 없음.
캐시: web_search_cache 테이블 (6시간 TTL). 테이블 없어도 무시됨.
"""

import hashlib
import json
import logging
import os

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

TAVILY_API_KEY: str = os.getenv("TAVILY_API_KEY", "")
TAVILY_URL = "https://api.tavily.com/search"

# 시효성 질문 감지 키워드
TEMPORAL_KEYWORDS: list[str] = [
    "최신", "최근", "요즘", "지금", "현재", "올해", "이번",
    "새로운", "신약", "新", "最新", "最近", "现在",
]

# 수의학 관련 도메인 우선 검색
VETERINARY_DOMAINS: list[str] = [
    "petmd.com", "vcahospitals.com",
    "merckvetmanual.com", "aspca.org",
]


def is_temporal_query(query: str) -> bool:
    """시효성이 필요한 질문인지 판단."""
    result = any(kw in query for kw in TEMPORAL_KEYWORDS)
    print(f"[web_search] is_temporal_query: '{query[:60]}' → {result}")
    return result


async def search_web(query: str, db: AsyncSession) -> str:
    """
    Web 검색 실행. 결과를 캐시하고 context 텍스트로 반환.
    반환값: 포맷된 검색 결과 문자열 (실패 시 빈 문자열)
    """
    if not TAVILY_API_KEY:
        print("[web_search] TAVILY_API_KEY 없음 → 검색 건너뜀")
        logger.warning("[web_search] TAVILY_API_KEY 미설정")
        return ""

    print(f"[web_search] 검색 시작: {query[:60]}")

    query_hash = hashlib.md5(query.encode()).hexdigest()

    # ── 캐시 조회 ──────────────────────────────────────────
    cached = await _get_cached(query_hash, db)
    if cached:
        print(f"[web_search] 캐시 히트: {len(cached)}자")
        logger.info("[web_search] 캐시 히트: %.40s", query)
        return cached

    # ── Tavily API 호출 ────────────────────────────────────
    # include_domains 제거 — 영문 수의학 도메인만 제한하면 한국어 쿼리 결과 0건
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                TAVILY_URL,
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": f"반려동물 {query}",
                    "search_depth": "basic",
                    "max_results": 3,
                    "include_answer": True,
                },
            )

        print(f"[web_search] Tavily 응답 status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"[web_search] Tavily 에러: {resp.text[:200]}")
            logger.warning("[web_search] Tavily 오류: %d %.200s", resp.status_code, resp.text)
            return ""

        data = resp.json()
        formatted = _format(data)
        print(f"[web_search] 검색 결과 {len(formatted)}자 획득" if formatted else "[web_search] 검색 결과 없음")
        logger.info("[web_search] 검색 완료 %d자: %.40s", len(formatted), query)

        if formatted:
            await _save_cache(query_hash, query, formatted, db)

        return formatted

    except Exception as exc:
        print(f"[web_search] 예외 발생: {exc}")
        logger.warning("[web_search] 검색 실패: %s", exc)
        return ""


def _format(data: dict) -> str:
    """Tavily 응답 → prompt 삽입용 텍스트."""
    parts: list[str] = []

    if data.get("answer"):
        parts.append(f"웹 검색 요약: {data['answer']}")

    for r in data.get("results", [])[:3]:
        title = r.get("title", "")
        content = r.get("content", "")[:300]
        url = r.get("url", "")
        if content:
            parts.append(f"출처: {title}\n{content}\n({url})")

    return "\n\n".join(parts)


async def _get_cached(query_hash: str, db: AsyncSession) -> str:
    """web_search_cache에서 6시간 이내 결과 조회. 테이블 없으면 빈 문자열."""
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT results_json FROM web_search_cache
                    WHERE query_hash = :h
                      AND created_at > NOW() - INTERVAL '6 hours'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {"h": query_hash},
            )
        ).fetchone()
        if row and row[0]:
            data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            return data.get("formatted", "")
    except Exception:
        pass
    return ""


async def _save_cache(query_hash: str, query: str, formatted: str, db: AsyncSession) -> None:
    """검색 결과를 web_search_cache에 저장. 실패해도 무시."""
    try:
        await db.execute(
            text(
                """
                INSERT INTO web_search_cache
                    (query_hash, query_text, results_json, quality_score)
                VALUES
                    (:h, :q, CAST(:r AS jsonb), :s)
                """
            ),
            {
                "h": query_hash,
                "q": query,
                "r": json.dumps({"formatted": formatted}),
                "s": 0.8,
            },
        )
        await db.commit()
    except Exception as exc:
        logger.debug("[web_search] 캐시 저장 실패 (무시): %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass
