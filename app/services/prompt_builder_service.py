"""
프롬프트 빌더 서비스.
(system_prompt, messages_list) 반환.
messages_list는 Qwen API에 바로 전달 가능한 완전한 messages 배열.
"""

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

_STAGE_QUESTIONING = """현재 정보 수집 단계입니다. 매 답변에서 가장 중요한 추가 질문 하나만 하고,
간단한 초기 안심 멘트를 함께 제공하세요.
아직 진단 결론을 내리지 마세요. 출력 형식: 일반 텍스트."""

_STAGE_DIAGNOSIS = """현재 진단 단계입니다. 수집된 증상을 바탕으로 구조화된 진단을 제공하세요.
반드시 유효한 JSON을 출력하세요 (```json 마크 없이), 형식은 다음과 같습니다:
{"urgency":"green|orange|red","primary_diagnosis":"...","symptoms":["..."],
 "action_plan":"...","home_care":"...","follow_up_questions":["..."],
 "rag_sources":["..."]}
JSON 내 모든 텍스트 값은 한국어로 작성하세요."""


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
) -> tuple[str, list[dict]]:
    """(system_prompt, messages_list) 반환."""

    # 장기 기억 포맷
    if long_term_memory:
        long_term_str = "\n".join(
            f"- [{item.get('created_at', '')}] {item.get('summary_text', '')}"
            for item in long_term_memory
        )
    else:
        long_term_str = "없음"

    # RAG 지식 포맷
    if rag_knowledge:
        rag_str = "\n".join(
            f"- [{item.get('source', '')}] {item.get('content', '')}"
            for item in rag_knowledge
        )
    else:
        rag_str = "없음"

    # 단계 지시문
    stage_instruction = _STAGE_DIAGNOSIS if stage == "diagnosis" else _STAGE_QUESTIONING

    # 언어 지시문
    if lang == "en":
        lang_instruction = "Please respond in English."
    else:
        lang_instruction = "모든 답변은 한국어로 작성하세요."

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

    # messages 배열 구성
    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    # 단기 기억 히스토리 추가
    for msg in short_term_history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    # 마지막 사용자 메시지 (멀티모달 지원)
    if image_url:
        user_content: list[dict] | str = [
            {"type": "image_url", "image_url": {"url": image_url}},
            {"type": "text", "text": rewritten_query},
        ]
    else:
        user_content = rewritten_query

    messages.append({"role": "user", "content": user_content})

    return system_prompt, messages
