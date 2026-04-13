from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.database import Base


class PetHealthEvent(Base):
    __tablename__ = "pet_health_events"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pet_id     = Column(UUID(as_uuid=True), ForeignKey("pet_profiles.id"), nullable=False)
    event_type = Column(String(20), nullable=False)   # vaccine|birthday|grooming|hospital
    event_date = Column(Date, nullable=False)
    next_date  = Column(Date, nullable=True)
    note       = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    pet = relationship("PetProfile")
