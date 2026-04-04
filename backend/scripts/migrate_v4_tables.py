"""
migrate_v4_tables.py
──────────────────────
신규 테이블 8개 + 기존 테이블 ALTER + knowledge_base tsvector 인덱스 추가.
기존 migrate_chat_tables.py 와 동일한 패턴으로 작성.

사용 방식 (backend/ 디렉토리에서):
    python scripts/migrate_v4_tables.py
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
#  DDL 문
# ─────────────────────────────────────────────

DDL_STATEMENTS: list[str] = [

    # ── 확장 (없으면 생성) ──────────────────────
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
    "CREATE EXTENSION IF NOT EXISTS vector",

    # ── 1. Web 검색 결과 캐시 ───────────────────
    """
    CREATE TABLE IF NOT EXISTS web_search_cache (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        query_hash   VARCHAR(64) NOT NULL,
        query_text   TEXT,
        results_json JSONB,
        source_urls  TEXT[],
        quality_score FLOAT DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_web_search_cache_hash    ON web_search_cache(query_hash)",
    "CREATE INDEX IF NOT EXISTS idx_web_search_cache_created ON web_search_cache(created_at)",

    # ── 2. 지식베이스 후보 ──────────────────────
    # 3단계 필터링 후 승인된 항목만 knowledge_base에 입력
    """
    CREATE TABLE IF NOT EXISTS knowledge_candidates (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content       TEXT NOT NULL,
        source_url    TEXT,
        quality_score FLOAT DEFAULT 0,
        status        VARCHAR(20) DEFAULT 'pending',
        created_at    TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 3. 도구 호출 로그 ───────────────────────
    """
    CREATE TABLE IF NOT EXISTS tool_call_logs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id  VARCHAR(100),
        tool_name   VARCHAR(50) NOT NULL,
        input_json  JSONB,
        output_json JSONB,
        latency_ms  INTEGER,
        success     BOOLEAN DEFAULT TRUE,
        turn_index  INTEGER,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_tool_call_session ON tool_call_logs(session_id)",

    # ── 4. 증상 그래프 (경량 GraphRAG) ─────────
    """
    CREATE TABLE IF NOT EXISTS symptom_graph (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symptom          VARCHAR(200) NOT NULL,
        related_symptoms TEXT[] DEFAULT '{}',
        possible_causes  TEXT[] DEFAULT '{}',
        urgency_hint     VARCHAR(20) DEFAULT 'caution',
        species          VARCHAR(20) DEFAULT 'both',
        created_at       TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_symptom_graph_symptom ON symptom_graph(symptom)",

    # ── 5. 푸시 알림 기록 ───────────────────────
    """
    CREATE TABLE IF NOT EXISTS push_notifications (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pet_id       UUID REFERENCES pet_profiles(id),
        trigger_type VARCHAR(50) NOT NULL,
        message      TEXT NOT NULL,
        sent_at      TIMESTAMPTZ,
        status       VARCHAR(20) DEFAULT 'pending',
        created_at   TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_push_notifications_pet ON push_notifications(pet_id)",

    # ── 6. 스티커 라이브러리 ────────────────────
    """
    CREATE TABLE IF NOT EXISTS sticker_library (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category    VARCHAR(50) NOT NULL,
        filename    VARCHAR(200) NOT NULL,
        s3_url      TEXT,
        urgency_map TEXT[] DEFAULT '{}',
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 7. 환각 감지 로그 ───────────────────────
    """
    CREATE TABLE IF NOT EXISTS hallucination_logs (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id      VARCHAR(100),
        rule_triggered  VARCHAR(100),
        original_output TEXT,
        action          VARCHAR(50),
        review_status   VARCHAR(20) DEFAULT 'pending',
        created_at      TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 8. 엔티티 언급 기록 ─────────────────────
    """
    CREATE TABLE IF NOT EXISTS entity_mentions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pet_id      UUID REFERENCES pet_profiles(id),
        session_id  VARCHAR(100),
        entity_type VARCHAR(50) NOT NULL,
        value       TEXT NOT NULL,
        turn_index  INTEGER,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_entity_mentions_pet  ON entity_mentions(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_entity_mentions_type ON entity_mentions(entity_type)",

    # ── 기존 테이블 ALTER ───────────────────────

    # conversation_messages: 오디오 컬럼 추가
    "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS audio_url  TEXT",
    "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS transcript TEXT",

    # conversation_sessions: 모드 컬럼 추가
    "ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'fast'",

    # conversation_summaries: 구조화 필드 추가
    "ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS structured_facts JSONB DEFAULT '{}'",

    # ── knowledge_base tsvector 인덱스 (BM25용) ─
    """
    ALTER TABLE knowledge_base
        ADD COLUMN IF NOT EXISTS content_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
    """,
    "CREATE INDEX IF NOT EXISTS idx_knowledge_base_tsv ON knowledge_base USING GIN(content_tsv)",
]


# ─────────────────────────────────────────────
#  실행
# ─────────────────────────────────────────────

async def run_migration() -> None:
    print(f"[migrate_v4] Connecting to: {ASYNCPG_DSN}")
    conn: asyncpg.Connection = await asyncpg.connect(ASYNCPG_DSN)
    try:
        for i, stmt in enumerate(DDL_STATEMENTS, start=1):
            cleaned = stmt.strip()
            label = cleaned.split("\n")[0][:80]
            try:
                await conn.execute(cleaned)
                print(f"  [{i:02d}] OK   {label}")
            except Exception as exc:
                print(f"  [{i:02d}] FAIL {label}")
                print(f"        → {exc}", file=sys.stderr)
                raise

        print("\n[migrate_v4] ✓ 마이그레이션 완료 — 8개 신규 테이블 + 3개 ALTER + tsvector 인덱스")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migration())
