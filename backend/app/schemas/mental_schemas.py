from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class MentalProfileOut(BaseModel):
    id: str
    pet_id: str
    intimacy_score: float
    mental_health_score: float
    mood_today: Optional[str]
    total_interactions: int
    games_played: int
    last_interaction_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class InteractionCreate(BaseModel):
    pet_id: str
    interaction_type: str   # feeding/playing/grooming/cuddling/training/walking/game
    game_key: Optional[str] = None          # game 일 때만: laser_pointer / feather_wand 등
    duration_seconds: Optional[int] = None
    intensity: str = "medium"               # low / medium / high
    notes: Optional[str] = None
    game_score: Optional[int] = None        # 게임 점수 (XP 배율에 사용)


class InteractionOut(BaseModel):
    id: str
    pet_id: str
    interaction_type: str
    game_key: Optional[str]
    duration_seconds: Optional[int]
    intensity: str
    notes: Optional[str]
    xp_gained: int
    intimacy_gained: float
    created_at: datetime

    model_config = {"from_attributes": True}


class DiaryGenerateRequest(BaseModel):
    pet_id: str
    pet_name: str
    pet_species: str   # cat / dog


class DiaryOut(BaseModel):
    id: str
    pet_id: str
    content: str
    mood: Optional[str]
    date: str
    created_at: datetime

    model_config = {"from_attributes": True}
