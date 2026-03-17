"""
쿼리 재작성 서비스.
Qwen API 직접 호출 (백엔드), key는 QWEN_API_KEY 환경변수에서 읽기.
chat_history가 1개 이하이면 current_query 그대로 반환.
실패 시 current_query fallback — 예외 발생시키지 않음.
"""

import logging
import os

import httpx

from app.services.redis_service import append_rewrite_cache

logger = logging.getLogger(__name__)

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"

REWRITE_PROMPT_TEMPLATE = """당신은 반려동물 건강 상담 AI입니다. 아래 대화 기록을 바탕으로 사용자의 최신 질문을 문맥에 의존하지 않는 완전히 독립적인 질문으로 재작성하세요.

반려동물 정보: {pet_name}, {species}, {age}살
최근 대화 기록 ({n}턴):
{history}

사용자 최신 질문: {current_query}

재작성 규칙:
1. 대명사(걔, 그것, 이것, 거기서, 아까, 그때)를 구체적인 표현으로 교체
2. 대화에서 언급된 증상/시간 정보를 보완
3. 원래 질문이 이미 완전하고 명확한 경우 그대로 반환
4. 사용자의 의도를 유지하고 추측을 추가하지 말 것

재작성된 질문만 출력하세요. 설명 없이."""


async def rewrite_query(
    current_query: str,
    chat_history: list[dict],
    session_id: str,
    pet_context: dict,
) -> str:
    """
    chat_history가 비어 있거나 길이 <= 1이면 current_query 그대로 반환.
    성공 시 redis append_rewrite_cache 호출.
    실패 시 current_query fallback.
    """
    if not chat_history or len(chat_history) <= 1:
        return current_query

    if not QWEN_API_KEY:
        return current_query

    # 최근 4개 메시지만 히스토리로 사용
    recent = chat_history[-4:]
    history_lines = "\n".join(
        f"[{msg.get('role', 'user')}] {msg.get('content', '')}"
        for msg in recent
    )

    prompt = REWRITE_PROMPT_TEMPLATE.format(
        pet_name=pet_context.get("pet_name", "반려동물"),
        species=pet_context.get("species", ""),
        age=pet_context.get("age", ""),
        n=len(recent),
        history=history_lines,
        current_query=current_query,
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
                    "model": "qwen-vl-max",
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "max_tokens": 150,
                    "temperature": 0.1,
                },
            )
            response.raise_for_status()
            data = response.json()
            rewritten: str = data["choices"][0]["message"]["content"].strip()
            if rewritten:
                await append_rewrite_cache(session_id, rewritten)
                return rewritten
    except Exception as exc:
        logger.warning("[query_rewrite] 재작성 실패, fallback: %s", exc)

    return current_query
