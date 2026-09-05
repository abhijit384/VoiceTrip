import pytest
from httpx import AsyncClient, ASGITransport
from app.core.config import settings
from main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["app"] == settings.APP_NAME
    assert "services" in data
    assert "rime_tts" in data["services"]
    assert "gemini_llm" in data["services"]
    assert "deepgram_stt" in data["services"]
    assert data["services"]["tool_delay_seconds"] == 5.0
