from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.database import Base


class VaccineRecord(Base):
    __tablename__ = "vaccine_records"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id          = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id"), nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    type            = Column(String(50), nullable=False)   # '狂犬疫苗'|'驱虫'|'猫三联'
    administered_at = Column(Date, nullable=False)
    next_due_at     = Column(Date)
    notes           = Column(Text)
    deleted_at      = Column(DateTime(timezone=True), nullable=True)

    pet = relationship("PetProfile", back_populates="vaccine_records")
