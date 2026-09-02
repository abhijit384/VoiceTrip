import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional
from app.services.tts_service import rime_tts_service

logger = logging.getLogger("tts-api")
router = APIRouter(prefix="/tts", tags=["Rime TTS"])


class SynthesizeRequest(BaseModel):
    text: str
    generation_id: Optional[str] = "gen_1"


@router.post("/synthesize")
async def synthesize_speech(payload: SynthesizeRequest):
    """
    Synthesizes speech using Rime TTS.
    Returns primary spoken audio stream with generation and provider headers.
    """
    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        audio_bytes, content_type = await rime_tts_service.synthesize_bytes(payload.text)

        headers = {
            "Content-Disposition": "inline; filename=speech.mp3",
            "X-Rime-Speaker": rime_tts_service.speaker,
            "X-Rime-Model": rime_tts_service.model_id,
            "X-Generation-ID": payload.generation_id or "gen_1",
            "X-Voice-Provider": "rime",
        }

        return Response(content=audio_bytes, media_type=content_type, headers=headers)

    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/info")
async def get_rime_info():
    """Returns Rime voice engine configuration and active speaker."""
    return rime_tts_service.get_info()
