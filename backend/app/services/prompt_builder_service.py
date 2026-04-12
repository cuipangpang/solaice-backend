"""
프롬프트 빌더 서비스.
(system_prompt, messages_list) 반환.
messages_list는 Qwen API에 바로 전달 가능한 완전한 messages 배열.

v4 변경:
- mode 파라미터 추가: "fast" (3턴, 간결) | "thinking" (6턴, CoT)
- tool_results 파라미터 추가: 웹 검색 결과 텍스트 블록
- structured_facts 파라미터 추가: 장기 기억 필수 정보 system 시작 부분에 우선 주입
- 기존 mode 미지정 호출은 기존 SYSTEM_TEMPLATE 사용 (하위 호환)
"""

PREFIX_ANCHOR = """당신은 반려동물 건강 전문 AI 솔레이스입니다.
반려동물의 건강과 행복을 최우선으로 생각하며,
정확하고 따뜻한 의료 정보를 제공합니다."""

# ── 기존 템플릿 (하위 호환, mode 미지정 시 사용) ─────────────────────────────
SYSTEM_TEMPLATE = """당신은 전문 반려동물 건강 상담 AI, '멍냥닥터'입니다.

【반려동물 정보】
이름: {name} | 종류: {species} | 나이: {age}살
병력: {medical_history} | 알레르기: {allergies}

【장기 기억 요약】
{long_term_str}

【수의학 지식 참고】
{rag_str}

【대화 단계】 현재: {stage} | 진행 턴: {turn_count}턴

{stage_instruction}

【출력 언어】 {lang_instruction}"""

# ── Fast 모드 템플릿 (목표 지연시간 3초 이하) ─────────────────────────────────
FAST_SYSTEM_TEMPLATE = """{structured_facts_block}{prefix}

【반려동물 정보】
이름: {name} | 종류: {species} | 나이: {age}살

{stage_instruction}

【출력 언어】 {lang_instruction}
핵심만 간결하게 100자 이내로 답변해줘."""

# Fast 모드 user 메시지에 RAG 주입용 템플릿
FAST_USER_TEMPLATE = """【수의학 지식 참고 (top-3)】
{rag_str}

{query}"""

# ── Thinking 모드 템플릿 (깊은 분석, CoT) ────────────────────────────────────
THINKING_SYSTEM_TEMPLATE = """{structured_facts_block}{prefix}

【반려동물 정보】
이름: {name} | 종류: {species} | 나이: {age}살
병력: {medical_history} | 알레르기: {allergies}

【장기 기억 요약】
{long_term_str}

【수의학 지식 참고】
{rag_str}

{tool_results_block}【대화 단계】 현재: {stage} | 진행 턴: {turn_count}턴

{stage_instruction}

【분석 지시 (CoT)】
다음 단계로 분석해줘:
1단계: 증상 및 상황 파악
2단계: 가능한 원인 추론 (최소 2개)
3단계: 긴급도 판단 (normal/caution/visit/emergency)
4단계: 구체적 행동 권고
진단 응답 JSON에 "confidence": "high|medium|low" 필드를 포함해줘.

【출력 언어】 {lang_instruction}"""

# ── 단계 지시문 (기존 그대로) ─────────────────────────────────────────────────
_STAGE_QUESTIONING = """현재 정보 수집 단계입니다. 매 답변에서 가장 중요한 추가 질문 하나만 하고,
간단한 초기 안심 멘트를 함께 제공하세요.
아직 진단 결론을 내리지 마세요. 출력 형식: 일반 텍스트."""

_STAGE_DIAGNOSIS = """현재 진단 단계입니다. 수집된 증상을 바탕으로 구조화된 진단을 제공하세요.
반드시 유효한 JSON을 출력하세요 (```json 마크 없이), 형식은 다음과 같습니다:
{"urgency":"green|orange|red","primary_diagnosis":"...","symptoms":["..."],
 "action_plan":"...","home_care":"...","follow_up_questions":["..."],
 "rag_sources":["..."]}
JSON 내 모든 텍스트 값은 한국어로 작성하세요."""

_STAGE_CHAT = """일반 대화 단계입니다. 반려동물 건강에 관한 질문에 친절하고 자연스럽게 답변하세요.
출력 형식: 반드시 일반 텍스트로만 답변하세요. JSON 형식으로 절대 응답하지 마세요.
이전 대화에서 진단 보고서(JSON)가 있었더라도 지금은 자연스러운 대화를 이어가세요.
증상 관련 질문이 언급되면 공감하며 추가 정보를 자연스럽게 물어볼 수 있습니다."""


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _format_structured_facts(sf: dict) -> str:
    """
    structured_facts dict → system 시작 부분 주입용 텍스트 블록.
    allergies/diagnosed_conditions/medications 중 하나라도 있을 때만 출력.
    """
    if not sf:
        return ""
    allergies = sf.get("allergies") or []
    conditions = sf.get("diagnosed_conditions") or []
    medications = sf.get("medications") or []
    # 세 필드 모두 비어있어도 항상 주입 (structured_facts 자체가 있으면)
    lines = [
        "⚠️ 필수 정보 (절대 무시 금지):",
        f"알레르기: {', '.join(allergies) if allergies else '없음'}",
        f"확진 질병: {', '.join(conditions) if conditions else '없음'}",
        f"복용 약물: {', '.join(medications) if medications else '없음'}",
        "---\n",
    ]
    return "\n".join(lines)


# ── 메인 함수 ─────────────────────────────────────────────────────────────────

def build_chat_prompt(
    pet_profile: dict,
    long_term_memory: list[dict],
    rag_knowledge: list[dict],
    short_term_history: list[dict],
    rewritten_query: str,
    stage: str,
    turn_count: int,
    intent: str,
    lang: str = "ko",
    image_url: str | None = None,
    mode: str = "fast",
    tool_results: str = "",
    structured_facts: dict | None = None,
) -> tuple[str, list[dict]]:
    """
    (system_prompt, messages_list) 반환.

    mode="fast"     : 최근 3턴(6개 메시지), 100자 간결 답변. 장기기억/tool_results 제외.
    mode="thinking" : 최근 6턴(12개 메시지), CoT 분석, structured_facts/tool_results 포함.
    mode 미지정     : 기존 SYSTEM_TEMPLATE 사용 (하위 호환).
    """

    # ── 공통 포맷 ─────────────────────────────────────────────────────
    rag_str = (
        "\n".join(
            f"- [{item.get('source', '')}] {item.get('content', '')}"
            for item in rag_knowledge
        )
        if rag_knowledge
        else "없음"
    )

    if stage == "diagnosis":
        stage_instruction = _STAGE_DIAGNOSIS
    elif stage in ("chat", "completed"):
        stage_instruction = _STAGE_CHAT
    else:
        stage_instruction = _STAGE_QUESTIONING
    lang_instruction = (
        "Please respond in English." if lang == "en" else "모든 답변은 한국어로 작성하세요."
    )

    # mode별 최근 메시지 수 (user+assistant 각 1개이므로 턴 * 2)
    history_limit = 12 if mode == "thinking" else 6  # 6턴 or 3턴

    # ── system_prompt 생성 ────────────────────────────────────────────
    if mode == "fast":
        sf_block_fast = _format_structured_facts(structured_facts or {})
        system_prompt = FAST_SYSTEM_TEMPLATE.format(
            structured_facts_block=sf_block_fast,
            prefix=PREFIX_ANCHOR,
            name=pet_profile.get("name", "반려동물"),
            species=pet_profile.get("species", ""),
            age=pet_profile.get("age", ""),
            stage_instruction=stage_instruction,
            lang_instruction=lang_instruction,
        )

    elif mode == "thinking":
        sf_block = _format_structured_facts(structured_facts or {})

        long_term_str = (
            "\n".join(
                f"- [{item.get('created_at', '')}] {item.get('summary_text', '')}"
                for item in long_term_memory
            )
            if long_term_memory
            else "없음"
        )

        tool_results_block = f"【웹 검색 결과】\n{tool_results}\n\n" if tool_results else ""

        system_prompt = THINKING_SYSTEM_TEMPLATE.format(
            structured_facts_block=sf_block,
            prefix=PREFIX_ANCHOR,
            name=pet_profile.get("name", "반려동물"),
            species=pet_profile.get("species", ""),
            age=pet_profile.get("age", ""),
            medical_history=pet_profile.get("medical_history") or "없음",
            allergies=pet_profile.get("allergies") or "없음",
            long_term_str=long_term_str,
            rag_str=rag_str,
            tool_results_block=tool_results_block,
            stage=stage,
            turn_count=turn_count,
            stage_instruction=stage_instruction,
            lang_instruction=lang_instruction,
        )

    else:
        # 기존 방식 (하위 호환)
        long_term_str = (
            "\n".join(
                f"- [{item.get('created_at', '')}] {item.get('summary_text', '')}"
                for item in long_term_memory
            )
            if long_term_memory
            else "없음"
        )
        system_prompt = SYSTEM_TEMPLATE.format(
            name=pet_profile.get("name", "반려동물"),
            species=pet_profile.get("species", ""),
            age=pet_profile.get("age", ""),
            medical_history=pet_profile.get("medical_history") or "없음",
            allergies=pet_profile.get("allergies") or "없음",
            long_term_str=long_term_str,
            rag_str=rag_str,
            stage=stage,
            turn_count=turn_count,
            stage_instruction=stage_instruction,
            lang_instruction=lang_instruction,
        )

    # ── messages 배열 구성 ────────────────────────────────────────────
    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    # 단기 기억 히스토리 (mode별 최근 N개 메시지)
    recent = short_term_history[-history_limit:] if short_term_history else []
    for msg in recent:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    # 마지막 사용자 메시지 (멀티모달 지원)
    # fast 모드: RAG를 user 메시지에 주입 (system 메시지 경량화)
    if mode == "fast" and rag_str and rag_str != "없음":
        query_with_rag = FAST_USER_TEMPLATE.format(rag_str=rag_str, query=rewritten_query)
    else:
        query_with_rag = rewritten_query

    if image_url:
        user_content: list[dict] | str = [
            {"type": "image_url", "image_url": {"url": image_url}},
            {"type": "text", "text": query_with_rag},
        ]
    else:
        user_content = query_with_rag

    messages.append({"role": "user", "content": user_content})

    return system_prompt, messages
