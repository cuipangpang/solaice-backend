from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.sql import func
from uuid import UUID
from typing import List
from datetime import date
from app.database import get_db
from app.models.vaccine_record import VaccineRecord
from app.schemas.vaccine_record import VaccineRecordCreate, VaccineRecordResponse
from app.schemas.response import APIResponse

router = APIRouter()


@router.post("/", response_model=APIResponse[VaccineRecordResponse], status_code=201)
async def create_vaccine_record(body: VaccineRecordCreate, db: AsyncSession = Depends(get_db)):
    record = VaccineRecord(**body.model_dump())
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return APIResponse.ok(VaccineRecordResponse.model_validate(record))


# overdue 必须在 /{id} 之前注册
@router.get("/overdue", response_model=APIResponse[List[VaccineRecordResponse]])
async def get_overdue(pet_id: UUID = Query(...), db: AsyncSession = Depends(get_db)):
    today = date.today()
    result = await db.execute(
        select(VaccineRecord)
        .where(
            VaccineRecord.pet_id == pet_id,
            VaccineRecord.next_due_at < today,
            VaccineRecord.deleted_at.is_(None),
        )
        .order_by(VaccineRecord.next_due_at)
    )
    records = result.scalars().all()
    return APIResponse.ok([VaccineRecordResponse.model_validate(r) for r in records])


@router.get("/", response_model=APIResponse[List[VaccineRecordResponse]])
async def list_vaccine_records(pet_id: UUID = Query(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VaccineRecord)
        .where(VaccineRecord.pet_id == pet_id, VaccineRecord.deleted_at.is_(None))
        .order_by(VaccineRecord.administered_at.desc())
    )
    records = result.scalars().all()
    return APIResponse.ok([VaccineRecordResponse.model_validate(r) for r in records])


@router.delete("/{record_id}", response_model=APIResponse[dict])
async def delete_vaccine_record(record_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VaccineRecord).where(VaccineRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return APIResponse.fail("NOT_FOUND", "疫苗记录不存在")
    await db.delete(record)
    await db.commit()
    return APIResponse.ok({"deleted": True})
