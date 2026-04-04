"""
의도 분류 서비스.
순수 키워드 규칙, 모델 호출 없음, 목표 응답시간 < 1ms.
우선순위: emergency > mental_health > translation > greeting > veterinary > general
"""

# ── 긴급 키워드 ────────────────────────────────────────────────
EMERGENCY_KEYWORDS: list[str] = [
    # 한국어
    "경련", "발작", "실신", "의식불명", "대량출혈", "호흡곤란",
    "골절", "중독", "쇼크", "질식", "마비", "심정지",
    "쓰러졌", "쓰러져", "움직이지 않", "숨을 못", "피를 많이",
    "갑자기 쓰러", "눈이 풀려", "입에 거품",
    # 영어
    "convulsion", "unconscious", "difficulty breathing",
    "poisoning", "seizure", "not moving", "collapsed",
]

# ── 정신 건강 키워드 ────────────────────────────────────────────
MENTAL_HEALTH_KEYWORDS: list[str] = [
    "너무 걱정", "너무 슬퍼", "무너질 것 같", "잃으면", "감당이 안",
    "힘들어요", "괜찮을까요", "많이 힘들", "마음이 아파",
    "어떡하죠", "어떻게 해야", "너무 무서워", "불안해요",
]

# ── 번역 키워드 ────────────────────────────────────────────────
TRANSLATION_KEYWORDS: list[str] = [
    "번역", "translate", "영어로", "한국어로", "일본어로",
    "중국어로", "영어로 말해", "한국어로 바꿔",
]

# ── 인사 키워드 ────────────────────────────────────────────────
GREETING_KEYWORDS: list[str] = [
    "안녕", "안녕하세요", "안녕히", "감사합니다", "감사해요", "고마워요",
    "수고하세요", "네", "알겠습니다", "알겠어요", "이해했어요",
    "맞아요", "그렇군요", "아 네", "오케이", "ㅎㅎ", "ㅋㅋ",
    "hi", "hello", "thanks", "ok", "okay", "bye", "thank you",
]

# ── 수의학 키워드 ───────────────────────────────────────────────
VETERINARY_KEYWORDS: list[str] = [
    "증상", "아파요", "아프", "아픈 것 같", "먹지 않", "안 먹",
    "토했", "구토", "설사", "변비", "혈변", "혈뇨",
    "발열", "열이", "기침", "콧물", "눈곱", "눈물",
    "귀", "발", "털", "피부", "가려워", "긁어",
    "체중", "살이 빠", "살이 쪄", "활기", "기운이 없",
    "병원", "치료", "약", "검사", "수술", "백신", "접종",
    "심장", "신장", "간", "방광", "위장", "췌장",
    "다리", "관절", "눈", "이빨", "잇몸",
    "소변", "대변", "음식", "사료", "간식",
    "상처", "피", "부어", "붓고", "뭔가 났", "혹",
]


def _contains_any(text: str, keywords: list[str]) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in keywords)


async def classify_intent(query: str, chat_history: list[dict]) -> dict:
    """
    우선순위: emergency > mental_health > translation > greeting > veterinary > general

    반환:
    {
      "intent": "greeting" | "veterinary" | "general" | "emergency" | "mental_health" | "translation",
      "need_rag": bool,
      "urgency_hint": "normal" | "caution" | "emergency",
      "skip_rewrite": bool
    }
    """
    # 1. 긴급
    if _contains_any(query, EMERGENCY_KEYWORDS):
        return {
            "intent": "emergency",
            "need_rag": False,
            "urgency_hint": "emergency",
            "skip_rewrite": True,
        }

    # 2. 정신 건강
    if _contains_any(query, MENTAL_HEALTH_KEYWORDS):
        return {
            "intent": "mental_health",
            "need_rag": False,
            "urgency_hint": "normal",
            "skip_rewrite": True,
        }

    # 3. 번역
    if _contains_any(query, TRANSLATION_KEYWORDS):
        return {
            "intent": "translation",
            "need_rag": False,
            "urgency_hint": "normal",
            "skip_rewrite": True,
        }

    # 4. 인사 (짧은 문장 한정)
    if len(query.strip()) <= 20 and _contains_any(query, GREETING_KEYWORDS):
        return {
            "intent": "greeting",
            "need_rag": False,
            "urgency_hint": "normal",
            "skip_rewrite": True,
        }

    # 5. 수의학
    if _contains_any(query, VETERINARY_KEYWORDS):
        return {
            "intent": "veterinary",
            "need_rag": True,
            "urgency_hint": "caution",
            "skip_rewrite": False,
        }

    # 6. 일반
    return {
        "intent": "general",
        "need_rag": True,
        "urgency_hint": "normal",
        "skip_rewrite": False,
    }
