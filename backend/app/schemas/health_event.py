from pydantic import BaseModel, UUID4
from typing import Optional, Literal
from datetime import date, datetime

EventTypeEnum = Literal["vaccine", "birthday", "grooming", "hospital"]


class HealthEventCreate(BaseModel):
    event_type: EventTypeEnum
    event_date: date
    next_date: Optional[date] = None
    note: Optional[str] = None


class HealthEventUpdate(BaseModel):
    event_type: Optional[EventTypeEnum] = None
    event_date: Optional[date] = None
    next_date: Optional[date] = None
    note: Optional[str] = None


class HealthEventResponse(BaseModel):
    id: UUID4
    pet_id: UUID4
    event_type: str
    event_date: date
    next_date: Optional[date] = None
    note: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
