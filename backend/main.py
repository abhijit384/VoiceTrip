import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.health import router as health_router
from app.api.livekit_token import router as livekit_router
from app.api.websocket_hub import router as ws_router
from app.api.session import router as session_router
from app.api.tool import router as tool_router
from app.api.tts import router as tts_router
from app.api.stt import router as stt_router
from app.api.orchestrator import router as orchestrator_router
from app.api.ocr import router as ocr_router

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("rime-assistant")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"Rime TTS Configured: {bool(settings.RIME_API_KEY)} (Speaker: {settings.RIME_SPEAKER})")
    logger.info(f"Gemini LLM: {settings.GEMINI_MODEL} (Configured: {bool(settings.GEMINI_API_KEY)})")
    logger.info(f"Deepgram STT: {settings.DEEPGRAM_MODEL} (Configured: {bool(settings.DEEPGRAM_API_KEY)})")
    logger.info(f"Tool Delay: {settings.TOOL_ARTIFICIAL_DELAY_SECONDS}s")
    yield
    logger.info("Shutting down voice assistant backend")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://.*$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Mount API Routers
app.include_router(health_router, prefix="/api")
app.include_router(livekit_router, prefix="/api")
app.include_router(ws_router, prefix="/api")
app.include_router(stt_router, prefix="/api")
app.include_router(session_router, prefix="/api")
app.include_router(tool_router, prefix="/api")
app.include_router(tts_router, prefix="/api")
app.include_router(orchestrator_router, prefix="/api")
app.include_router(ocr_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "health_endpoint": "/api/health",
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.BACKEND_HOST,
        port=settings.BACKEND_PORT,
        reload=settings.DEBUG,
    )
