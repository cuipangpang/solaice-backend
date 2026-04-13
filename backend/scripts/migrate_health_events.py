"""
migrate_health_events.py
─────────────────────────
pet_health_events 테이블을 신규 생성합니다.
기존 테이블에는 영향을 주지 않습니다.

사용법 (backend/ 디렉토리에서 실행):
    python scripts/migrate_health_events.py
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

DDL_STATEMENTS: list[str] = [
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',

    """
    CREATE TABLE IF NOT EXISTS pet_health_events (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id     UUID NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
        event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('vaccine','birthday','grooming','hospital')),
        event_date DATE NOT NULL,
        next_date  DATE,
        note       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,

    "CREATE INDEX IF NOT EXISTS idx_pet_health_events_pet_id ON pet_health_events(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_pet_health_events_next_date ON pet_health_events(next_date)",
]


async def run() -> None:
    print(f"연결 중: {ASYNCPG_DSN[:40]}…")
    conn = await asyncpg.connect(ASYNCPG_DSN)
    try:
        for stmt in DDL_STATEMENTS:
            stmt = stmt.strip()
            if not stmt:
                continue
            print(f"  실행: {stmt[:60].replace(chr(10),' ')}…")
            await conn.execute(stmt)
        print("\n✅ pet_health_events 테이블 마이그레이션 완료")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
