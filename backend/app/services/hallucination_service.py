"""
환각 감지 3단계 서비스

Layer 1: 규칙 기반 (<5ms, 동기, 반드시 실행)
Layer 2: LLM 자기 검증 (urgency=visit/emergency 시만)
Layer 3: 비동기 Faithfulness 검증 (RAGAS 스타일, 비차단, hallucination_logs 저장)

모든 함수는 try/except로 감싸져 있어 실패해도 기존 흐름 차단하지 않음.
"""

import logging
import os
import re
import uuid

import httpx

logger = logging.getLogger(__name__)

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"

# ── 규칙 정의 ─────────────────────────────────────────────────────────────────
# condition(text, urgency) → bool: 이 규칙을 검사해야 하는가?
# check(text, urgency)     → bool: True=정상 통과, False=문제 감지

SAFETY_RULES: list[dict] = [
    {
        "name": "urgency_action_mismatch",
        "description": "응급 판정인데 즉시 진료 행동 지시 없음",
        "condition": lambda text, urgency: urgency in ("emergency", "red"),
        "check": lambda text, urgency: any(
            kw in text for kw in ["즉시 동물병원", "지금 바로", "응급", "바로 가", "emergency"]
        ),
        "action": "regenerate",
    },
    {
        "name": "medication_dosage",
        "description": "mg/kg 구체 용량 언급 — 면책 문구 추가",
        "condition": lambda text, urgency: bool(re.search(r"\d+\s*mg/kg", text)),
        "check": lambda text, urgency: False,  # 조건 해당 시 항상 트리거
        "action": "append_disclaimer",
        "disclaimer": "\n\n⚠️ 구체적인 용량은 반드시 수의사 처방을 따르세요.",
    },
    {
        "name": "color_action_contradiction",
        "description": "🟢 정상 판정인데 즉시 진료 권고 모순",
        "condition": lambda text, urgency: "🟢" in text and "즉시" in text,
        "check": lambda text, urgency: False,
        "action": "regenerate",
    },
]


# ── Layer 1: 규칙 기반 (<5ms) ─────────────────────────────────────────────────

async def layer1_rule_check(text: str, urgency: str | None) -> dict:
    """
    규칙 기반 검사. 동기 처리에 가까운 속도 목표 (<5ms).

    반환:
    {
      "triggered": bool,
      "rule_name": str | None,
      "action": str | None,       # "regenerate" | "append_disclaimer" | None
      "modified_text": str,        # disclaimer 추가 시 원본+면책문구, 그 외는 원본
    }
    """
    urg = urgency or ""

    for rule in SAFETY_RULES:
        try:
            if not rule["condition"](text, urg):
                continue
            passes = rule["check"](text, urg)
            if not passes:
                action = rule["action"]
                modified = text
                if action == "append_disclaimer" and rule.get("disclaimer"):
                    modified = text + rule["disclaimer"]
                return {
                    "triggered": True,
                    "rule_name": rule["name"],
                    "action": action,
                    "modified_text": modified,
                }
        except Exception as exc:
            logger.debug("[hallucination] layer1 규칙 평가 오류 (%s): %s", rule.get("name"), exc)
            continue

    return {"triggered": False, "rule_name": None, "action": None, "modified_text": text}


# ── Layer 2: LLM 자기 검증 ────────────────────────────────────────────────────

async def layer2_llm_selfcheck(text: str, rag_context: str) -> bool:
    """
    LLM 자기 검증. urgency=visit/emergency 일 때만 호출.
    반환: True = 이상 없음, False = 환각 의심
    실패 시 True 반환 (관대하게 — 불필요한 차단 방지).
    """
    if not QWEN_API_KEY:
        return True

    context_snippet = (rag_context or "없음")[:800]
    answer_snippet = text[:600]

    prompt = f"""아래 AI 답변이 참고 문서에 근거하는지 검증해줘.

참고 문서:
{context_snippet}

AI 답변:
{answer_snippet}

검증 기준:
1. 답변이 참고 문서에 없는 구체적인 약품명/용량을 언급하는가?
2. 진단이 제공된 증상과 명백히 모순되는가?
3. 응급 판정인데 행동 지시가 전혀 없는가?

위 3가지 중 하나라도 해당하면 "FAIL", 모두 괜찮으면 "PASS"만 출력해줘."""

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                QWEN_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {QWEN_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-plus",
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "max_tokens": 20,
                    "temperature": 0.0,
                },
            )
            resp.raise_for_status()
            verdict = resp.json()["choices"][0]["message"]["content"].strip().upper()
            return "PASS" in verdict
    except Exception as exc:
        logger.warning("[hallucination] layer2 LLM selfcheck 실패 (통과 처리): %s", exc)
        return True


# ── Layer 3: 비동기 Faithfulness 검증 ────────────────────────────────────────

async def layer3_async_faithfulness(
    session_id: str,
    question: str,
    answer: str,
    contexts: list[str],
) -> None:
    """
    간이 Faithfulness 계산 + hallucination_logs 저장.
    asyncio.create_task()로 비차단 실행.
    faithfulness < 0.4 이면 hallucination_logs에 기록.
    """
    try:
        if not answer or not contexts:
            return

        # 간이 faithfulness: 답변 청크 중 컨텍스트에서 근거가 있는 비율
        chunks = [s.strip() for s in re.split(r"[。.!?！？\n]", answer) if len(s.strip()) > 5]
        if not chunks:
            return

        context_blob = " ".join(contexts).lower()
        supported = sum(
            1
            for chunk in chunks
            if any(word.lower() in context_blob for word in chunk.split() if len(word) > 2)
        )
        faithfulness_score = supported / len(chunks)

        if faithfulness_score < 0.4:
            from app.database import AsyncSessionLocal
            from sqlalchemy import text

            async with AsyncSessionLocal() as db:
                await db.execute(
                    text(
                        """
                        INSERT INTO hallucination_logs
                            (id, session_id, rule_triggered, original_output, action, review_status)
                        VALUES
                            (:id, :session_id, :rule, :output, 'flagged', 'pending')
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "session_id": session_id,
                        "rule": f"low_faithfulness:{faithfulness_score:.2f}",
                        "output": answer[:500],
                    },
                )
                await db.commit()
            logger.info(
                "[hallucination] layer3 낮은 faithfulness=%.2f 기록: session=%s",
                faithfulness_score,
                session_id,
            )

    except Exception as exc:
        logger.warning("[hallucination] layer3 실패: %s", exc)
