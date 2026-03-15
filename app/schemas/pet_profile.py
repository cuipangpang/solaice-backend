from pydantic import BaseModel, UUID4
from typing import Optional
from decimal import Decimal
from datetime import date, datetime


class PetProfileCreate(BaseModel):
    user_id: str
    name: str
    species: str                          # 'cat' | 'dog' | 'other'
    breed: Optional[str] = None
    age_years: Optional[Decimal] = None
    gender: Optional[str] = None          # 'male' | 'female'
    neutered: Optional[bool] = False
    medical_history: Optional[str] = None
    allergies: Optional[str] = None
    avatar_url: Optional[str] = None
    birthday: Optional[date] = None


class PetProfileUpdate(BaseModel):
    name: Optional[str] = None
    breed: Optional[str] = None
    age_years: Optional[Decimal] = None
    gender: Optional[str] = None
    neutered: Optional[bool] = None
    medical_history: Optional[str] = None
    allergies: Optional[str] = None
    avatar_url: Optional[str] = None
    birthday: Optional[date] = None


class PetProfileResponse(BaseModel):
    id: UUID4
    user_id: str
    name: str
    species: str
    breed: Optional[str]
    age_years: Optional[Decimal]
    gender: Optional[str]
    neutered: bool
    medical_history: Optional[str]
    allergies: Optional[str]
    avatar_url: Optional[str]
    birthday: Optional[date]
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}
