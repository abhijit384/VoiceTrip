import pytest
from starlette.testclient import TestClient
from main import app


def test_websocket_stt_handshake():
    client = TestClient(app)
    with client.websocket_connect("/api/ws/stt") as websocket:
        # Handshake message received on connect
        ready_msg = websocket.receive_json()
        assert ready_msg["type"] == "stt_ready"
        assert "deepgram_configured" in ready_msg

        # Test ping / pong
        websocket.send_json({"type": "ping"})
        pong_msg = websocket.receive_json()
        assert pong_msg["type"] == "pong"
        assert "timestamp" in pong_msg

        # Test simulated audio / client transcript echo
        websocket.send_json({
            "type": "client_transcript",
            "text": "Find me trains from Kolkata to Delhi tomorrow",
            "is_final": True,
        })
        transcript_msg = websocket.receive_json()
        assert transcript_msg["type"] == "transcript"
        assert transcript_msg["text"] == "Find me trains from Kolkata to Delhi tomorrow"
        assert transcript_msg["is_final"] is True
