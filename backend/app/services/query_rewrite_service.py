"""
쿼리 재작성 서비스.
Qwen API 직접 호출 (백엔드), key는 QWEN_API_KEY 환경변수에서 읽기.
chat_history가 1개 이하이면 current_query 그대로 반환.
실패 시 current_query fallback — 예외 발생시키지 않음.

v4 변경:
- 프롬프트: Zero-shot CoT 방식으로 교체 (3단계 사고 후 검색 쿼리 생성)
- hyde_query() 추가: 가상 답변으로 임베딩 품질 향상
- rewrite_query(): HyDE 텍스트도 함께 반환하도록 확장
"""

import logging
import os

import httpx

from app.services.redis_service import append_rewrite_cache

logger = logging.getLogger(__name__)

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"

# ── Zero-shot CoT 재작성 프롬프트 ──────────────────────────────────────────

REWRITE_PROMPT_TEMPLATE = """다음 3단계로 사용자의 실제 의도를 파악하고 검색 쿼리를 재작성해줘.

반려동물 정보: {pet_name}, {species}, {age}살
최근 대화 기록 ({n}턴):
{history}

사용자 최신 메시지: {current_query}

<think>
1단계: 사용자가 진짜 알고 싶은 것이 무엇인지 파악
2단계: 대화 기록에서 관련된 맥락(증상, 동물 이름, 이전 진단)을 수집
3단계: 1단계와 2단계를 결합해 완전한 독립형 검색 쿼리 작성
</think>

최종 검색 쿼리 (한 줄만):"""

# ── HyDE 프롬프트 ──────────────────────────────────────────────────────────

HYDE_PROMPT_TEMPLATE = """반려동물 정보: {pet_profile}
질문: {query}

이 질문에 대한 수의학적 관점의 짧은 답변(2-3문장)을 작성해줘.
정확하지 않아도 되고, 관련 전문 용어가 포함되면 좋아.
답변만 출력하고 설명하지 마."""


# ── HyDE: 가상 답변 생성 ───────────────────────────────────────────────────

async def hyde_query(original_query: str, pet_profile: str) -> str:
    """
    Hypothetical Document Embedding:
    질문에 대한 가상 답변을 생성하고 반환.
    이 텍스트를 embedding_service로 벡터화해서 검색에 사용하면
    질문 벡터보다 답변 공간에 더 가까운 검색이 가능.
    실패 시 빈 문자열 반환 — 메인 플로우 차단 안 함.
    """
    if not QWEN_API_KEY:
        return ""

    prompt = HYDE_PROMPT_TEMPLATE.format(
        pet_profile=pet_profile,
        query=original_query,
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                QWEN_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {QWEN_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-plus",
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "max_tokens": 150,
                    "temperature": 0.3,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("[query_rewrite] hyde_query 실패: %s", exc)
        return ""


# ── 쿼리 재작성 ────────────────────────────────────────────────────────────

async def rewrite_query(
    current_query: str,
    chat_history: list[dict],
    session_id: str,
    pet_context: dict,
) -> tuple[str, str]:
    """
    Zero-shot CoT 방식으로 쿼리 재작성 + HyDE 텍스트 병렬 생성.

    반환: (rewritten_query, hyde_text)
    - chat_history <= 1이면 (current_query, "")
    - 실패 시 (current_query, "") fallback
    """
    if not chat_history or len(chat_history) <= 1:
        return current_query, ""

    if not QWEN_API_KEY:
        return current_query, ""

    # 최근 4개 메시지만 히스토리로 사용
    recent = chat_history[-4:]
    history_lines = "\n".join(
        f"[{msg.get('role', 'user')}] {msg.get('content', '')}"
        for msg in recent
    )

    rewrite_prompt = REWRITE_PROMPT_TEMPLATE.format(
        pet_name=pet_context.get("pet_name", "반려동물"),
        species=pet_context.get("species", ""),
        age=pet_context.get("age", ""),
        n=len(recent),
        history=history_lines,
        current_query=current_query,
    )

    pet_profile_str = (
        f"{pet_context.get('pet_name', '반려동물')}, "
        f"{pet_context.get('species', '')}, "
        f"{pet_context.get('age', '')}살"
    )

    # 재작성 + HyDE 병렬 실행
    import asyncio

    async def _call_rewrite() -> str:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    QWEN_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {QWEN_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "qwen-plus",
                        "messages": [{"role": "user", "content": rewrite_prompt}],
                        "stream": False,
                        "max_tokens": 150,
                        "temperature": 0.1,
                    },
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            logger.warning("[query_rewrite] 재작성 실패: %s", exc)
            return ""

    rewritten_raw, hyde_text = await asyncio.gather(
        _call_rewrite(),
        hyde_query(current_query, pet_profile_str),
    )

    rewritten = rewritten_raw if rewritten_raw else current_query

    if rewritten != current_query:
        await append_rewrite_cache(session_id, rewritten)

    return rewritten, hyde_text
