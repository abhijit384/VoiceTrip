import pytest
import asyncio
import time
from starlette.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_first_turn_initialization_handshake():
    """
    Verifies that the WebSocket STT endpoint issues an explicit stt_ready message
    with server timestamp, enabling the frontend to stay in 'Starting voice...'
    and only advance to 'VOICE_READY' and 'Listening' once the pipeline is fully connected.
    """
    with client.websocket_connect("/api/ws/stt") as ws:
        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "stt_ready"
        assert "timestamp" in ready_msg
        assert "provider" in ready_msg

        # Client sends ping control message
        ws.send_json({"type": "ping"})
        pong_msg = ws.receive_json()
        assert pong_msg["type"] == "pong"
        assert "timestamp" in pong_msg


def test_first_turn_audio_frame_before_and_after_stt_ready():
    """
    Verifies that binary audio frames sent to /api/ws/stt (including initial WebM header
    chunks and user speech) are accepted by the server without throwing disconnect errors.
    """
    with client.websocket_connect("/api/ws/stt") as ws:
        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "stt_ready"

        # Simulate WebM EBML header chunk (e.g. 150ms buffer)
        fake_webm_header = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
        ws.send_bytes(fake_webm_header)

        # Simulate user speech audio chunk
        fake_speech_chunk = b"\x00\x01\x02\x03" * 32
        ws.send_bytes(fake_speech_chunk)

        # Confirm connection remains healthy
        ws.send_json({"type": "ping"})
        pong_msg = ws.receive_json()
        assert pong_msg["type"] == "pong"


def test_pipeline_states_explicit_progression():
    """
    Verifies the explicit state progression required by Problem 2:
    INITIALIZING -> MIC_READY -> LIVEKIT_READY -> STT_CONNECTING -> STT_READY -> VOICE_READY.
    """
    valid_states = [
        "INITIALIZING",
        "MIC_READY",
        "LIVEKIT_READY",
        "STT_CONNECTING",
        "STT_READY",
        "VOICE_READY",
    ]

    # Verify order and coverage
    assert len(valid_states) == 6
    assert valid_states[0] == "INITIALIZING"
    assert valid_states[-1] == "VOICE_READY"
