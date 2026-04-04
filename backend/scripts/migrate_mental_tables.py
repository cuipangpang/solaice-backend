"""
migrate_mental_tables.py
────────────────────────
독립 마이그레이션 스크립트: 정신 건강 모듈 테이블 생성.
Alembic 미사용 — migrate_chat_tables.py 스타일 유지.

사용법 (backend/ 디렉터리에서):
    python scripts/migrate_mental_tables.py
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent   # backend/scripts/
_backend_dir = _script_dir.parent               # backend/
load_dotenv(_backend_dir / ".env")

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/solaice_db",
)
ASYNCPG_DSN: str = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

# ─────────────────────────────────────────────
#  DDL
# ─────────────────────────────────────────────
DDL_STATEMENTS: list[str] = [
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',

    # ── 1. pet_mental_profiles ───────────────
    """
    CREATE TABLE IF NOT EXISTS pet_mental_profiles (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id              UUID NOT NULL UNIQUE REFERENCES pet_profiles(id) ON DELETE CASCADE,
        intimacy_score      FLOAT NOT NULL DEFAULT 0.0,
        mental_health_score FLOAT NOT NULL DEFAULT 50.0,
        mood_today          VARCHAR(50),
        total_interactions  INTEGER NOT NULL DEFAULT 0,
        games_played        INTEGER NOT NULL DEFAULT 0,
        last_interaction_at TIMESTAMPTZ,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 2. intimacy_records ──────────────────
    """
    CREATE TABLE IF NOT EXISTS intimacy_records (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id      UUID NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
        delta       FLOAT NOT NULL,
        reason      VARCHAR(100) NOT NULL,
        total_after FLOAT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 3. interaction_logs ──────────────────
    """
    CREATE TABLE IF NOT EXISTS interaction_logs (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id           UUID NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
        profile_id       UUID REFERENCES pet_mental_profiles(id) ON DELETE SET NULL,
        interaction_type VARCHAR(50) NOT NULL,
        game_key         VARCHAR(50),
        duration_seconds INTEGER,
        intensity        VARCHAR(20) NOT NULL DEFAULT 'medium',
        notes            TEXT,
        xp_gained        INTEGER NOT NULL DEFAULT 0,
        intimacy_gained  FLOAT NOT NULL DEFAULT 0.0,
        created_at       TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 4. pet_diaries ───────────────────────
    """
    CREATE TABLE IF NOT EXISTS pet_diaries (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id     UUID NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
        profile_id UUID REFERENCES pet_mental_profiles(id) ON DELETE SET NULL,
        content    TEXT NOT NULL,
        mood       VARCHAR(50),
        date       VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 인덱스 ────────────────────────────────
    "CREATE INDEX IF NOT EXISTS idx_mental_profiles_pet_id    ON pet_mental_profiles(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_intimacy_records_pet_id   ON intimacy_records(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_interaction_logs_pet_id   ON interaction_logs(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_interaction_logs_type     ON interaction_logs(interaction_type)",
    "CREATE INDEX IF NOT EXISTS idx_pet_diaries_pet_id        ON pet_diaries(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_pet_diaries_date          ON pet_diaries(date)",
]


async def run_migration() -> None:
    print(f"[migrate] Connecting to: {ASYNCPG_DSN}")
    conn: asyncpg.Connection = await asyncpg.connect(ASYNCPG_DSN)
    try:
        for i, stmt in enumerate(DDL_STATEMENTS, start=1):
            cleaned = stmt.strip()
            label = cleaned.split("\n")[0][:80]
            try:
                await conn.execute(cleaned)
                print(f"  [{i:02d}] OK   {label}")
            except Exception as exc:
                print(f"  [{i:02d}] FAIL {label}", file=sys.stderr)
                print(f"        → {exc}",           file=sys.stderr)
                raise
        print("\n[migrate] ✓ Mental health tables created / verified successfully.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migration())
