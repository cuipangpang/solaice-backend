"""
엔티티 추출 + 증상 그래프 확장 검색

extract_entities    : 쿼리에서 증상/약물/알레르기 엔티티 추출 (규칙 기반)
expand_query_with_graph : 추출된 엔티티를 symptom_graph로 확장해 검색 쿼리 풍부화
save_entity_mentions : entity_mentions 테이블에 저장 (백그라운드 태스크 패턴)

모든 함수는 실패해도 예외 전파하지 않음 — 메인 플로우 차단 안 함.
"""

import logging
import uuid

logger = logging.getLogger(__name__)

# ── 증상 그래프 시드 데이터 ──────────────────────────────────────────────────
SYMPTOM_GRAPH_SEED: dict[str, dict] = {
    "식욕 저하": {
        "related": ["무기력", "체중 감소", "구토"],
        "causes": ["스트레스", "소화기 질환", "구강 문제", "감염"],
        "urgency_hint": "caution",
    },
    "구토": {
        "related": ["식욕 저하", "복통", "무기력"],
        "causes": ["이물 섭취", "위장염", "췌장염", "중독"],
        "urgency_hint": "visit",
    },
    "귀 긁음": {
        "related": ["머리 흔들기", "귀 냄새", "귀 분비물"],
        "causes": ["귀진드기", "세균성 외이염", "알레르기"],
        "urgency_hint": "caution",
    },
    "혈변": {
        "related": ["복통", "무기력", "식욕 저하"],
        "causes": ["장염", "기생충", "내장 출혈"],
        "urgency_hint": "emergency",
    },
    "피부 발적": {
        "related": ["긁음", "탈모", "딱지"],
        "causes": ["알레르기", "피부염", "기생충"],
        "urgency_hint": "caution",
    },
    "경련": {
        "related": ["의식 소실", "쓰러짐"],
        "causes": ["간질", "저혈당", "중독", "뇌 질환"],
        "urgency_hint": "emergency",
    },
    "기침": {
        "related": ["콧물", "호흡 곤란", "무기력"],
        "causes": ["상기도 감염", "기관지염", "심장병"],
        "urgency_hint": "caution",
    },
    "설사": {
        "related": ["구토", "복통", "식욕 저하"],
        "causes": ["이물 섭취", "식이 과민", "감염성 장염"],
        "urgency_hint": "caution",
    },
    "혈뇨": {
        "related": ["배뇨 곤란", "빈뇨", "무기력"],
        "causes": ["방광염", "요로결석", "신장 질환"],
        "urgency_hint": "visit",
    },
}

# ── 약물 키워드 ───────────────────────────────────────────────────────────────
_MEDICATION_KEYWORDS: list[str] = [
    "항생제", "소염제", "스테로이드", "프레드니손", "아목시실린",
    "메트로니다졸", "이버멕틴", "프라지콴텔", "항진균제", "심장약",
    "혈압약", "인슐린", "진통제", "면역억제제",
]

# ── 알레르기 트리거 키워드 ────────────────────────────────────────────────────
_ALLERGY_TRIGGER_KEYWORDS: list[str] = [
    "알레르기", "두드러기", "가려움", "발진", "음식 알레르기", "아토피",
]


# ── 엔티티 추출 ───────────────────────────────────────────────────────────────

async def extract_entities(query: str, pet_profile: dict) -> dict:
    """
    쿼리 + 반려동물 프로필에서 증상/약물/알레르기 엔티티 추출.
    규칙 기반 (빠름). 실패 시 빈 dict 반환.

    반환: {"symptoms": List[str], "medications": List[str], "allergies": List[str]}
    """
    try:
        symptoms: list[str] = []
        medications: list[str] = []
        allergies: list[str] = []

        # 증상 추출: SYMPTOM_GRAPH_SEED 키 매칭
        for symptom_key in SYMPTOM_GRAPH_SEED:
            if symptom_key in query:
                symptoms.append(symptom_key)

        # 약물 추출
        for med in _MEDICATION_KEYWORDS:
            if med in query:
                medications.append(med)

        # 알레르기 트리거 추출
        for allergy_kw in _ALLERGY_TRIGGER_KEYWORDS:
            if allergy_kw in query:
                allergies.append(allergy_kw)

        # 반려동물 프로필의 기존 알레르기 추가
        known_allergy = (pet_profile.get("allergies") or "").strip()
        if known_allergy and known_allergy not in ("없음", "none", "") and known_allergy not in allergies:
            allergies.append(known_allergy)

        return {
            "symptoms": list(dict.fromkeys(symptoms)),
            "medications": list(dict.fromkeys(medications)),
            "allergies": list(dict.fromkeys(allergies)),
        }

    except Exception as exc:
        logger.warning("[entity] extract_entities 실패: %s", exc)
        return {"symptoms": [], "medications": [], "allergies": []}


# ── 쿼리 확장 ─────────────────────────────────────────────────────────────────

async def expand_query_with_graph(query: str, entities: dict) -> str:
    """
    추출된 증상 엔티티를 symptom_graph로 확장해서 검색 쿼리를 풍부하게.
    예: "식욕 저하" → "식욕 저하 무기력 구토 소화기 스트레스"
    실패 시 원본 쿼리 그대로 반환.
    """
    try:
        symptoms = entities.get("symptoms", [])
        if not symptoms:
            return query

        extra_terms: list[str] = []
        for symptom in symptoms:
            node = SYMPTOM_GRAPH_SEED.get(symptom, {})
            # 관련 증상 최대 2개 + 원인 최대 2개
            extra_terms.extend(node.get("related", [])[:2])
            extra_terms.extend(node.get("causes", [])[:2])

        if not extra_terms:
            return query

        # 쿼리에 없는 항목만, 최대 6개 추가
        unique_extras = list(dict.fromkeys(
            t for t in extra_terms if t not in query
        ))[:6]

        return (query + " " + " ".join(unique_extras)).strip()

    except Exception as exc:
        logger.warning("[entity] expand_query_with_graph 실패: %s", exc)
        return query


# ── 엔티티 저장 ───────────────────────────────────────────────────────────────

async def save_entity_mentions(
    pet_id: str,
    session_id: str,
    entities: dict,
    turn_index: int,
) -> None:
    """
    entity_mentions 테이블에 저장.
    내부에서 새 DB 세션 생성 — 백그라운드 태스크로 사용 가능.
    실패해도 예외 전파하지 않음.
    """
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text

        rows: list[dict] = []
        for entity_type, values in entities.items():
            if not isinstance(values, list):
                continue
            for value in values:
                if not value:
                    continue
                rows.append({
                    "id": str(uuid.uuid4()),
                    "pet_id": pet_id,
                    "session_id": session_id,
                    "entity_type": entity_type,
                    "value": str(value),
                    "turn_index": turn_index,
                })

        if not rows:
            return

        async with AsyncSessionLocal() as db:
            for row in rows:
                await db.execute(
                    text(
                        """
                        INSERT INTO entity_mentions
                            (id, pet_id, session_id, entity_type, value, turn_index)
                        VALUES
                            (:id, :pet_id::uuid, :session_id, :entity_type, :value, :turn_index)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    row,
                )
            await db.commit()
            logger.debug("[entity] %d개 엔티티 저장: session=%s", len(rows), session_id)

    except Exception as exc:
        logger.warning("[entity] save_entity_mentions 실패: %s", exc)
