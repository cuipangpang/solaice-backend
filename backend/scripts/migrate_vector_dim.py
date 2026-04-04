"""
migrate_vector_dim.py
─────────────────────
vector(1536) → vector(1024) 차원 변경 마이그레이션.

text-embedding-v3 실제 출력 차원이 1024이므로
knowledge_base, conversation_summaries 두 테이블의
embedding 컬럼 타입을 수정.

pgvector는 ALTER COLUMN TYPE을 직접 지원하지 않으므로
컬럼 DROP → ADD 방식 사용 (기존 벡터 데이터 삭제됨).

실행: cd backend && python scripts/migrate_vector_dim.py
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
_backend_dir = _script_dir.parent
load_dotenv(_backend_dir / ".env")

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/solaice_db",
)
ASYNCPG_DSN: str = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

STEPS = [
    # ── knowledge_base ────────────────────────────────────────
    "DROP INDEX IF EXISTS idx_knowledge_base_embedding",
    "ALTER TABLE knowledge_base DROP COLUMN IF EXISTS embedding",
    "ALTER TABLE knowledge_base ADD COLUMN embedding vector(1024)",
    """CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding
       ON knowledge_base USING ivfflat (embedding vector_cosine_ops)
       WITH (lists = 100)""",

    # ── conversation_summaries ────────────────────────────────
    "DROP INDEX IF EXISTS idx_conv_summaries_embedding",
    "ALTER TABLE conversation_summaries DROP COLUMN IF EXISTS embedding",
    "ALTER TABLE conversation_summaries ADD COLUMN embedding vector(1024)",
    """CREATE INDEX IF NOT EXISTS idx_conv_summaries_embedding
       ON conversation_summaries USING ivfflat (embedding vector_cosine_ops)
       WITH (lists = 100)""",

    # ── health_records ────────────────────────────────────────
    "DROP INDEX IF EXISTS idx_health_records_embedding",
    "ALTER TABLE health_records DROP COLUMN IF EXISTS embedding",
    "ALTER TABLE health_records ADD COLUMN embedding vector(1024)",
    """CREATE INDEX IF NOT EXISTS idx_health_records_embedding
       ON health_records USING ivfflat (embedding vector_cosine_ops)
       WITH (lists = 100)""",
]


async def run() -> None:
    print(f"[migrate] DB 연결: {ASYNCPG_DSN[:40]}…")
    conn = await asyncpg.connect(ASYNCPG_DSN)
    try:
        for sql in STEPS:
            label = sql.strip().split("\n")[0][:70]
            try:
                await conn.execute(sql)
                print(f"  ✓ {label}")
            except Exception as exc:
                print(f"  ✗ {label}")
                print(f"    오류: {exc}")
                # 인덱스 생성 실패는 치명적이지 않으므로 계속 진행
                if "ALTER TABLE" in sql or "DROP COLUMN" in sql or "ADD COLUMN" in sql:
                    raise
    finally:
        await conn.close()

    print("\n✅ 벡터 차원 마이그레이션 완료: 1536 → 1024")
    print("   이제 scripts/load_knowledge_base.py 를 다시 실행하세요.")


if __name__ == "__main__":
    asyncio.run(run())
