from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.database import Base


class PetMentalProfile(Base):
    """반려동물 정신 건강 프로필 — 친밀도·기분·상호작용 누적."""
    __tablename__ = "pet_mental_profiles"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id              = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id", ondelete="CASCADE"),
                                 nullable=False, unique=True)
    intimacy_score      = Column(Float,   default=0.0,  nullable=False)   # 0–100
    mental_health_score = Column(Float,   default=50.0, nullable=False)   # 0–100
    mood_today          = Column(String(50), nullable=True)               # happy/calm/anxious/bored/excited/sad
    total_interactions  = Column(Integer, default=0, nullable=False)
    games_played        = Column(Integer, default=0, nullable=False)
    last_interaction_at = Column(DateTime(timezone=True), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    interactions = relationship("InteractionLog", back_populates="profile", cascade="all, delete-orphan")
    diaries      = relationship("PetDiary",        back_populates="profile", cascade="all, delete-orphan")


class IntimacyRecord(Base):
    """친밀도 변화 이력 — 조회용 로그."""
    __tablename__ = "intimacy_records"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id      = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id", ondelete="CASCADE"), nullable=False)
    delta       = Column(Float,        nullable=False)          # +/- 변화량
    reason      = Column(String(100),  nullable=False)          # e.g. "game:laser_pointer"
    total_after = Column(Float,        nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())


class InteractionLog(Base):
    """상호작용(먹이주기·놀이·게임 등) 개별 기록."""
    __tablename__ = "interaction_logs"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id           = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id", ondelete="CASCADE"), nullable=False)
    profile_id       = Column(UUID(as_uuid=True), ForeignKey("pet_mental_profiles.id", ondelete="SET NULL"),
                               nullable=True)
    interaction_type = Column(String(50),  nullable=False)                 # feeding/playing/grooming/cuddling/training/walking/game
    game_key         = Column(String(50),  nullable=True)                  # game 타입일 때만: laser_pointer 등
    duration_seconds = Column(Integer,     nullable=True)
    intensity        = Column(String(20),  default="medium", nullable=False)  # low/medium/high
    notes            = Column(Text,        nullable=True)
    xp_gained        = Column(Integer,     default=0,   nullable=False)
    intimacy_gained  = Column(Float,       default=0.0, nullable=False)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    profile = relationship("PetMentalProfile", back_populates="interactions")


class PetDiary(Base):
    """AI가 생성한 반려동물 시점의 일기."""
    __tablename__ = "pet_diaries"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id     = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id", ondelete="CASCADE"), nullable=False)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("pet_mental_profiles.id", ondelete="SET NULL"),
                         nullable=True)
    content    = Column(Text,        nullable=False)   # AI 생성 일기
    mood       = Column(String(50),  nullable=True)
    date       = Column(String(10),  nullable=False)   # YYYY-MM-DD
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    profile = relationship("PetMentalProfile", back_populates="diaries")
