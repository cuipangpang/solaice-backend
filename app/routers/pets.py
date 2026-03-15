from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.sql import func
from uuid import UUID
from datetime import datetime, timezone
from app.database import get_db
from app.models.pet_profile import PetProfile
from app.schemas.pet_profile import PetProfileCreate, PetProfileUpdate, PetProfileResponse
from app.schemas.response import APIResponse

router = APIRouter()


@router.post("/", response_model=APIResponse[PetProfileResponse], status_code=201)
async def create_pet(body: PetProfileCreate, db: AsyncSession = Depends(get_db)):
    pet = PetProfile(**body.model_dump())
    db.add(pet)
    await db.commit()
    await db.refresh(pet)
    return APIResponse.ok(PetProfileResponse.model_validate(pet))


@router.get("/{pet_id}", response_model=APIResponse[PetProfileResponse])
async def get_pet(pet_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PetProfile).where(PetProfile.id == pet_id, PetProfile.deleted_at.is_(None))
    )
    pet = result.scalar_one_or_none()
    if not pet:
        return APIResponse.fail("NOT_FOUND", "宠物档案不存在")
    return APIResponse.ok(PetProfileResponse.model_validate(pet))


@router.patch("/{pet_id}", response_model=APIResponse[PetProfileResponse])
async def update_pet(pet_id: UUID, body: PetProfileUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PetProfile).where(PetProfile.id == pet_id, PetProfile.deleted_at.is_(None))
    )
    pet = result.scalar_one_or_none()
    if not pet:
        return APIResponse.fail("NOT_FOUND", "宠物档案不存在")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(pet, field, value)
    pet.updated_at = func.now()
    await db.commit()
    await db.refresh(pet)
    return APIResponse.ok(PetProfileResponse.model_validate(pet))


@router.delete("/{pet_id}", response_model=APIResponse[dict])
async def delete_pet(pet_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PetProfile).where(PetProfile.id == pet_id, PetProfile.deleted_at.is_(None))
    )
    pet = result.scalar_one_or_none()
    if not pet:
        return APIResponse.fail("NOT_FOUND", "宠物档案不存在")
    pet.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return APIResponse.ok({"deleted": True})
