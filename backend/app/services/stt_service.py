import json
import asyncio
import logging
from typing import AsyncGenerator, Callable, Optional
import websockets
from app.core.config import settings

logger = logging.getLogger("stt-service")

DEEPGRAM_WS_URL = (
    f"wss://api.deepgram.com/v1/listen?"
    f"model={settings.DEEPGRAM_MODEL}&"
    f"language={settings.DEEPGRAM_LANGUAGE}&"
    f"smart_format=true&"
    f"interim_results=true&"
    f"endpointing=300"
)


class DeepgramSTTService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.DEEPGRAM_API_KEY
        self.is_configured = bool(
            self.api_key and "your_deepgram" not in self.api_key and len(self.api_key) > 10
        )

    async def create_deepgram_stream(
        self,
        on_transcript: Callable[[dict], None],
        on_error: Callable[[str], None],
    ):
        """
        Connects to Deepgram's live streaming WebSocket.
        Returns a tuple: (send_audio_chunk, close_stream)
        """
        if not self.is_configured:
            logger.warning("Deepgram API key not configured or placeholder used.")
            return None, None

        headers = {
            "Authorization": f"Token {self.api_key}",
        }

        try:
            dg_ws = await websockets.connect(
                DEEPGRAM_WS_URL,
                extra_headers=headers,
                ping_interval=20,
                ping_timeout=20,
            )
            logger.info("Connected to Deepgram live streaming WebSocket")

            async def receive_transcripts():
                try:
                    async for message in dg_ws:
                        data = json.loads(message)
                        if data.get("type") == "Results":
                            channel = data.get("channel", {})
                            alternatives = channel.get("alternatives", [{}])
                            if alternatives:
                                transcript = alternatives[0].get("transcript", "")
                                is_final = data.get("is_final", False)
                                speech_final = data.get("speech_final", False)
                                confidence = alternatives[0].get("confidence", 0.0)

                                if transcript:
                                    on_transcript({
                                        "text": transcript,
                                        "is_final": is_final or speech_final,
                                        "speech_final": speech_final,
                                        "confidence": confidence,
                                    })
                except websockets.exceptions.ConnectionClosed as e:
                    logger.info(f"Deepgram WebSocket closed: {e}")
                except Exception as e:
                    logger.error(f"Error in Deepgram receive loop: {e}")
                    on_error(str(e))

            # Run receiver in background
            recv_task = asyncio.create_task(receive_transcripts())

            async def send_audio_chunk(chunk: bytes):
                try:
                    if dg_ws.open:
                        await dg_ws.send(chunk)
                except Exception as e:
                    logger.error(f"Failed to send audio chunk to Deepgram: {e}")

            async def close():
                try:
                    recv_task.cancel()
                    if dg_ws.open:
                        # Deepgram close protocol: send empty byte array then close
                        await dg_ws.send(b"")
                        await dg_ws.close()
                except Exception as e:
                    logger.warning(f"Error closing Deepgram connection: {e}")

            return send_audio_chunk, close

        except Exception as e:
            logger.error(f"Could not connect to Deepgram: {e}")
            on_error(f"Deepgram connection failed: {str(e)}")
            return None, None
