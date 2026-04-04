from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from uuid import UUID
from typing import List, Optional
from app.database import get_db
from app.models.health_record import HealthRecord
from app.schemas.health_record import (
    HealthRecordCreate,
    HealthRecordResponse,
    HealthRecordStatsResponse,
    MODULE_LABELS,
)
from app.schemas.response import APIResponse

router = APIRouter()


@router.post("/", response_model=APIResponse[HealthRecordResponse], status_code=201)
async def create_health_record(body: HealthRecordCreate, db: AsyncSession = Depends(get_db)):
    data = body.model_dump()
    data["module_label"] = MODULE_LABELS.get(data["module"], data["module"])
    record = HealthRecord(**data)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return APIResponse.ok(HealthRecordResponse.model_validate(record))


# stats 必须在 /{id} 前面注册，否则 "stats" 会被匹配为 id
@router.get("/stats", response_model=APIResponse[HealthRecordStatsResponse])
async def get_stats(pet_id: UUID = Query(...), db: AsyncSession = Depends(get_db)):
    base = select(HealthRecord).where(
        HealthRecord.pet_id == pet_id,
        HealthRecord.deleted_at.is_(None),
    )

    total_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_result.scalar_one()

    last_result = await db.execute(
        select(func.max(HealthRecord.created_at)).where(
            HealthRecord.pet_id == pet_id, HealthRecord.deleted_at.is_(None)
        )
    )
    last_check_at = last_result.scalar_one()

    module_result = await db.execute(
        select(HealthRecord.module, func.count().label("cnt"))
        .where(HealthRecord.pet_id == pet_id, HealthRecord.deleted_at.is_(None))
        .group_by(HealthRecord.module)
    )
    by_module = {row.module: row.cnt for row in module_result}

    return APIResponse.ok(
        HealthRecordStatsResponse(total=total, last_check_at=last_check_at, by_module=by_module)
    )


@router.get("/", response_model=APIResponse[List[HealthRecordResponse]])
async def list_health_records(
    pet_id: UUID = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    offset = (page - 1) * page_size
    result = await db.execute(
        select(HealthRecord)
        .where(HealthRecord.pet_id == pet_id, HealthRecord.deleted_at.is_(None))
        .order_by(HealthRecord.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    records = result.scalars().all()
    return APIResponse.ok([HealthRecordResponse.model_validate(r) for r in records])


@router.get("/{record_id}", response_model=APIResponse[HealthRecordResponse])
async def get_health_record(record_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HealthRecord).where(
            HealthRecord.id == record_id, HealthRecord.deleted_at.is_(None)
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return APIResponse.fail("NOT_FOUND", "检测记录不存在")
    return APIResponse.ok(HealthRecordResponse.model_validate(record))


@router.delete("/{record_id}", response_model=APIResponse[dict])
async def delete_health_record(record_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HealthRecord).where(HealthRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return APIResponse.fail("NOT_FOUND", "检测记录不存在")

    # 联动删除S3图片
    if record.image_key:
        from app.services.s3_service import delete_object
        delete_object(record.image_key)

    await db.delete(record)
    await db.commit()
    return APIResponse.ok({"deleted": True})
