from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routers import pets, health_records, vaccine_records, upload, reports
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: 可在此做 DB 健康检查
    yield
    # shutdown


app = FastAPI(
    title="솔레이스 Pet Health API",
    description="宠物健康AI后端服务 — 档案管理 + 检测记录 + 图片上传",
    version="2.0.0",
    lifespan=lifespan,
)

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


@app.get("/")
async def root():
    return {"status": "ok", "service": "솔레이스 Pet Health API", "version": "2.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


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
