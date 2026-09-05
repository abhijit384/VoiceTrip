import time
import json
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.stt_service import DeepgramSTTService
from app.services.railway_normalizer import railway_normalizer

logger = logging.getLogger("stt-websocket")
router = APIRouter(prefix="/ws", tags=["Realtime WebSocket"])


@router.websocket("/stt")
async def websocket_stt_endpoint(websocket: WebSocket):
    """
    Realtime duplex WebSocket endpoint for streaming microphone audio to Deepgram STT (Flux /v2/listen or Nova).
    Receives binary audio frames from client, streams to Deepgram, and returns partial & final transcripts
    with context-aware railway domain entity normalization, raw transcripts, and structured intent.
    """
    await websocket.accept()
    logger.info("Client connected to /api/ws/stt")

    stt_service = DeepgramSTTService()
    send_audio_to_dg = None
    close_dg_stream = None
    send_lock = asyncio.Lock()

    async def safe_send_json(payload: dict):
        try:
            async with send_lock:
                await websocket.send_json(payload)
        except Exception as e:
            logger.debug(f"Failed to send JSON over WebSocket: {e}")

    # Callback when Deepgram yields a partial or final transcript
    def handle_transcript(data: dict):
        try:
            raw_text = data.get("text", "")
            norm_res = railway_normalizer.normalize(raw_text)

            intent_dict = norm_res.intent.model_dump()
            entities_dict = {
                "origin": norm_res.intent.origin,
                "destination": norm_res.intent.destination,
                "date": norm_res.intent.travel_date,
                "time_constraint": norm_res.intent.time_constraint,
                "passengers": norm_res.intent.passengers,
            }

            payload = {
                "type": "transcript",
                "text": norm_res.normalized_text,
                "normalized_text": norm_res.normalized_text,
                "raw_text": norm_res.raw_text,
                "corrections": norm_res.corrections,
                "intent": intent_dict,
                "entities": entities_dict,
                "is_final": data.get("is_final", False),
                "speech_final": data.get("speech_final", False),
                "confidence": data.get("confidence", 0.0),
                "stt_model": data.get("stt_model", stt_service.model),
                "stt_endpoint": data.get("stt_endpoint", stt_service.endpoint_path),
                "turn_event": data.get("turn_event", "Interim"),
                "timestamp": time.time(),
            }
            asyncio.create_task(safe_send_json(payload))
        except Exception as e:
            logger.warning(f"Failed to forward transcript to client: {e}")

    def handle_error(err_msg: str):
        try:
            asyncio.create_task(
                safe_send_json({
                    "type": "stt_error",
                    "error": err_msg,
                    "timestamp": time.time(),
                })
            )
        except Exception:
            pass

    sample_rate = 48000
    try:
        sample_rate = int(websocket.query_params.get("sample_rate", 48000))
    except Exception:
        sample_rate = 48000

    # Initialize Deepgram session if configured
    first_client_audio_logged = False
    if stt_service.is_configured:
        send_audio_to_dg, close_dg_stream = await stt_service.create_deepgram_stream(
            on_transcript=handle_transcript,
            on_error=handle_error,
            sample_rate=sample_rate,
        )
        t_stt_ready = time.time()
        logger.info(f"[STT] stt_ready={t_stt_ready:.3f} provider=deepgram model={stt_service.model} endpoint={stt_service.endpoint_path}")
        await websocket.send_json({
            "type": "stt_ready",
            "provider": "deepgram",
            "model": stt_service.model,
            "endpoint": stt_service.endpoint_path,
            "deepgram_configured": True,
            "eot_threshold": 0.7,
            "eager_eot_threshold": 0.6,
            "eot_timeout_ms": 1200,
            "timestamp": t_stt_ready,
        })
    else:
        t_stt_ready = time.time()
        logger.info(f"[STT] stt_ready={t_stt_ready:.3f} provider=fallback")
        await websocket.send_json({
            "type": "stt_ready",
            "provider": "fallback",
            "deepgram_configured": False,
            "model": "web-speech-fallback",
            "endpoint": "browser-native",
            "message": "DEEPGRAM_API_KEY not configured; real browser audio activity active",
            "timestamp": t_stt_ready,
        })

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("Client disconnected from /api/ws/stt (disconnect message)")
                break

            if "bytes" in message and message["bytes"]:
                audio_bytes = message["bytes"]
                if not first_client_audio_logged:
                    first_client_audio_logged = True
                    t_first_in = time.time()
                    logger.info(f"[STT] first_audio_frame_received={t_first_in:.3f} bytes={len(audio_bytes)}")
                if send_audio_to_dg:
                    await send_audio_to_dg(audio_bytes)

            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "ping":
                        await websocket.send_json({"type": "pong", "timestamp": time.time()})
                    elif msg_type == "client_transcript":
                        raw_text = data.get("text", "")
                        norm_res = railway_normalizer.normalize(raw_text)
                        await websocket.send_json({
                            "type": "transcript",
                            "text": norm_res.normalized_text,
                            "normalized_text": norm_res.normalized_text,
                            "raw_text": norm_res.raw_text,
                            "corrections": norm_res.corrections,
                            "intent": norm_res.intent.model_dump(),
                            "is_final": data.get("is_final", False),
                            "speech_final": data.get("is_final", False),
                            "confidence": data.get("confidence", 0.95),
                            "stt_model": "web_speech",
                            "stt_endpoint": "browser-native",
                            "timestamp": time.time(),
                        })
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        logger.info("Client disconnected from /api/ws/stt")
    except Exception as e:
        logger.error(f"WebSocket STT exception: {e}")
    finally:
        if close_dg_stream:
            await close_dg_stream()
