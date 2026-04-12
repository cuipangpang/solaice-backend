"""
pet_medical_seed/processed/deduped.json 을 읽어서
knowledge_base 테이블에 데이터를 로드하는 스크립트.

실행: cd backend && python scripts/load_knowledge_base.py
"""

import asyncio
import json
import sys
from pathlib import Path

# 백엔드 루트를 sys.path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))


def extract_texts(item: dict) -> tuple[list[str], str]:
    """
    항목에서 텍스트와 source를 추출.
    반환: (texts, source)

    1순위: conversations[from=gpt].value 추출
    2순위: human+gpt 쌍을 Q/A 형태로 묶어서 추출 (gpt 단독 추출 실패 시)
    """
    texts: list[str] = []

    # ── source 구성 (category > subcategory > animal) ─────────
    source_parts = []
    if item.get("category"):
        source_parts.append(item["category"])
    if item.get("subcategory"):
        source_parts.append(item["subcategory"])
    if item.get("animal"):
        source_parts.append(item["animal"])
    source = " > ".join(source_parts) if source_parts else item.get("source_file", "pet_medical_seed")

    # ── 1순위: gpt 답변 단독 추출 ─────────────────────────────
    if "conversations" in item:
        for conv in item["conversations"]:
            if isinstance(conv, dict) and conv.get("from") == "gpt":
                content = conv.get("value", "")
                if len(content.strip()) > 20:
                    texts.append(content[:600])

    # ── 2순위: human + gpt 쌍으로 추출 ───────────────────────
    if not texts and "conversations" in item:
        human_text = ""
        for conv in item["conversations"]:
            if not isinstance(conv, dict):
                continue
            if conv.get("from") == "human":
                human_text = conv.get("value", "")
            elif conv.get("from") == "gpt":
                gpt_text = conv.get("value", "")
                if human_text and gpt_text and len(gpt_text.strip()) > 10:
                    combined = f"Q: {human_text[:100]}\nA: {gpt_text[:400]}"
                    texts.append(combined)
                human_text = ""

    return [t for t in texts if len(t.strip()) > 10], source


async def load_knowledge_base() -> None:
    # ── 1. 파일 경로 ─────────────────────────────────────────
    project_root = Path(__file__).parent.parent.parent
    json_path = project_root / "pet_medical_seed" / "processed" / "deduped.json"

    if not json_path.exists():
        print(f"❌ 파일 없음: {json_path}")
        print("   pet_medical_seed/processed/deduped.json 을 먼저 생성하세요.")
        return

    print(f"📂 파일 로드: {json_path}")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"📊 총 {len(data)}개 원본 항목")

    # ── 2. 텍스트 추출 ────────────────────────────────────────
    all_texts: list[dict] = []
    for item in data:
        texts, source = extract_texts(item)
        for text in texts:
            all_texts.append({"content": text.strip(), "source": source})

    print(f"📝 추출된 텍스트 조각: {len(all_texts)}개")
    if not all_texts:
        print("⚠️  추출된 텍스트가 없습니다. JSON 구조를 확인하세요.")
        return

    # ── 3. DB 연결 ────────────────────────────────────────────
    from app.database import AsyncSessionLocal
    from app.services.embedding_service import get_embedding
    from sqlalchemy import text

    inserted = 0
    skipped = 0

    # 항목마다 독립 세션 사용 — 한 항목 오류가 다음 항목에 영향 없도록
    for i, item in enumerate(all_texts):
        content = item["content"]
        source = item["source"]
        try:
            async with AsyncSessionLocal() as db:
                # 중복 확인
                dup_result = await db.execute(
                    text("SELECT COUNT(*) FROM knowledge_base WHERE content = :content"),
                    {"content": content},
                )
                if (dup_result.scalar() or 0) > 0:
                    skipped += 1
                    continue

                # 임베딩 생성
                embedding = await get_embedding(content)
                embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

                # 삽입
                await db.execute(
                    text(
                        """INSERT INTO knowledge_base (content, source, embedding)
                           VALUES (:content, :source, CAST(:embedding AS vector))"""
                    ),
                    {"content": content, "source": source, "embedding": embedding_str},
                )
                await db.commit()
                inserted += 1

        except Exception as exc:
            print(f"  ⚠️  항목 스킵 ({exc.__class__.__name__}): {str(exc)[:120]} | {content[:40]}…")
            skipped += 1

        if (i + 1) % 50 == 0 or (i + 1) == len(all_texts):
            pct = (i + 1) / len(all_texts) * 100
            print(f"  진행: {i+1}/{len(all_texts)} ({pct:.1f}%)  삽입:{inserted} 스킵:{skipped}")

    print(f"\n✅ 완료!")
    print(f"   삽입: {inserted}개")
    print(f"   스킵(중복/오류): {skipped}개")


if __name__ == "__main__":
    asyncio.run(load_knowledge_base())
