from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
import uuid
from app.database import Base


class HealthRecord(Base):
    __tablename__ = "health_records"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id            = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id"), nullable=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at        = Column(DateTime(timezone=True), nullable=True)

    module            = Column(String(20), nullable=False)
    module_label      = Column(String(20), nullable=False)
    urgency           = Column(String(20), nullable=False)  # normal|caution|visit|emergency

    primary_diagnosis = Column(Text, nullable=False)
    action_plan       = Column(Text, nullable=False)
    confidence_level  = Column(String(10))                  # high|medium|low

    symptoms          = Column(JSONB, default=list)
    image_url         = Column(Text)
    image_key         = Column(Text)

    embedding         = Column(Vector(1024), nullable=True)

    pet = relationship("PetProfile", back_populates="health_records")
