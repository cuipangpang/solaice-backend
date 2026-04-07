import os
import uuid
import shutil

import speech_recognition as sr
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pydub import AudioSegment
from typing import Literal

from app.schemas.response import APIResponse
from app.services.s3_service import generate_presigned_upload_url

router = APIRouter()

AVATAR_UPLOAD_DIR = "/opt/solaice/uploads/avatars"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5MB


@router.post("/avatar/{pet_id}")
async def upload_avatar(pet_id: str, file: UploadFile = File(...)):
    """宠物头像本地存储上传端点（不使用 S3）。"""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="JPG/PNG/WEBP 파일만 업로드 가능해요")

    content = await file.read()

    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기는 5MB 이하여야 해요")

    ext = (file.filename or "avatar.jpg").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"
    filename = f"{pet_id}_{uuid.uuid4().hex[:8]}.{ext}"

    os.makedirs(AVATAR_UPLOAD_DIR, exist_ok=True)
    filepath = os.path.join(AVATAR_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    base_url = os.getenv("BASE_URL", "http://43.164.134.43:8000")
    avatar_url = f"{base_url}/uploads/avatars/{filename}"

    return JSONResponse({
        "success": True,
        "avatar_url": avatar_url,
        "filename": filename,
    })

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


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    음성 파일(m4a/wav) → 텍스트 변환.
    pydub으로 WAV 변환 후 Google Web Speech API (ko-KR) 사용.
    실패 시 빈 transcript 반환 (크래시 없음).
    """
    hex_id = uuid.uuid4().hex
    tmp_src = f"/tmp/solaice_consult_{hex_id}.m4a"
    tmp_wav = f"/tmp/solaice_consult_{hex_id}.wav"

    try:
        audio_bytes = await file.read()
        with open(tmp_src, "wb") as f:
            f.write(audio_bytes)

        # m4a/mp4 → wav (ffmpeg 필요, Dockerfile에 설치돼 있음)
        audio = AudioSegment.from_file(tmp_src)
        audio.export(tmp_wav, format="wav")

        recognizer = sr.Recognizer()
        with sr.AudioFile(tmp_wav) as source:
            audio_data = recognizer.record(source)

        transcript = recognizer.recognize_google(audio_data, language="ko-KR")
        return {"transcript": transcript}

    except sr.UnknownValueError:
        # 음성을 인식할 수 없는 경우 — 빈 문자열 반환
        return {"transcript": ""}
    except sr.RequestError as e:
        print(f"[transcribe] Google STT 요청 실패: {e}")
        return {"transcript": "", "error": str(e)}
    except Exception as e:
        print(f"[transcribe] 에러: {e}")
        return {"transcript": "", "error": str(e)}
    finally:
        for path in (tmp_src, tmp_wav):
            try:
                os.remove(path)
            except OSError:
                pass


@router.post("/presigned-url", response_model=APIResponse[PresignedUrlResponse])
async def get_presigned_url(body: PresignedUrlRequest):
    if body.content_type not in ALLOWED_CONTENT_TYPES:
        return APIResponse.fail("INVALID_TYPE", f"不支持的文件类型: {body.content_type}")

    ext = body.filename.rsplit(".", 1)[-1] if "." in body.filename else "jpg"
    key = f"{body.folder}/{body.pet_id}/{uuid.uuid4()}.{ext}"

    upload_url, image_url = generate_presigned_upload_url(key, body.content_type)
    return APIResponse.ok(PresignedUrlResponse(upload_url=upload_url, image_url=image_url, key=key))
