from pydantic import BaseModel, UUID4
from typing import Optional
from datetime import date, datetime


class VaccineRecordCreate(BaseModel):
    pet_id: UUID4
    type: str                             # '狂犬疫苗'|'驱虫'|'猫三联'
    administered_at: date
    next_due_at: Optional[date] = None
    notes: Optional[str] = None


class VaccineRecordResponse(BaseModel):
    id: UUID4
    pet_id: UUID4
    created_at: datetime
    type: str
    administered_at: date
    next_due_at: Optional[date]
    notes: Optional[str]

    model_config = {"from_attributes": True}
