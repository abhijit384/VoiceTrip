import pytest
import asyncio
import base64
from fastapi.testclient import TestClient
from backend.main import app
from app.services.tts_service import RimeTTSService

client = TestClient(app)


@pytest.mark.asyncio
async def test_rime_base64_decoding_and_magic_headers():
    """
    Verifies that RimeTTSService correctly decodes base64-encoded audioContent JSON
    into pristine binary audio, properly identifying MP3 sync headers or WAV RIFF headers.
    """
    service = RimeTTSService()

    # Case 1: Valid synthesis (live API or fallback)
    audio_bytes, content_type = await service.synthesize_bytes("VoiceTrip audio test.")
    assert len(audio_bytes) > 0

    # Ensure it is not raw JSON text (which was the root cause of the pung-pung distortion)
    assert not audio_bytes.strip().startswith(b'{"')
    assert not audio_bytes.strip().startswith(b"audioContent")

    # Ensure valid binary audio header
    is_mp3 = audio_bytes[:3] == b"ID3" or (len(audio_bytes) > 1 and audio_bytes[0] == 0xFF and (audio_bytes[1] & 0xE0) == 0xE0)
    is_wav = audio_bytes[:4] == b"RIFF"
    assert is_mp3 or is_wav, f"Audio bytes header not valid MP3 or WAV: {audio_bytes[:8].hex()}"


def test_rime_synthesize_endpoint_generation_header():
    """
    Verifies that the /api/tts/synthesize endpoint attaches X-Generation-ID and X-Voice-Provider headers,
    enabling the client to drop stale audio when a newer user generation has started.
    """
    response = client.post(
        "/api/tts/synthesize",
        json={"text": "Searching trains to Delhi.", "generation_id": "gen_2"},
    )
    assert response.status_code == 200
    assert response.headers.get("X-Generation-ID") == "gen_2"
    assert response.headers.get("X-Voice-Provider") == "rime"
    assert len(response.content) > 0


def test_rime_info_endpoint():
    """
    Verifies the /api/tts/info endpoint exposes provider, model, and speaker settings.
    """
    response = client.get("/api/tts/info")
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "rime"
    assert "model_id" in data
    assert "speaker" in data
