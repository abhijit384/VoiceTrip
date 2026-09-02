import time
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.stt_service import DeepgramSTTService

logger = logging.getLogger("stt-websocket")
router = APIRouter(prefix="/ws", tags=["Realtime WebSocket"])


@router.websocket("/stt")
async def websocket_stt_endpoint(websocket: WebSocket):
    """
    Realtime duplex WebSocket endpoint for streaming microphone audio to Deepgram STT.
    Receives binary audio frames from client, streams to Deepgram, and returns partial & final transcripts.
    """
    await websocket.accept()
    logger.info("Client connected to /api/ws/stt")

    stt_service = DeepgramSTTService()
    send_audio_to_dg = None
    close_dg_stream = None

    # Callback when Deepgram yields a partial or final transcript
    def handle_transcript(data: dict):
        try:
            payload = {
                "type": "transcript",
                "text": data.get("text", ""),
                "is_final": data.get("is_final", False),
                "speech_final": data.get("speech_final", False),
                "confidence": data.get("confidence", 0.0),
                "timestamp": time.time(),
            }
            # Schedule sending over client websocket
            import asyncio
            asyncio.create_task(websocket.send_json(payload))
        except Exception as e:
            logger.warning(f"Failed to forward transcript to client: {e}")

    def handle_error(err_msg: str):
        try:
            import asyncio
            asyncio.create_task(
                websocket.send_json({
                    "type": "stt_error",
                    "error": err_msg,
                    "timestamp": time.time(),
                })
            )
        except Exception:
            pass

    # Initialize Deepgram session if configured
    if stt_service.is_configured:
        send_audio_to_dg, close_dg_stream = await stt_service.create_deepgram_stream(
            on_transcript=handle_transcript,
            on_error=handle_error,
        )
        await websocket.send_json({
            "type": "stt_ready",
            "provider": "deepgram",
            "model": "nova-2",
            "deepgram_configured": True,
        })
    else:
        await websocket.send_json({
            "type": "stt_ready",
            "provider": "fallback",
            "deepgram_configured": False,
            "message": "DEEPGRAM_API_KEY not configured in .env; real browser audio activity & Web Speech fallback active",
        })

    try:
        while True:
            # Receive either binary audio data or JSON control messages
            message = await websocket.receive()

            if "bytes" in message and message["bytes"]:
                audio_bytes = message["bytes"]
                if send_audio_to_dg:
                    await send_audio_to_dg(audio_bytes)
                else:
                    # Echo audio activity receipt for telemetry
                    pass

            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "ping":
                        await websocket.send_json({"type": "pong", "timestamp": time.time()})
                    elif msg_type == "client_transcript":
                        # If client used browser-side recognition fallback, broadcast back
                        await websocket.send_json({
                            "type": "transcript",
                            "text": data.get("text", ""),
                            "is_final": data.get("is_final", False),
                            "speech_final": data.get("is_final", False),
                            "confidence": data.get("confidence", 0.95),
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
