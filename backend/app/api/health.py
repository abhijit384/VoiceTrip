import time
from fastapi import APIRouter
from app.core.config import settings

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    """
    Health check endpoint returning system status, version, and integration availability.
    Safely reveals whether integrations are configured without leaking credentials.
    """
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "timestamp": time.time(),
        "services": {
            "rime_tts": {
                "configured": bool(settings.RIME_API_KEY),
                "model": settings.RIME_MODEL_ID,
                "speaker": settings.RIME_SPEAKER,
                "endpoint": settings.RIME_API_URL,
            },
            "groq_llm": {
                "configured": bool(settings.GROQ_API_KEY),
                "model": settings.GROQ_MODEL,
            },
            "deepgram_stt": {
                "configured": bool(settings.DEEPGRAM_API_KEY),
                "model": settings.DEEPGRAM_MODEL,
            },
            "livekit": {
                "configured": bool(settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY),
            },
            "tool_delay_seconds": settings.TOOL_ARTIFICIAL_DELAY_SECONDS,
        },
    }
