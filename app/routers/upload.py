from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal
from app.services.s3_service import generate_presigned_upload_url
from app.schemas.response import APIResponse
import os
import uuid

router = APIRouter()

ALLOWED_FOLDERS = {"avatars", "health-checks"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class PresignedUrlRequest(BaseModel):
    pet_id: str
    filename: str
    content_type: str
    folder: Literal["avatars", "health-checks"]


class PresignedUrlResponse(BaseModel):
    upload_url: str
    image_url: str
    key: str


@router.post("/presigned-url", response_model=APIResponse[PresignedUrlResponse])
async def get_presigned_url(body: PresignedUrlRequest):
    if body.content_type not in ALLOWED_CONTENT_TYPES:
        return APIResponse.fail("INVALID_TYPE", f"不支持的文件类型: {body.content_type}")

    ext = body.filename.rsplit(".", 1)[-1] if "." in body.filename else "jpg"
    key = f"{body.folder}/{body.pet_id}/{uuid.uuid4()}.{ext}"

    upload_url, image_url = generate_presigned_upload_url(key, body.content_type)
    return APIResponse.ok(PresignedUrlResponse(upload_url=upload_url, image_url=image_url, key=key))
