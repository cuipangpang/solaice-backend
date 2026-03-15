from sqlalchemy import Column, String, Boolean, Numeric, Date, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.database import Base


class PetProfile(Base):
    __tablename__ = "pet_profiles"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id         = Column(String(100), nullable=False)
    name            = Column(String(50), nullable=False)
    species         = Column(String(20), nullable=False)   # 'cat' | 'dog' | 'other'
    breed           = Column(String(100))
    age_years       = Column(Numeric(4, 1))
    gender          = Column(String(10))                   # 'male' | 'female'
    neutered        = Column(Boolean, default=False)
    medical_history = Column(Text)
    allergies       = Column(Text)
    avatar_url      = Column(Text)
    birthday        = Column(Date)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at      = Column(DateTime(timezone=True), nullable=True)

    health_records  = relationship("HealthRecord", back_populates="pet", lazy="select")
    vaccine_records = relationship("VaccineRecord", back_populates="pet", lazy="select")
