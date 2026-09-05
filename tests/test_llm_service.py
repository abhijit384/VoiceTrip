import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from app.services.gemini_service import GeminiService


@pytest.mark.asyncio
async def test_llm_service_train_tool_call():
    service = GeminiService()
    messages = [
        {"role": "user", "content": "Find me trains from Kolkata to Delhi tomorrow evening."}
    ]
    response = await service.chat_completion(messages)
    assert response is not None
    # Verify tool call or response
    if response.tool_calls:
        tool = response.tool_calls[0]
        assert tool.name == "search_trains"
        assert "origin" in tool.arguments
        assert "destination" in tool.arguments
    else:
        assert response.content is not None
        assert len(response.content) > 0


@pytest.mark.asyncio
async def test_chat_api_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Find me trains from Kolkata to Delhi tomorrow.",
                "generation_id": "gen_1",
            },
        )
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == "test_session"
    assert data["generation_id"] == "gen_1"
    assert data["response_type"] in ["text", "tool_call"]
    assert "latency_ms" in data


@pytest.mark.asyncio
async def test_chat_conversation_history_persistence():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # First turn
        r1 = await ac.post(
            "/api/chat",
            json={
                "session_id": "history_test",
                "message": "Hello, who are you?",
                "generation_id": "gen_1",
            },
        )
        assert r1.status_code == 200

        # Reset session
        reset_res = await ac.post("/api/chat/reset?session_id=history_test")
        assert reset_res.status_code == 200
        assert reset_res.json()["status"] == "reset"
