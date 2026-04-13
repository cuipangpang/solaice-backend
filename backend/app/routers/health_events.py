from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date, timedelta
from uuid import UUID
from typing import List

from app.database import get_db
from app.models.health_event import PetHealthEvent
from app.schemas.health_event import HealthEventCreate, HealthEventUpdate, HealthEventResponse
from app.schemas.response import APIResponse

router = APIRouter()


@router.get("/{pet_id}/health-events", response_model=APIResponse[List[HealthEventResponse]])
async def list_health_events(pet_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PetHealthEvent)
        .where(PetHealthEvent.pet_id == pet_id)
        .order_by(PetHealthEvent.event_date.desc())
    )
    events = result.scalars().all()
    return APIResponse.ok([HealthEventResponse.model_validate(e) for e in events])


@router.post("/{pet_id}/health-events", response_model=APIResponse[HealthEventResponse], status_code=201)
async def create_health_event(
    pet_id: UUID,
    body: HealthEventCreate,
    db: AsyncSession = Depends(get_db),
):
    event = PetHealthEvent(pet_id=pet_id, **body.model_dump())
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return APIResponse.ok(HealthEventResponse.model_validate(event))


@router.put("/{pet_id}/health-events/{event_id}", response_model=APIResponse[HealthEventResponse])
async def update_health_event(
    pet_id: UUID,
    event_id: UUID,
    body: HealthEventUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PetHealthEvent).where(
            PetHealthEvent.id == event_id,
            PetHealthEvent.pet_id == pet_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        return APIResponse.fail("NOT_FOUND", "이벤트를 찾을 수 없습니다")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(event, k, v)
    await db.commit()
    await db.refresh(event)
    return APIResponse.ok(HealthEventResponse.model_validate(event))


@router.delete("/{pet_id}/health-events/{event_id}", response_model=APIResponse[dict])
async def delete_health_event(
    pet_id: UUID,
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PetHealthEvent).where(
            PetHealthEvent.id == event_id,
            PetHealthEvent.pet_id == pet_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        return APIResponse.fail("NOT_FOUND", "이벤트를 찾을 수 없습니다")
    await db.delete(event)
    await db.commit()
    return APIResponse.ok({"deleted": True})


@router.get("/{pet_id}/upcoming-reminders", response_model=APIResponse[List[HealthEventResponse]])
async def upcoming_reminders(pet_id: UUID, db: AsyncSession = Depends(get_db)):
    today = date.today()
    in_30 = today + timedelta(days=30)
    result = await db.execute(
        select(PetHealthEvent).where(
            PetHealthEvent.pet_id == pet_id,
            PetHealthEvent.next_date >= today,
            PetHealthEvent.next_date <= in_30,
        ).order_by(PetHealthEvent.next_date.asc())
    )
    events = result.scalars().all()
    return APIResponse.ok([HealthEventResponse.model_validate(e) for e in events])
