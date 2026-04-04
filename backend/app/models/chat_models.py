from sqlalchemy import Column, String, Boolean, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
import uuid
from app.database import Base


class ConversationSession(Base):
    """多轮对话会话。每次用户开启一个宠物健康咨询即创建一条记录。"""
    __tablename__ = "conversation_sessions"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id     = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    turn_count = Column(Integer, default=0, nullable=False)
    stage      = Column(String(20), default="questioning", nullable=False)  # 'questioning' | 'diagnosis'
    lang       = Column(String(10), default="zh", nullable=False)
    is_active  = Column(Boolean, default=True, nullable=False)

    messages  = relationship("ConversationMessage",  back_populates="session", cascade="all, delete-orphan", lazy="select")
    summaries = relationship("ConversationSummary",  back_populates="session", cascade="all, delete-orphan", lazy="select")
    eval_logs = relationship("EvalLog",              back_populates="session", lazy="select")
    sft_pairs = relationship("SFTPair",              back_populates="source_session", lazy="select")
    dpo_pairs = relationship("DPOPair",              back_populates="source_session", lazy="select")


class ConversationMessage(Base):
    """会话中每一轮的单条消息（用户或 AI）。"""
    __tablename__ = "conversation_messages"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("conversation_sessions.id", ondelete="CASCADE"), nullable=False)
    pet_id     = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id"), nullable=False)
    role       = Column(String(20), nullable=False)   # 'user' | 'assistant'
    content    = Column(Text, nullable=False)
    image_url  = Column(Text, nullable=True)
    turn_index = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ConversationSession", back_populates="messages")


class ConversationSummary(Base):
    """对话摘要，用于长对话压缩和 RAG 检索。embedding 用于语义相似度搜索。"""
    __tablename__ = "conversation_summaries"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id           = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id"), nullable=False)
    session_id       = Column(UUID(as_uuid=True), ForeignKey("conversation_sessions.id", ondelete="SET NULL"), nullable=True)
    summary_text     = Column(Text, nullable=False)
    embedding        = Column(Vector(1024), nullable=True)
    structured_facts = Column(JSONB, default=dict, nullable=True)   # v4 추가
    turn_range_start = Column(Integer, nullable=False)
    turn_range_end   = Column(Integer, nullable=False)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ConversationSession", back_populates="summaries")


class EvalLog(Base):
    """RAGAS 评测日志，记录每次 RAG 回答的质量指标。"""
    __tablename__ = "eval_logs"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id        = Column(UUID(as_uuid=True), ForeignKey("conversation_sessions.id"), nullable=True)
    pet_id            = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id"), nullable=True)
    question          = Column(Text, nullable=False)
    answer            = Column(Text, nullable=False)
    contexts          = Column(JSONB, default=list)   # List[str]
    faithfulness      = Column(Float, nullable=True)
    answer_relevancy  = Column(Float, nullable=True)
    context_recall    = Column(Float, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ConversationSession", back_populates="eval_logs")


class SFTPair(Base):
    """SFT 微调数据对，来源于高质量对话或人工标注。"""
    __tablename__ = "sft_pairs"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_session_id = Column(UUID(as_uuid=True), ForeignKey("conversation_sessions.id"), nullable=True)
    prompt            = Column(Text, nullable=False)
    response          = Column(Text, nullable=False)
    quality_score     = Column(Float, nullable=True)
    source            = Column(String(20), default="auto", nullable=False)  # 'auto' | 'human'
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    source_session = relationship("ConversationSession", back_populates="sft_pairs")


class DPOPair(Base):
    """DPO 偏好数据对，用于对齐训练。"""
    __tablename__ = "dpo_pairs"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_session_id = Column(UUID(as_uuid=True), ForeignKey("conversation_sessions.id"), nullable=True)
    prompt            = Column(Text, nullable=False)
    chosen            = Column(Text, nullable=False)
    rejected          = Column(Text, nullable=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    source_session = relationship("ConversationSession", back_populates="dpo_pairs")
