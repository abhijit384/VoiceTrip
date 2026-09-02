import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_tool_api_search_trains():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            "/api/tools/search_trains",
            json={
                "origin": "Kolkata",
                "destination": "Delhi",
                "date": "tomorrow",
                "time_constraint": "evening",
                "session_id": "test_api_session",
                "generation_id": "gen_1",
            },
        )
    # The default delay is 5.0 seconds in settings; test that endpoint responds
    assert res.status_code == 200
    data = res.json()
    assert "generation_id" in data
    assert data["generation_id"] == "gen_1"
    assert "trains" in data
    assert len(data["trains"]) > 0


@pytest.mark.asyncio
async def test_tool_api_interrupt():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            "/api/tools/interrupt?session_id=test_api_session&new_generation_id=gen_2"
        )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "interrupted"
    assert data["new_generation_id"] == "gen_2"
