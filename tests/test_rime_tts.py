import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from app.services.tts_service import RimeTTSService


@pytest.mark.asyncio
async def test_rime_tts_service_instantiation():
    service = RimeTTSService(
        model_id="mist",
        speaker="amber",
        audio_format="mp3",
        sampling_rate=24000,
    )
    assert service.model_id == "mist"
    assert service.speaker == "amber"
    assert service.audio_format == "mp3"
    assert service.sampling_rate == 24000

    audio_bytes, content_type = await service.synthesize_bytes("Hello from Rime TTS")
    assert len(audio_bytes) > 1000
    assert content_type in ["audio/mpeg", "audio/wav", "audio/mp3"]


@pytest.mark.asyncio
async def test_rime_tts_api_endpoints():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Test info endpoint
        info_res = await ac.get("/api/tts/info")
        assert info_res.status_code == 200
        info = info_res.json()
        assert info["provider"] == "rime"
        assert info["model_id"] == "mist"
        assert info["speaker"] == "amber"

        # Test synthesize endpoint
        synth_res = await ac.post(
            "/api/tts/synthesize",
            json={"text": "I found 3 evening trains from Kolkata to Delhi tomorrow.", "generation_id": "gen_1"},
        )
        assert synth_res.status_code == 200
        assert len(synth_res.content) > 1000
        assert synth_res.headers.get("x-rime-speaker") == "amber"
        assert synth_res.headers.get("x-voice-provider") == "rime"
