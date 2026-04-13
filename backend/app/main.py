from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.routers import pets, health_records, vaccine_records, upload, reports
from app.routers.health_events import router as health_events_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    try:
        from app.services.redis_service import get_redis
        await get_redis()
        logger.info("[startup] Redis 연결 완료")
    except Exception as exc:
        logger.warning("[startup] Redis 연결 실패 (서버 시작은 계속됨): %s", exc)

    yield

    # shutdown
    try:
        from app.services.redis_service import close_redis
        await close_redis()
        logger.info("[shutdown] Redis 연결 종료")
    except Exception as exc:
        logger.warning("[shutdown] Redis 종료 실패: %s", exc)


app = FastAPI(
    title="솔레이스 Pet Health API",
    description="宠物健康AI后端服务 — 档案管理 + 检测记录 + 图片上传",
    version="2.0.0",
    lifespan=lifespan,
)

# 确保头像上传目录存在并挂载静态文件
os.makedirs("/opt/solaice/uploads/avatars", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="/opt/solaice/uploads"), name="uploads")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pets.router,            prefix="/api/v1/pets",            tags=["pets"])
app.include_router(health_records.router,  prefix="/api/v1/health-records",  tags=["health_records"])
app.include_router(vaccine_records.router, prefix="/api/v1/vaccine-records", tags=["vaccine_records"])
app.include_router(upload.router,          prefix="/api/v1/upload",          tags=["upload"])
app.include_router(reports.router,         prefix="/api/v1",                 tags=["reports"])
app.include_router(health_events_router,   prefix="/api/v1/pets",            tags=["health_events"])

from app.routers.chat import router as chat_router  # noqa: E402
app.include_router(chat_router, prefix="/api/v1/chat", tags=["chat"])


@app.get("/")
async def root():
    return {"status": "ok", "service": "솔레이스 Pet Health API", "version": "2.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/api/v1/health")
async def full_health_check():
    """PostgreSQL + Redis 동시 점검 엔드포인트."""
    result: dict[str, str] = {"postgres": "ok", "redis": "ok"}

    # PostgreSQL 확인
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception as exc:
        result["postgres"] = f"error: {exc}"

    # Redis 확인
    try:
        from app.services.redis_service import get_redis
        r = await get_redis()
        await r.ping()
    except Exception as exc:
        result["redis"] = f"error: {exc}"

    return result


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": {"code": "INTERNAL_ERROR", "message": str(exc)},
        },
    )


from translate.router import router as translate_router  # noqa: E402
app.include_router(translate_router, prefix="/api/v1/translate", tags=["translate"])

from app.routers.mental import router as mental_router  # noqa: E402
app.include_router(mental_router, prefix="/api/v1/mental", tags=["mental"])
