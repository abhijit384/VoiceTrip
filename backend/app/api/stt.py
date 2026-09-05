import logging
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel
import httpx
from app.core.config import settings
from app.services.railway_normalizer import railway_normalizer
from app.core.railway_vocabulary import DEEPGRAM_KEYTERMS

logger = logging.getLogger("stt-api")
router = APIRouter(prefix="/stt", tags=["Deepgram STT"])


class TranscribeResponse(BaseModel):
    success: bool
    text: str
    raw_text: str
    confidence: float
    duration_seconds: float
    model: str
    audio_bytes_received: int
    content_type: str
    latency_ms: int


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio_blob(
    request: Request,
    content_type: Optional[str] = Header(None),
):
    """
    Direct authoritative STT endpoint for recorded audio Blobs.
    Receives raw binary audio from browser MediaRecorder (audio/webm, audio/wav, audio/ogg, audio/mp4).
    Sends the exact audio bytes to Deepgram REST API and returns the normalized transcript.
    """
    t_start = time.time()
    audio_bytes = await request.body()
    audio_len = len(audio_bytes)
    
    ct = content_type or request.headers.get("content-type") or "audio/webm"
    # Clean up content type (e.g. 'audio/webm;codecs=opus' -> 'audio/webm')
    mime_base = ct.split(";")[0].strip() if ct else "audio/webm"

    logger.info(
        f"\n{'='*60}\n"
        f"[STT REQUEST] Received recorded audio blob:\n"
        f"  - Size: {audio_len} bytes\n"
        f"  - Content-Type: {ct} (MIME: {mime_base})\n"
        f"{'='*60}"
    )

    if audio_len == 0:
        logger.error("[STT] Received 0 bytes of audio. Aborting transcription.")
        raise HTTPException(status_code=400, detail="Microphone audio recording was empty (0 bytes).")

    api_key = settings.DEEPGRAM_API_KEY
    if not api_key or "your_deepgram" in api_key:
        logger.error("[STT] Deepgram API key is not configured.")
        raise HTTPException(status_code=500, detail="Deepgram API key not configured on server.")

    # Build Deepgram REST API URL with smart formatting and railway keyterms
    dg_url = (
        "https://api.deepgram.com/v1/listen?"
        "model=nova-2&"
        "language=en&"
        "smart_format=true&"
        "punctuate=true"
    )

    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": mime_base,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            dg_res = await client.post(dg_url, content=audio_bytes, headers=headers)
            
            if dg_res.status_code != 200:
                logger.error(f"[STT] Deepgram API returned HTTP {dg_res.status_code}: {dg_res.text}")
                # Retry with generic audio/webm if specific mime failed
                if mime_base != "audio/webm":
                    logger.info("[STT] Retrying Deepgram with Content-Type: audio/webm...")
                    headers["Content-Type"] = "audio/webm"
                    dg_res = await client.post(dg_url, content=audio_bytes, headers=headers)

            if dg_res.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Deepgram STT API error (HTTP {dg_res.status_code}): {dg_res.text[:200]}"
                )

            data = dg_res.json()
            channels = data.get("results", {}).get("channels", [])
            raw_transcript = ""
            confidence = 0.0
            duration = data.get("metadata", {}).get("duration", 0.0)
            model_used = data.get("metadata", {}).get("models", ["nova-2"])[0]

            if channels and len(channels) > 0:
                alts = channels[0].get("alternatives", [])
                if alts and len(alts) > 0:
                    raw_transcript = alts[0].get("transcript", "").strip()
                    confidence = alts[0].get("confidence", 0.0)

            # Apply domain phonetic normalization (e.g. NJP -> New Jalpaiguri, Howrah -> HWH)
            norm_res = railway_normalizer.normalize(raw_transcript)
            final_transcript = norm_res.normalized_text

            latency_ms = int((time.time() - t_start) * 1000)
            logger.info(
                f"\n{'='*60}\n"
                f"[STT RESPONSE] Completed in {latency_ms}ms:\n"
                f"  - Raw Speech:        '{raw_transcript}'\n"
                f"  - Final Transcript:  '{final_transcript}'\n"
                f"  - Confidence:        {confidence:.2f}\n"
                f"  - Audio Duration:    {duration:.2f}s\n"
                f"{'='*60}"
            )

            return TranscribeResponse(
                success=True,
                text=final_transcript,
                raw_text=raw_transcript,
                confidence=confidence,
                duration_seconds=duration,
                model=model_used,
                audio_bytes_received=audio_len,
                content_type=ct,
                latency_ms=latency_ms,
            )

    except httpx.RequestError as exc:
        logger.error(f"[STT] Network error connecting to Deepgram: {exc}")
        raise HTTPException(status_code=503, detail=f"Network error communicating with STT service: {str(exc)}")
