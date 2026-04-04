"""
메모리 서비스.
- compress_and_archive: 대화 요약 + 임베딩 → conversation_summaries 저장
- emergency_archive: 긴급 상황 → health_records 저장
- log_eval: RAGAS 평가 로그 → eval_logs 저장
- collect_sft_pair: SFT 훈련 데이터 → sft_pairs 저장

모든 함수는 예외 발생 시 로그만 출력, 예외 전파하지 않음.
백그라운드 태스크용으로 설계 — 내부에서 새 DB 세션 생성.

v4 변경:
- _SUMMARY_PROMPT → STRUCTURED_SUMMARY_PROMPT (구조화 JSON 출력)
- compress_and_archive: structured_facts 별도 파싱 후 저장
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"

# ── 구조화 요약 프롬프트 (v4) ─────────────────────────────────────────────────
STRUCTURED_SUMMARY_PROMPT = """다음 대화를 구조화된 요약으로 변환해줘.
반드시 아래 JSON 형식으로만 출력하고 다른 텍스트는 없어야 해:

{{
  "narrative": "2-3문장 자연어 요약",
  "structured_facts": {{
    "allergies": ["확인된 알레르기 목록, 없으면 빈 배열"],
    "diagnosed_conditions": ["확진 질병 목록, 없으면 빈 배열"],
    "medications": ["현재/과거 복용 약물, 없으면 빈 배열"],
    "symptoms_history": ["언급된 증상과 시간, 없으면 빈 배열"],
    "vet_advice": ["수의사 권고사항, 없으면 빈 배열"]
  }},
  "urgency_flags": ["지속 모니터링 필요 항목, 없으면 빈 배열"]
}}

중요: allergies, diagnosed_conditions, medications 는 절대 생략 불가.
내용이 없어도 빈 배열 [] 로 유지.

대화 내용:
{conversation}"""

# ── 기존 프롬프트 (fallback용 보관) ──────────────────────────────────────────
_LEGACY_SUMMARY_PROMPT = """아래 반려동물 건강 상담 대화를 구조화된 요약으로 압축하세요.
반드시 유효한 JSON만 출력하세요 (```json 마크 없이):
{{"pet_name":"...","date":"...","symptoms":["..."],"diagnosis":"...",
  "urgency":"...","actions":["..."],"outcome":"미확인"}}

대화 내용:
{conversation}"""


def _parse_structured_response(raw: str) -> tuple[str, dict]:
    """
    STRUCTURED_SUMMARY_PROMPT 응답을 파싱.
    반환: (narrative_text, structured_facts_dict)
    파싱 실패 시: (raw_text, {})
    """
    try:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start < 0 or end <= start:
            return raw, {}

        data = json.loads(raw[start:end])
        narrative = data.get("narrative", "")
        structured_facts = data.get("structured_facts", {})

        # structured_facts 필수 키 보장
        for key in ("allergies", "diagnosed_conditions", "medications", "symptoms_history", "vet_advice"):
            if key not in structured_facts:
                structured_facts[key] = []

        return narrative or raw, structured_facts

    except (json.JSONDecodeError, Exception) as exc:
        logger.debug("[memory] 구조화 요약 파싱 실패: %s", exc)
        return raw, {}


# ── compress_and_archive ─────────────────────────────────────────────────────

async def compress_and_archive(
    session_id: str,
    pet_id: str,
    turn_range_start: int,
    turn_range_end: int,
) -> None:
    """
    1. conversation_messages에서 turn_range 조회
    2. Qwen 호출로 구조화 요약 생성 (STRUCTURED_SUMMARY_PROMPT)
    3. narrative 텍스트로 임베딩 생성
    4. conversation_summaries 저장 (narrative + structured_facts 별도 컬럼)
    """
    try:
        from app.models.chat_models import ConversationMessage, ConversationSummary
        from app.services.embedding_service import get_embedding
        from sqlalchemy import select
        import uuid as _uuid

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(ConversationMessage)
                .where(
                    ConversationMessage.session_id == _uuid.UUID(session_id),
                    ConversationMessage.turn_index >= turn_range_start,
                    ConversationMessage.turn_index <= turn_range_end,
                )
                .order_by(ConversationMessage.turn_index)
            )
            messages = result.scalars().all()

            if not messages:
                return

            conversation_text = "\n".join(
                f"[{msg.role}] {msg.content}" for msg in messages
            )

            # Qwen 구조화 요약 호출
            narrative_text = conversation_text[:500]  # fallback
            structured_facts: dict = {}

            if QWEN_API_KEY:
                try:
                    async with httpx.AsyncClient(timeout=20.0) as client:
                        resp = await client.post(
                            QWEN_ENDPOINT,
                            headers={
                                "Authorization": f"Bearer {QWEN_API_KEY}",
                                "Content-Type": "application/json",
                            },
                            json={
                                "model": "qwen-plus",
                                "messages": [
                                    {
                                        "role": "user",
                                        "content": STRUCTURED_SUMMARY_PROMPT.format(
                                            conversation=conversation_text
                                        ),
                                    }
                                ],
                                "stream": False,
                                "max_tokens": 500,
                                "temperature": 0.1,
                            },
                        )
                        resp.raise_for_status()
                        raw = resp.json()["choices"][0]["message"]["content"].strip()
                        narrative_text, structured_facts = _parse_structured_response(raw)
                except Exception as exc:
                    logger.warning("[memory] 구조화 요약 Qwen 호출 실패: %s", exc)

            # 임베딩 생성 (narrative 텍스트 기반)
            embedding = await get_embedding(narrative_text)
            embedding_val = embedding if not all(v == 0.0 for v in embedding) else None

            summary = ConversationSummary(
                id=uuid.uuid4(),
                pet_id=_uuid.UUID(pet_id),
                session_id=_uuid.UUID(session_id),
                summary_text=narrative_text,
                embedding=embedding_val,
                structured_facts=structured_facts if structured_facts else None,
                turn_range_start=turn_range_start,
                turn_range_end=turn_range_end,
            )
            db.add(summary)
            await db.commit()
            logger.info(
                "[memory] 구조화 요약 저장 완료: session=%s turns=%d-%d facts_keys=%s",
                session_id, turn_range_start, turn_range_end,
                list(structured_facts.keys()) if structured_facts else [],
            )

    except Exception as exc:
        logger.error("[memory] compress_and_archive 실패: %s", exc)


# ── emergency_archive ─────────────────────────────────────────────────────────

async def emergency_archive(
    session_id: str,
    pet_id: str,
    message_content: str,
    ai_response: dict,
    image_url: str | None,
) -> None:
    """긴급 상황 즉시 health_records 테이블에 저장."""
    try:
        from app.models.health_record import HealthRecord
        import uuid as _uuid

        async with AsyncSessionLocal() as db:
            record = HealthRecord(
                id=uuid.uuid4(),
                pet_id=_uuid.UUID(pet_id),
                module="chat",
                module_label="상담",
                urgency="emergency",
                primary_diagnosis=ai_response.get(
                    "primary_diagnosis", "긴급 상황, 즉시 동물병원 방문 필요"
                ),
                action_plan=ai_response.get(
                    "action_plan", "가장 가까운 동물병원에 즉시 방문하세요"
                ),
                confidence_level="high",
                symptoms=ai_response.get("symptoms", [message_content]),
                image_url=image_url,
                image_key=None,
                embedding=None,
            )
            db.add(record)
            await db.commit()
            logger.info("[memory] 긴급 기록 저장 완료: pet=%s", pet_id)

    except Exception as exc:
        logger.error("[memory] emergency_archive 실패: %s", exc)


# ── log_eval ──────────────────────────────────────────────────────────────────

async def log_eval(
    session_id: str,
    pet_id: str,
    question: str,
    answer: str,
    contexts: list[str],
) -> None:
    """eval_logs 테이블에 저장. RAGAS 점수는 None으로 초기화."""
    try:
        from app.models.chat_models import EvalLog
        import uuid as _uuid

        async with AsyncSessionLocal() as db:
            log = EvalLog(
                id=uuid.uuid4(),
                session_id=_uuid.UUID(session_id) if session_id else None,
                pet_id=_uuid.UUID(pet_id) if pet_id else None,
                question=question,
                answer=answer,
                contexts=contexts,
                faithfulness=None,
                answer_relevancy=None,
                context_recall=None,
            )
            db.add(log)
            await db.commit()

    except Exception as exc:
        logger.error("[memory] log_eval 실패: %s", exc)


# ── collect_sft_pair ──────────────────────────────────────────────────────────

async def collect_sft_pair(
    session_id: str,
    prompt: str,
    response: str,
) -> None:
    """sft_pairs 테이블에 저장, source='auto', quality_score=None."""
    try:
        from app.models.chat_models import SFTPair
        import uuid as _uuid

        async with AsyncSessionLocal() as db:
            pair = SFTPair(
                id=uuid.uuid4(),
                source_session_id=_uuid.UUID(session_id) if session_id else None,
                prompt=prompt,
                response=response,
                quality_score=None,
                source="auto",
            )
            db.add(pair)
            await db.commit()

    except Exception as exc:
        logger.error("[memory] collect_sft_pair 실패: %s", exc)
