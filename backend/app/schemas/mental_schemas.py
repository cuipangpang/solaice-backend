from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID


class MentalProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pet_id: UUID
    intimacy_score: float
    mental_health_score: float
    mood_today: Optional[str]
    total_interactions: int
    games_played: int
    last_interaction_at: Optional[datetime]
    updated_at: Optional[datetime]


class InteractionCreate(BaseModel):
    pet_id: str
    interaction_type: str
    game_key: Optional[str] = None
    duration_seconds: Optional[int] = None
    intensity: str = "medium"
    notes: Optional[str] = None
    game_score: Optional[int] = None


class InteractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pet_id: UUID
    interaction_type: str
    game_key: Optional[str]
    duration_seconds: Optional[int]
    intensity: str
    notes: Optional[str]
    xp_gained: int
    intimacy_gained: float
    created_at: datetime


class DiaryGenerateRequest(BaseModel):
    pet_id: str
    pet_name: str
    pet_species: str


class DiaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pet_id: UUID
    content: str
    mood: Optional[str]
    date: str
    created_at: datetime