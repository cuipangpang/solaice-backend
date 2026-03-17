"""
migrate_chat_tables.py
──────────────────────
独立迁移脚本：在现有 solaice_db 中新建对话/训练数据相关表。
不依赖 Alembic，风格与 init.sql 保持一致。

使用方式（在 backend/ 目录下执行）：
    python scripts/migrate_chat_tables.py
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

# 从 backend/.env 读取配置（脚本可从任意工作目录调用）
_script_dir = Path(__file__).resolve().parent        # backend/scripts/
_backend_dir = _script_dir.parent                    # backend/
load_dotenv(_backend_dir / ".env")

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/solaice_db",
)
# asyncpg 使用标准 postgresql:// 协议，去掉 SQLAlchemy 方言前缀
ASYNCPG_DSN: str = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

# ─────────────────────────────────────────────
#  DDL 语句
# ─────────────────────────────────────────────

DDL_STATEMENTS: list[str] = [
    # ── 扩展 ──────────────────────────────────
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
    "CREATE EXTENSION IF NOT EXISTS vector",

    # ── 1. conversation_sessions ─────────────
    """
    CREATE TABLE IF NOT EXISTS conversation_sessions (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id      UUID NOT NULL REFERENCES pet_profiles(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW(),
        turn_count  INTEGER NOT NULL DEFAULT 0,
        stage       VARCHAR(20) NOT NULL DEFAULT 'questioning',
        lang        VARCHAR(10) NOT NULL DEFAULT 'zh',
        is_active   BOOLEAN NOT NULL DEFAULT TRUE
    )
    """,

    # ── 2. conversation_messages ──────────────
    """
    CREATE TABLE IF NOT EXISTS conversation_messages (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id  UUID NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        pet_id      UUID NOT NULL REFERENCES pet_profiles(id),
        role        VARCHAR(20) NOT NULL,
        content     TEXT NOT NULL,
        image_url   TEXT,
        turn_index  INTEGER NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 3. conversation_summaries ─────────────
    """
    CREATE TABLE IF NOT EXISTS conversation_summaries (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pet_id           UUID NOT NULL REFERENCES pet_profiles(id),
        session_id       UUID REFERENCES conversation_sessions(id) ON DELETE SET NULL,
        summary_text     TEXT NOT NULL,
        embedding        vector(1536),
        turn_range_start INTEGER NOT NULL,
        turn_range_end   INTEGER NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 4. eval_logs ──────────────────────────
    """
    CREATE TABLE IF NOT EXISTS eval_logs (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id       UUID REFERENCES conversation_sessions(id),
        pet_id           UUID REFERENCES pet_profiles(id),
        question         TEXT NOT NULL,
        answer           TEXT NOT NULL,
        contexts         JSONB DEFAULT '[]'::jsonb,
        faithfulness     FLOAT,
        answer_relevancy FLOAT,
        context_recall   FLOAT,
        created_at       TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 5. sft_pairs ──────────────────────────
    """
    CREATE TABLE IF NOT EXISTS sft_pairs (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_session_id UUID REFERENCES conversation_sessions(id),
        prompt            TEXT NOT NULL,
        response          TEXT NOT NULL,
        quality_score     FLOAT,
        source            VARCHAR(20) NOT NULL DEFAULT 'auto',
        created_at        TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 6. dpo_pairs ──────────────────────────
    """
    CREATE TABLE IF NOT EXISTS dpo_pairs (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_session_id UUID REFERENCES conversation_sessions(id),
        prompt            TEXT NOT NULL,
        chosen            TEXT NOT NULL,
        rejected          TEXT NOT NULL,
        created_at        TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 7. knowledge_base ────────────────────
    """
    CREATE TABLE IF NOT EXISTS knowledge_base (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        content    TEXT NOT NULL,
        source     VARCHAR(500),
        embedding  vector(1536),
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── 索引 ──────────────────────────────────
    "CREATE INDEX IF NOT EXISTS idx_conv_sessions_pet_id     ON conversation_sessions(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_conv_sessions_is_active  ON conversation_sessions(is_active)",
    "CREATE INDEX IF NOT EXISTS idx_conv_messages_session_id ON conversation_messages(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_conv_messages_pet_id     ON conversation_messages(pet_id)",
    "CREATE INDEX IF NOT EXISTS idx_conv_messages_turn       ON conversation_messages(session_id, turn_index)",
    "CREATE INDEX IF NOT EXISTS idx_eval_logs_session_id     ON eval_logs(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_sft_pairs_session_id     ON sft_pairs(source_session_id)",
    "CREATE INDEX IF NOT EXISTS idx_dpo_pairs_session_id     ON dpo_pairs(source_session_id)",
    "CREATE INDEX IF NOT EXISTS idx_knowledge_base_source    ON knowledge_base(source)",

    # ivfflat 向量索引（需要表中有数据才能有效训练 lists，空表时仍可创建）
    """
    CREATE INDEX IF NOT EXISTS idx_conv_summaries_embedding
        ON conversation_summaries
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding
        ON knowledge_base
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    """,
]


# ─────────────────────────────────────────────
#  执行迁移
# ─────────────────────────────────────────────

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
                print(f"  [{i:02d}] FAIL {label}")
                print(f"        → {exc}", file=sys.stderr)
                raise
        print("\n[migrate] ✓ All chat tables created / verified successfully.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migration())
