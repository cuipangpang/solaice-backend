"""
pet_medical_seed/processed/deduped.json 을 읽어서
knowledge_base 테이블에 데이터를 로드하는 스크립트.

실행:
  cd backend && python scripts/load_knowledge_base.py           # 중복 스킵
  cd backend && python scripts/load_knowledge_base.py --force  # TRUNCATE 후 전체 재삽입
"""

import asyncio
import json
import sys
from pathlib import Path

# 백엔드 루트를 sys.path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

FORCE_RELOAD = "--force" in sys.argv


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

    # ── 3-1. 현재 DB 상태 진단 ───────────────────────────────
    async with AsyncSessionLocal() as db:
        count_result = await db.execute(text("SELECT COUNT(*) FROM knowledge_base"))
        total_rows = count_result.scalar() or 0
        print(f"\n🗄️  현재 knowledge_base 행 수: {total_rows}")

        if all_texts:
            first_content = all_texts[0]["content"]
            dup_check = await db.execute(
                text("SELECT COUNT(*) FROM knowledge_base WHERE content = :content"),
                {"content": first_content},
            )
            dup_count = dup_check.scalar() or 0
            print(f"🔍 첫 번째 항목 중복 여부: {dup_count}개 존재")
            print(f"   내용 미리보기: {first_content[:80]}…")

    # ── 3-2. --force: TRUNCATE 후 재삽입 ────────────────────
    if FORCE_RELOAD:
        print("\n⚠️  --force 옵션: knowledge_base TRUNCATE 후 전체 재삽입합니다.")
        async with AsyncSessionLocal() as db:
            await db.execute(text("TRUNCATE TABLE knowledge_base"))
            await db.commit()
        print("✅ TRUNCATE 완료\n")
    else:
        if total_rows > 0:
            print(
                f"\n💡 힌트: DB에 이미 {total_rows}개 행 존재."
                " 전체 재삽입하려면 --force 옵션을 추가하세요.\n"
            )

    # ── 4. 항목별 독립 세션으로 삽입 ─────────────────────────
    inserted = 0
    skipped = 0
    zero_vector_count = 0

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

                # zero vector 감지 — embedding API 실패 신호
                if all(v == 0.0 for v in embedding[:10]):
                    zero_vector_count += 1
                    print(f"  ⚠️  zero vector 감지, 스킵: {content[:60]}…")
                    skipped += 1
                    continue

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
    if zero_vector_count:
        print(f"   ⚠️  zero vector 감지: {zero_vector_count}개 — embedding API 상태를 확인하세요.")


if __name__ == "__main__":
    asyncio.run(load_knowledge_base())
