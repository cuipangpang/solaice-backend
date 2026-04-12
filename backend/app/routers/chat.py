"""
다중 턴 AI 상담 라우터.
prefix: /api/v1/chat (main.py에서 등록)

엔드포인트:
  POST /session               — 세션 생성
  POST /message               — 메시지 전송 (SSE 스트리밍)
  GET  /session/{session_id}/history — 대화 기록 조회
  DELETE /session/{session_id}       — 세션 종료
  GET  /sessions/{pet_id}            — 반려동물 세션 목록
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.models.chat_models import ConversationMessage, ConversationSession
from app.models.pet_profile import PetProfile
from app.schemas.chat_schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    MessageResponse,
    SendMessageRequest,
    SessionListItem,
)
from app.schemas.response import APIResponse
from app.services import (
    context_service,
    entity_service,
    hallucination_service,
    intent_service,
    memory_service,
    prompt_builder_service,
    query_rewrite_service,
    rag_service,
    redis_service,
    web_search_service,
)

logger = logging.getLogger(__name__)

router = APIRouter()

QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "")
QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
CHAT_MAX_TURNS: int = int(os.getenv("CHAT_MAX_TURNS", "20"))
CHAT_SUMMARY_INTERVAL: int = int(os.getenv("CHAT_SUMMARY_INTERVAL", "5"))


# ── POST /session ─────────────────────────────────────────────

@router.post("/session", response_model=APIResponse[CreateSessionResponse], status_code=201)
async def create_session(
    request: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    """새 대화 세션 생성, Redis 초기화."""
    session_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    session = ConversationSession(
        id=session_id,
        pet_id=uuid.UUID(request.pet_id),
        turn_count=0,
        stage="questioning",
        lang="ko",
        is_active=True,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Redis 세션 상태 초기화
    await redis_service.set_session_state(
        str(session_id),
        {
            "turn_count": "0",
            "stage": "questioning",
            "lang": "ko",
            "last_updated": now.isoformat(),
        },
    )

    return APIResponse.ok(
        CreateSessionResponse(
            session_id=str(session.id),
            pet_id=str(session.pet_id),
            created_at=session.created_at.isoformat() if session.created_at else now.isoformat(),
            stage=session.stage,
            turn_count=session.turn_count,
        )
    )


# ── POST /message (SSE) ───────────────────────────────────────

@router.post("/message")
async def send_message(
    request: SendMessageRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    SSE 스트리밍 응답.
    데이터 형식:
      토큰:   data: {"type":"token","content":"<단일토큰>"}\n\n
      완료:   data: {"type":"done","reply":<str|dict>,"stage":"...","turn":<int>,"rag_sources":[...],"urgency":...}\n\n
      오류:   data: {"type":"error","message":"<오류메시지>"}\n\n
    """
    # ── 사전 처리: 스트리밍 전에 모든 DB/Redis 작업 완료 ───────────────
    try:
        # Step 1: Redis 상태 읽기
        chat_history = await redis_service.get_chat_history(request.pet_id, request.session_id)
        session_state = await redis_service.get_session_state(request.session_id)
        if not session_state:
            session_state = {"turn_count": "0", "stage": "questioning", "lang": "ko"}

        turn_count = int(session_state.get("turn_count", 0))
        stage = session_state.get("stage", "questioning")
        lang = session_state.get("lang", "ko")
        cycle_start_turn = int(session_state.get("cycle_start_turn", "0"))

        # Step 2: 의도 분류 (<1ms)
        intent_result = await intent_service.classify_intent(request.content, chat_history)
        intent = intent_result["intent"]

        # Step 3: greeting 빠른 경로 데이터 준비
        is_greeting = intent == "greeting"

        # Step 4: 쿼리 재작성
        rewritten_query = request.content
        hyde_text: str = ""
        pet_ctx: dict = {}  # 엔티티 추출에도 사용
        if not intent_result.get("skip_rewrite") and len(chat_history) > 0:
            pet_row = await db.get(PetProfile, uuid.UUID(request.pet_id))
            pet_ctx = {
                "pet_name": pet_row.name if pet_row else "반려동물",
                "species": pet_row.species if pet_row else "",
                "age": str(pet_row.age_years) if pet_row and pet_row.age_years else "",
                "allergies": pet_row.allergies if pet_row else "",
            }
            rewritten_query, hyde_text = await query_rewrite_service.rewrite_query(
                request.content, chat_history, request.session_id, pet_ctx
            )

        # Step 4.5: 엔티티 추출 + 쿼리 확장 (실패해도 기존 쿼리 사용)
        entities: dict = {"symptoms": [], "medications": [], "allergies": []}
        try:
            entities = await entity_service.extract_entities(request.content, pet_ctx)
            rewritten_query = await entity_service.expand_query_with_graph(rewritten_query, entities)
        except Exception as _entity_exc:
            logger.warning("[chat] 엔티티 추출/확장 실패: %s", _entity_exc)

        # Step 5: 컨텍스트 + RAG 병렬 조회
        need_rag = intent_result["need_rag"]
        if need_rag and not is_greeting:
            full_context, rag_results = await asyncio.gather(
                context_service.get_full_context(
                    request.pet_id, request.session_id, rewritten_query, db
                ),
                rag_service.retrieve_knowledge(rewritten_query, hyde_text=hyde_text or None),
            )
        else:
            pet_row_data = await db.get(PetProfile, uuid.UUID(request.pet_id))
            full_context = {
                "pet_profile": {
                    "name": pet_row_data.name if pet_row_data else "반려동물",
                    "species": pet_row_data.species if pet_row_data else "",
                    "age": str(pet_row_data.age_years) if pet_row_data and pet_row_data.age_years else "",
                    "medical_history": pet_row_data.medical_history if pet_row_data else "",
                    "allergies": pet_row_data.allergies if pet_row_data else "",
                } if pet_row_data else {},
                "short_term_memory": chat_history,
                "long_term_memory": [],
                "structured_facts": {},
            }
            rag_results = []

        # Step 5.5: Web 검색 (Thinking 모드 + 시효성 질문일 때만)
        web_results = ""
        if request.mode == "thinking" and web_search_service.is_temporal_query(rewritten_query):
            web_results = await web_search_service.search_web(rewritten_query, db)
            if web_results:
                logger.info("[chat] Web 검색 결과 포함: %d자", len(web_results))

        # Step 6: turn + stage 결정 (의도 및 현재 stage 기반)
        new_turn_count = turn_count + 1
        new_cycle_start_turn = cycle_start_turn  # 기본값: 변경 없음

        if intent == "greeting":
            # 인사 → 일반 대화 모드
            new_stage = "chat"
        elif stage in ("completed", "chat", "diagnosis"):
            # 진단 완료 / 일반 대화 / 진단 후 재방문 — intent 기반 재판단
            # "diagnosis" 포함: follow_up_questions가 있어 completed로 전환 안 된 경우도 처리
            if intent == "veterinary":
                # 구체적 수의학 증상 언급 → 새 진단 사이클 시작
                new_stage = "questioning"
                new_cycle_start_turn = new_turn_count  # 사이클 리셋
            else:
                # greeting/general/기타 → chat 리셋 (JSON 보고서 출력 방지)
                new_stage = "chat"
        else:
            # questioning 단계: cycle 기준 4턴 후 진단
            cycle_turns = new_turn_count - cycle_start_turn
            new_stage = "diagnosis" if cycle_turns >= 4 else "questioning"

        # structured_facts (context_service v4에서 반환)
        structured_facts = full_context.get("structured_facts", {})

        # Step 7: 프롬프트 구성 (greeting 아닐 때)
        if not is_greeting:
            _system_prompt, messages = prompt_builder_service.build_chat_prompt(
                pet_profile=full_context["pet_profile"],
                long_term_memory=full_context["long_term_memory"],
                rag_knowledge=rag_results,
                short_term_history=full_context["short_term_memory"],
                rewritten_query=rewritten_query,
                stage=new_stage,
                turn_count=new_turn_count,
                intent=intent,
                lang=lang,
                image_url=request.image_url,
                mode=request.mode,
                structured_facts=structured_facts,
                tool_results=web_results,
            )
        else:
            messages = None

    except Exception as setup_exc:
        logger.error("[chat] send_message 사전처리 실패: %s", setup_exc)
        is_greeting = False
        messages = None
        new_turn_count = 1
        new_stage = "questioning"
        new_cycle_start_turn = 0
        rag_results = []
        web_results = ""
        setup_exc_msg = str(setup_exc)

        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'message': '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'}, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── SSE 스트리밍 제너레이터 ─────────────────────────────────
    async def generate():
        nonlocal new_turn_count, new_stage, new_cycle_start_turn

        try:
            # greeting 빠른 경로
            if is_greeting:
                greeting_reply = "안녕하세요! 반려동물 건강에 관해 궁금한 점이 있으신가요? 😊"
                for char in greeting_reply:
                    yield f"data: {json.dumps({'type': 'token', 'content': char}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'reply': greeting_reply, 'stage': stage, 'turn': turn_count, 'rag_sources': [], 'urgency': None}, ensure_ascii=False)}\n\n"
                return

            # Qwen 스트리밍 API 호출
            full_response = ""
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream(
                    "POST",
                    QWEN_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {QWEN_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "qwen-vl-max",
                        "messages": messages,
                        "stream": True,
                        "max_tokens": 1000,
                    },
                ) as response:
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:]
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                            delta = chunk["choices"][0]["delta"].get("content", "")
                            if delta:
                                full_response += delta
                                yield f"data: {json.dumps({'type': 'token', 'content': delta}, ensure_ascii=False)}\n\n"
                        except (json.JSONDecodeError, KeyError):
                            continue

            # 결과 파싱
            urgency = None
            reply_data: str | dict = full_response
            if new_stage == "diagnosis" and full_response.strip().startswith("{"):
                try:
                    match_start = full_response.find("{")
                    match_end = full_response.rfind("}") + 1
                    if match_start >= 0 and match_end > match_start:
                        reply_data = json.loads(full_response[match_start:match_end])
                        urgency = reply_data.get("urgency")  # type: ignore[union-attr]
                except json.JSONDecodeError:
                    reply_data = full_response

            # 진단 완료 감지: primary_diagnosis 있고 follow_up_questions 없으면 → "completed"
            if isinstance(reply_data, dict) and reply_data.get("primary_diagnosis"):
                if not reply_data.get("follow_up_questions"):
                    new_stage = "completed"

            # ── 환각 감지 Layer 1 (동기, <5ms) ────────────────────────
            try:
                h1 = await hallucination_service.layer1_rule_check(full_response, urgency)
                if h1["triggered"]:
                    if h1["action"] == "append_disclaimer":
                        # 면책 문구 추가 — reply_data에 반영
                        full_response = h1["modified_text"]
                        if isinstance(reply_data, str):
                            reply_data = full_response
                    logger.info(
                        "[chat] hallucination layer1: rule=%s action=%s",
                        h1["rule_name"], h1["action"],
                    )
            except Exception as _h1_exc:
                logger.debug("[chat] hallucination layer1 오류: %s", _h1_exc)

            # ── 환각 감지 Layer 2 (LLM, visit/emergency 시만) ──────────
            if urgency in ("visit", "emergency", "orange", "red"):
                try:
                    rag_ctx_str = " ".join(r.get("content", "") for r in rag_results)
                    h2_ok = await hallucination_service.layer2_llm_selfcheck(
                        full_response, rag_ctx_str
                    )
                    if not h2_ok:
                        logger.warning("[chat] hallucination layer2 FAIL: session=%s", request.session_id)
                except Exception as _h2_exc:
                    logger.debug("[chat] hallucination layer2 오류: %s", _h2_exc)

            # ── 환각 감지 Layer 3 (비차단 비동기) ─────────────────────
            asyncio.create_task(
                hallucination_service.layer3_async_faithfulness(
                    session_id=request.session_id,
                    question=request.content,
                    answer=full_response,
                    contexts=[r.get("content", "") for r in rag_results],
                )
            )

            # ── 엔티티 저장 (비차단 비동기) ───────────────────────────
            if entities.get("symptoms") or entities.get("medications") or entities.get("allergies"):
                asyncio.create_task(
                    entity_service.save_entity_mentions(
                        pet_id=request.pet_id,
                        session_id=request.session_id,
                        entities=entities,
                        turn_index=new_turn_count,
                    )
                )

            # 영속화 — 백그라운드 태스크
            user_msg = {
                "role": "user",
                "content": request.content,
                "turn_index": new_turn_count,
                "image_url": request.image_url,
            }
            ai_content = (
                full_response
                if isinstance(reply_data, str)
                else json.dumps(reply_data, ensure_ascii=False)
            )
            ai_msg = {
                "role": "assistant",
                "content": ai_content,
                "turn_index": new_turn_count,
                "image_url": None,
            }

            background_tasks.add_task(
                _persist_message_and_update,
                session_id=request.session_id,
                pet_id=request.pet_id,
                user_msg=user_msg,
                ai_msg=ai_msg,
                turn_count=new_turn_count,
                stage=new_stage,
                lang=lang,
                cycle_start_turn=new_cycle_start_turn,
            )

            # 긴급 상황 아카이브
            if urgency == "red" or intent == "emergency":
                background_tasks.add_task(
                    memory_service.emergency_archive,
                    session_id=request.session_id,
                    pet_id=request.pet_id,
                    message_content=request.content,
                    ai_response=reply_data if isinstance(reply_data, dict) else {},
                    image_url=request.image_url,
                )

            # 주기적 요약 압축
            if new_turn_count % CHAT_SUMMARY_INTERVAL == 0:
                background_tasks.add_task(
                    memory_service.compress_and_archive,
                    session_id=request.session_id,
                    pet_id=request.pet_id,
                    turn_range_start=new_turn_count - CHAT_SUMMARY_INTERVAL + 1,
                    turn_range_end=new_turn_count,
                )

            # eval 로그
            background_tasks.add_task(
                memory_service.log_eval,
                session_id=request.session_id,
                pet_id=request.pet_id,
                question=request.content,
                answer=full_response,
                contexts=[r.get("content", "") for r in rag_results],
            )

            rag_sources = [r.get("source", "") for r in rag_results]
            yield f"data: {json.dumps({'type': 'done', 'reply': reply_data, 'stage': new_stage, 'turn': new_turn_count, 'rag_sources': rag_sources, 'urgency': urgency}, ensure_ascii=False)}\n\n"

        except Exception as exc:
            logger.error("[chat] generate 오류: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': '응답 생성 중 오류가 발생했습니다. 다시 시도해 주세요.'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 백그라운드: Redis + DB 영속화 ─────────────────────────────

async def _persist_message_and_update(
    session_id: str,
    pet_id: str,
    user_msg: dict,
    ai_msg: dict,
    turn_count: int,
    stage: str,
    lang: str,
    cycle_start_turn: int = 0,
) -> None:
    """Redis + PostgreSQL 동시 저장, 세션 상태 업데이트."""
    try:
        # Redis 업데이트 (병렬)
        await asyncio.gather(
            redis_service.append_chat_message(pet_id, session_id, user_msg),
            redis_service.append_chat_message(pet_id, session_id, ai_msg),
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        await redis_service.set_session_state(
            session_id,
            {
                "turn_count": str(turn_count),
                "stage": stage,
                "lang": lang,
                "cycle_start_turn": str(cycle_start_turn),
                "last_updated": now_iso,
            },
        )

        # PostgreSQL 업데이트
        async with AsyncSessionLocal() as db:
            # conversation_messages 2건 삽입
            for msg in (user_msg, ai_msg):
                row = ConversationMessage(
                    id=uuid.uuid4(),
                    session_id=uuid.UUID(session_id),
                    pet_id=uuid.UUID(pet_id),
                    role=msg["role"],
                    content=msg["content"],
                    image_url=msg.get("image_url"),
                    turn_index=msg["turn_index"],
                )
                db.add(row)

            # conversation_sessions 업데이트
            result = await db.execute(
                select(ConversationSession).where(
                    ConversationSession.id == uuid.UUID(session_id)
                )
            )
            session_row = result.scalar_one_or_none()
            if session_row:
                session_row.turn_count = turn_count
                session_row.stage = stage

            await db.commit()

    except Exception as exc:
        logger.error("[chat] _persist_message_and_update 실패: %s", exc)


# ── GET /session/{session_id}/history ────────────────────────

@router.get(
    "/session/{session_id}/history",
    response_model=APIResponse[list[MessageResponse]],
)
async def get_history(session_id: str, db: AsyncSession = Depends(get_db)):
    """conversation_messages 조회, turn_index ASC 정렬."""
    result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.session_id == uuid.UUID(session_id))
        .order_by(ConversationMessage.turn_index)
    )
    messages = result.scalars().all()
    return APIResponse.ok(
        [
            MessageResponse(
                id=str(msg.id),
                session_id=str(msg.session_id),
                role=msg.role,
                content=msg.content,
                image_url=msg.image_url,
                turn_index=msg.turn_index,
                created_at=msg.created_at.isoformat() if msg.created_at else "",
            )
            for msg in messages
        ]
    )


# ── DELETE /session/{session_id} ─────────────────────────────

@router.delete("/session/{session_id}", response_model=APIResponse[dict])
async def close_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """세션 비활성화 + 최종 요약 아카이빙 트리거."""
    result = await db.execute(
        select(ConversationSession).where(
            ConversationSession.id == uuid.UUID(session_id)
        )
    )
    session_row = result.scalar_one_or_none()
    if not session_row:
        return APIResponse.fail("NOT_FOUND", "세션을 찾을 수 없습니다")

    session_row.is_active = False
    await db.commit()

    # 마지막 요약 트리거 (최소 2턴 이상일 때)
    if session_row.turn_count >= 2:
        background_tasks.add_task(
            memory_service.compress_and_archive,
            session_id=session_id,
            pet_id=str(session_row.pet_id),
            turn_range_start=max(1, session_row.turn_count - CHAT_SUMMARY_INTERVAL + 1),
            turn_range_end=session_row.turn_count,
        )

    return APIResponse.ok({"closed": True, "session_id": session_id})


# ── GET /sessions/{pet_id} ───────────────────────────────────

@router.get(
    "/sessions/{pet_id}",
    response_model=APIResponse[list[SessionListItem]],
)
async def list_sessions(pet_id: str, db: AsyncSession = Depends(get_db)):
    """반려동물의 최근 20개 세션, created_at DESC."""
    result = await db.execute(
        select(ConversationSession)
        .where(ConversationSession.pet_id == uuid.UUID(pet_id))
        .order_by(ConversationSession.created_at.desc())
        .limit(20)
    )
    sessions = result.scalars().all()
    return APIResponse.ok(
        [
            SessionListItem(
                session_id=str(s.id),
                pet_id=str(s.pet_id),
                turn_count=s.turn_count,
                stage=s.stage,
                is_active=s.is_active,
                created_at=s.created_at.isoformat() if s.created_at else "",
                updated_at=s.updated_at.isoformat() if s.updated_at else "",
            )
            for s in sessions
        ]
    )
