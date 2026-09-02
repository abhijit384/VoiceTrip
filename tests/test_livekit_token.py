import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_livekit_token_get():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/livekit/token?room_name=test-room")
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert len(data["token"]) > 50
    assert data["room_name"] == "test-room"
    assert "participant_identity" in data
    assert "is_livekit_configured" in data


@pytest.mark.asyncio
async def test_livekit_token_post():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/livekit/token", json={"room_name": "custom-room", "participant_name": "Alice"})
    assert response.status_code == 200
    data = response.json()
    assert data["room_name"] == "custom-room"
    assert len(data["token"]) > 50
