import json
import time
import asyncio
import logging
import urllib.parse
from typing import Callable, Optional, Tuple
import websockets
from app.core.config import settings
from app.core.railway_vocabulary import DEEPGRAM_KEYTERMS, DEEPGRAM_KEYWORDS

logger = logging.getLogger("stt-service")


def build_deepgram_ws_url(
    model: str,
    sample_rate: int,
    language: str = "en",
    eot_threshold: float = 0.7,
    eager_eot_threshold: float = 0.6,
    eot_timeout_ms: int = 1200,
) -> Tuple[str, str]:
    """
    Constructs the appropriate Deepgram WebSocket URL based on model type:
    - Flux models ('flux-general-en', 'flux-general-multi') -> wss://api.deepgram.com/v2/listen
      with repeated unweighted keyterm parameters and model-integrated turn detection (eot_threshold, eot_timeout_ms).
    - Legacy Nova models ('nova-2', 'nova-3') -> wss://api.deepgram.com/v1/listen
      with keywords/keyterms and endpointing parameters.
    Returns: (ws_url, endpoint_path)
    """
    is_flux = model.startswith("flux-")

    if is_flux:
        endpoint_path = "/v2/listen"
        # Keyterm Prompting for Flux: repeated 'keyterm=' query params (unweighted plain strings)
        keyterm_params = [f"keyterm={urllib.parse.quote(k)}" for k in DEEPGRAM_KEYTERMS]
        keyterms_query = "&".join(keyterm_params)

        params = [
            f"model={model}",
            "encoding=linear16",
            f"sample_rate={sample_rate}",
            f"eot_threshold={eot_threshold}",
            f"eager_eot_threshold={eager_eot_threshold}",
            f"eot_timeout_ms={eot_timeout_ms}",
            f"{keyterms_query}",
        ]
        if model == "flux-general-multi":
            params.append(f"language_hint={language}")

        query_str = "&".join([p for p in params if p])
        ws_url = f"wss://api.deepgram.com/v2/listen?{query_str}"
    else:
        endpoint_path = "/v1/listen"
        # For Nova-3 use keyterm, for Nova-2 use keywords
        if model.startswith("nova-3"):
            keyterm_params = [f"keyterm={urllib.parse.quote(k)}" for k in DEEPGRAM_KEYTERMS]
            kw_query = "&".join(keyterm_params)
        else:
            kw_params = [f"keywords={urllib.parse.quote(k)}" for k in DEEPGRAM_KEYWORDS]
            kw_query = "&".join(kw_params)

        query_str = (
            f"model={model}&"
            f"language={language}&"
            f"encoding=linear16&"
            f"sample_rate={sample_rate}&"
            f"channels=1&"
            f"smart_format=true&"
            f"punctuate=true&"
            f"interim_results=true&"
            f"endpointing=600&"
            f"utterance_end_ms=1200&"
            f"{kw_query}"
        )
        ws_url = f"wss://api.deepgram.com/v1/listen?{query_str}"

    return ws_url, endpoint_path


class DeepgramStreamSession:
    """
    Manages a resilient streaming WebSocket session to Deepgram STT (Flux /v2/listen or Nova /v1/listen).
    Handles conversational TurnInfo events, EndOfTurn, interim/final transcripts, and auto-reconnection.
    """

    def __init__(
        self,
        api_key: str,
        on_transcript: Callable[[dict], None],
        on_error: Callable[[str], None],
        sample_rate: int = 48000,
        model: Optional[str] = None,
    ):
        self.api_key = api_key
        self.on_transcript = on_transcript
        self.on_error = on_error
        self.sample_rate = sample_rate
        self.model = model or settings.DEEPGRAM_MODEL or "flux-general-en"
        self.ws = None
        self.recv_task = None
        self.keep_alive_task = None
        self.is_closed = False
        self.first_audio_logged = False
        self._lock = asyncio.Lock()
        self.endpoint_path = "/v2/listen" if self.model.startswith("flux-") else "/v1/listen"

    def is_ws_open(self) -> bool:
        if self.ws is None:
            return False
        state = getattr(self.ws, "state", None)
        if state is not None:
            return getattr(state, "name", "") == "OPEN"
        return getattr(self.ws, "open", True)

    async def connect(self) -> bool:
        if self.is_closed:
            return False
        if self.is_ws_open():
            return True

        headers = {
            "Authorization": f"Token {self.api_key}",
        }

        ws_url, endpoint_path = build_deepgram_ws_url(
            model=self.model,
            sample_rate=self.sample_rate,
            language=settings.DEEPGRAM_LANGUAGE or "en",
        )
        self.endpoint_path = endpoint_path

        try:
            t_connect = time.time()
            logger.info(f"[STT] Connecting to Deepgram {endpoint_path} (model: {self.model}, rate: {self.sample_rate}Hz)...")

            import inspect
            sig = inspect.signature(websockets.connect)
            connect_kwargs = {
                "ping_interval": None,
                "ping_timeout": None,
            }
            if "additional_headers" in sig.parameters:
                connect_kwargs["additional_headers"] = headers
            else:
                connect_kwargs["extra_headers"] = headers

            if self.recv_task and not self.recv_task.done():
                self.recv_task.cancel()
            if self.keep_alive_task and not self.keep_alive_task.done():
                self.keep_alive_task.cancel()

            self.ws = await websockets.connect(ws_url, **connect_kwargs)
            t_open = time.time()
            logger.info(f"[STT] Deepgram WebSocket opened ({endpoint_path}) in {(t_open - t_connect) * 1000:.1f}ms")

            self.recv_task = asyncio.create_task(self._receive_loop())
            # Note: Deepgram Flux (/v2/listen) does not support {"type": "KeepAlive"} text frames and drops with UNPARSABLE_CLIENT_MESSAGE.
            # Continuous streaming of audio frames maintains the connection. Only start keep-alive loop on legacy /v1/listen.
            if not self.endpoint_path.startswith("/v2"):
                self.keep_alive_task = asyncio.create_task(self._keep_alive_loop())
            return True
        except Exception as e:
            logger.error(f"[STT] Deepgram connection error: {e}")
            self.on_error(f"Deepgram connection error: {e}")
            self.ws = None
            return False

    async def _receive_loop(self):
        try:
            if not self.ws:
                return
            async for message in self.ws:
                data = json.loads(message)
                msg_type = data.get("type")

                # Handle Flux /v2/listen Connected confirmation
                if msg_type == "Connected":
                    req_id = data.get("request_id", "")
                    logger.info(f"[STT] Deepgram Flux Connected (request_id={req_id})")
                    continue

                # Handle Deepgram Error messages without crashing the loop
                if msg_type == "Error":
                    logger.warning(f"[STT] Deepgram warning/error payload: {data}")
                    continue

                # Handle Flux /v2/listen TurnInfo events (EndOfTurn, EagerEndOfTurn)
                if msg_type == "TurnInfo":
                    event = data.get("event")
                    transcript = data.get("transcript", "").strip()
                    confidence = data.get("end_of_turn_confidence", 0.9)

                    if transcript:
                        t_trans = time.time()
                        if event == "EndOfTurn":
                            logger.info(f"[STT-FLUX] EndOfTurn: '{transcript}' (confidence={confidence})")
                            self.on_transcript({
                                "text": transcript,
                                "is_final": True,
                                "speech_final": True,
                                "confidence": confidence,
                                "timestamp": t_trans,
                                "stt_model": self.model,
                                "stt_endpoint": self.endpoint_path,
                                "turn_event": "EndOfTurn",
                            })
                        elif event == "EagerEndOfTurn":
                            logger.info(f"[STT-FLUX] EagerEndOfTurn: '{transcript}'")
                            self.on_transcript({
                                "text": transcript,
                                "is_final": True,
                                "speech_final": False,
                                "confidence": confidence,
                                "timestamp": t_trans,
                                "stt_model": self.model,
                                "stt_endpoint": self.endpoint_path,
                                "turn_event": "EagerEndOfTurn",
                            })
                        else:
                            # Streamed interim turn transcript
                            logger.debug(f"[STT-FLUX] partial: '{transcript}'")
                            self.on_transcript({
                                "text": transcript,
                                "is_final": False,
                                "speech_final": False,
                                "confidence": confidence,
                                "timestamp": t_trans,
                                "stt_model": self.model,
                                "stt_endpoint": self.endpoint_path,
                                "turn_event": event or "Interim",
                            })
                    continue

                # Handle Standard /v1/listen Results messages (Nova-2 / Nova-3)
                if msg_type == "Results":
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [{}])
                    if alternatives:
                        transcript = alternatives[0].get("transcript", "").strip()
                        is_final = data.get("is_final", False)
                        speech_final = data.get("speech_final", False)
                        confidence = alternatives[0].get("confidence", 0.0)

                        if transcript:
                            t_trans = time.time()
                            if speech_final:
                                logger.info(f"[STT] speech_final: '{transcript}'")
                            elif is_final:
                                logger.info(f"[STT] chunk_final: '{transcript}'")
                            else:
                                logger.debug(f"[STT] partial: '{transcript}'")

                            self.on_transcript({
                                "text": transcript,
                                "is_final": is_final,
                                "speech_final": speech_final,
                                "confidence": confidence,
                                "timestamp": t_trans,
                                "stt_model": self.model,
                                "stt_endpoint": self.endpoint_path,
                            })
                    continue

                # Handle UtteranceEnd backstop signal
                if msg_type == "UtteranceEnd":
                    t_trans = time.time()
                    logger.info(f"[STT] deepgram_utterance_end={t_trans:.3f}")
                    self.on_transcript({
                        "text": "",
                        "is_final": True,
                        "speech_final": True,
                        "confidence": 1.0,
                        "timestamp": t_trans,
                        "stt_model": self.model,
                        "stt_endpoint": self.endpoint_path,
                        "turn_event": "UtteranceEnd",
                    })

        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"[STT] Deepgram stream closed ({e.code}). Auto-reconnect ready for next utterance.")
            self.ws = None
        except Exception as e:
            if not self.is_closed:
                logger.error(f"[STT] Error in Deepgram receive loop: {e}")
                self.on_error(str(e))
                self.ws = None

    async def _keep_alive_loop(self):
        try:
            while not self.is_closed:
                await asyncio.sleep(4)
                if self.is_ws_open() and not self.endpoint_path.startswith("/v2"):
                    try:
                        await self.ws.send(json.dumps({"type": "KeepAlive"}))
                    except Exception:
                        break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"[STT] KeepAlive loop notice: {e}")

    async def send_audio_chunk(self, chunk: bytes):
        if self.is_closed:
            return

        async with self._lock:
            if not self.is_ws_open():
                logger.info("[STT] Deepgram stream reconnecting for incoming speech chunk...")
                ok = await self.connect()
                if not ok or not self.is_ws_open():
                    return

            try:
                if not self.first_audio_logged:
                    self.first_audio_logged = True
                    logger.info(f"[STT] deepgram_first_audio_accepted={time.time():.3f} bytes={len(chunk)}")
                await self.ws.send(chunk)
            except Exception as e:
                logger.error(f"[STT] Failed to send audio chunk to Deepgram: {e}")
                if self.ws:
                    try:
                        await self.ws.close()
                    except Exception:
                        pass
                self.ws = None

    async def close(self):
        self.is_closed = True
        if self.recv_task:
            self.recv_task.cancel()
        if self.keep_alive_task:
            self.keep_alive_task.cancel()
        if self.is_ws_open():
            try:
                await self.ws.send(b"")
                await self.ws.close()
            except Exception:
                pass


class DeepgramSTTService:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or settings.DEEPGRAM_API_KEY
        self.model = model or settings.DEEPGRAM_MODEL or "flux-general-en"
        self.is_configured = bool(
            self.api_key and "your_deepgram" not in self.api_key and len(self.api_key) > 10
        )
        self.endpoint_path = "/v2/listen" if self.model.startswith("flux-") else "/v1/listen"

    async def create_deepgram_stream(
        self,
        on_transcript: Callable[[dict], None],
        on_error: Callable[[str], None],
        sample_rate: int = 48000,
    ):
        """
        Creates an auto-reconnecting Deepgram live streaming session.
        Returns a tuple: (send_audio_chunk, close_stream)
        """
        if not self.is_configured:
            logger.warning("[STT] Deepgram API key not configured or placeholder used.")
            return None, None

        session = DeepgramStreamSession(
            api_key=self.api_key,
            on_transcript=on_transcript,
            on_error=on_error,
            sample_rate=sample_rate,
            model=self.model,
        )

        ok = await session.connect()
        if not ok:
            logger.warning("[STT] Initial Deepgram connection failed; will retry on first audio frame.")

        return session.send_audio_chunk, session.close
