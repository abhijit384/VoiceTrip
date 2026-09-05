import pytest
import httpx
from main import app
from app.services.gemini_service import GeminiService
from app.services.tool_service import ToolService


@pytest.mark.asyncio
async def test_eight_turn_hotel_location_regression():
    """
    Tests the exact 8-turn sequence to ensure no unexpected Goa insertion occurs
    when continuing a conversation about Delhi or Mumbai.
    """
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        session_id = "test_hotel_regression_session"
        await client.post(f"/api/chat/reset?session_id={session_id}")

        # TURN 1: "Find hotels near Delhi."
        t1 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Find hotels near Delhi.",
            "generation_id": "gen_1",
        })
        assert t1.status_code == 200
        d1 = t1.json()
        assert d1["intent"]["intent"] == "hotel_search"
        assert d1["intent"]["destination"] == "Delhi"
        assert d1["tool_calls"][0]["name"] == "search_hotels"
        assert d1["tool_calls"][0]["arguments"]["destination"] == "Delhi"
        # Execute tool
        r1 = await ToolService.search_hotels(**d1["tool_calls"][0]["arguments"])
        assert r1.destination == "Delhi"
        for h in r1.hotels:
            assert "Goa" not in h.location
            assert "Goa" not in h.destination
            assert "Delhi" in h.destination or "Delhi" in h.location

        # TURN 2: "Which one is cheapest?"
        t2 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Which one is cheapest?",
            "generation_id": "gen_2",
        })
        assert t2.status_code == 200
        d2 = t2.json()
        assert d2["intent"]["intent"] == "hotel_search"
        assert d2["intent"]["destination"] == "Delhi"
        assert d2["tool_calls"][0]["name"] == "search_hotels"
        assert d2["tool_calls"][0]["arguments"]["destination"] == "Delhi"
        assert d2["tool_calls"][0]["arguments"].get("sort_by") == "cheapest"
        # Execute tool
        r2 = await ToolService.search_hotels(**d2["tool_calls"][0]["arguments"])
        assert r2.destination == "Delhi"
        assert len(r2.hotels) > 0
        assert r2.hotels[0].name == "Zostel Delhi Central"  # ₹950 cheapest in Delhi
        for h in r2.hotels:
            assert "Goa" not in h.location

        # TURN 3: "Show me more."
        t3 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Show me more.",
            "generation_id": "gen_3",
        })
        assert t3.status_code == 200
        d3 = t3.json()
        assert d3["intent"]["intent"] == "hotel_search"
        assert d3["intent"]["destination"] == "Delhi"
        assert d3["tool_calls"][0]["arguments"]["destination"] == "Delhi"
        r3 = await ToolService.search_hotels(**d3["tool_calls"][0]["arguments"])
        assert r3.destination == "Delhi"
        for h in r3.hotels:
            assert "Goa" not in h.location

        # TURN 4: "Which is closest to the city center?"
        t4 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Which is closest to the city center?",
            "generation_id": "gen_4",
        })
        assert t4.status_code == 200
        d4 = t4.json()
        assert d4["intent"]["intent"] == "hotel_search"
        assert d4["intent"]["destination"] == "Delhi"
        assert d4["tool_calls"][0]["arguments"]["destination"] == "Delhi"
        assert d4["tool_calls"][0]["arguments"].get("location_preference") == "city center"
        r4 = await ToolService.search_hotels(**d4["tool_calls"][0]["arguments"])
        assert r4.destination == "Delhi"
        for h in r4.hotels:
            assert "Goa" not in h.location

        # TURN 5: "Find hotels near Mumbai."
        t5 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Find hotels near Mumbai.",
            "generation_id": "gen_5",
        })
        assert t5.status_code == 200
        d5 = t5.json()
        assert d5["intent"]["intent"] == "hotel_search"
        assert d5["intent"]["destination"] == "Mumbai"
        assert d5["tool_calls"][0]["arguments"]["destination"] == "Mumbai"
        r5 = await ToolService.search_hotels(**d5["tool_calls"][0]["arguments"])
        assert r5.destination == "Mumbai"
        for h in r5.hotels:
            assert "Goa" not in h.location
            assert "Delhi" not in h.location

        # TURN 6: "Which one is cheapest?"
        t6 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Which one is cheapest?",
            "generation_id": "gen_6",
        })
        assert t6.status_code == 200
        d6 = t6.json()
        assert d6["intent"]["intent"] == "hotel_search"
        assert d6["intent"]["destination"] == "Mumbai"
        assert d6["tool_calls"][0]["arguments"]["destination"] == "Mumbai"
        assert d6["tool_calls"][0]["arguments"].get("sort_by") == "cheapest"
        r6 = await ToolService.search_hotels(**d6["tool_calls"][0]["arguments"])
        assert r6.destination == "Mumbai"
        assert r6.hotels[0].name == "Zostel Mumbai"  # ₹1100 cheapest in Mumbai

        # TURN 7: "Now find hotels near Goa."
        t7 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Now find hotels near Goa.",
            "generation_id": "gen_7",
        })
        assert t7.status_code == 200
        d7 = t7.json()
        assert d7["intent"]["intent"] == "hotel_search"
        assert d7["intent"]["destination"] == "Goa"
        assert d7["tool_calls"][0]["arguments"]["destination"] == "Goa"
        r7 = await ToolService.search_hotels(**d7["tool_calls"][0]["arguments"])
        assert r7.destination == "Goa"

        # TURN 8: "Which one is cheapest?"
        t8 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Which one is cheapest?",
            "generation_id": "gen_8",
        })
        assert t8.status_code == 200
        d8 = t8.json()
        assert d8["intent"]["intent"] == "hotel_search"
        assert d8["intent"]["destination"] == "Goa"
        assert d8["tool_calls"][0]["arguments"]["destination"] == "Goa"
        assert d8["tool_calls"][0]["arguments"].get("sort_by") == "cheapest"
        r8 = await ToolService.search_hotels(**d8["tool_calls"][0]["arguments"])
        assert r8.destination == "Goa"
        assert r8.hotels[0].name == "Zostel Goa Morjim"  # ₹1050 cheapest in Goa


@pytest.mark.asyncio
async def test_hotel_interruption_regression():
    """
    Tests audio interruption during hotel search flow to ensure context remains Delhi.
    """
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        session_id = "test_hotel_interrupt_session"
        await client.post(f"/api/chat/reset?session_id={session_id}")

        # G1: Find hotels near Delhi
        t1 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Find hotels near Delhi.",
            "generation_id": "gen_1",
        })
        assert t1.status_code == 200
        d1 = t1.json()
        assert d1["intent"]["destination"] == "Delhi"

        # User interrupts AI while speaking with follow-up: "Which one is cheapest?"
        t2 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Which one is cheapest?",
            "generation_id": "gen_2",
        })
        assert t2.status_code == 200
        d2 = t2.json()
        assert d2["intent"]["destination"] == "Delhi"
        assert d2["tool_calls"][0]["arguments"]["destination"] == "Delhi"
        assert d2["tool_calls"][0]["arguments"].get("sort_by") == "cheapest"

        # User now switches explicitly to Goa: "Actually, show hotels in Goa."
        t3 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Actually, show hotels in Goa.",
            "generation_id": "gen_3",
        })
        assert t3.status_code == 200
        d3 = t3.json()
        assert d3["intent"]["destination"] == "Goa"
        assert d3["tool_calls"][0]["arguments"]["destination"] == "Goa"

        # User asks cheapest in Goa: "Which one is cheapest?"
        t4 = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Which one is cheapest?",
            "generation_id": "gen_4",
        })
        assert t4.status_code == 200
        d4 = t4.json()
        assert d4["intent"]["destination"] == "Goa"
        assert d4["tool_calls"][0]["arguments"]["destination"] == "Goa"
        assert d4["tool_calls"][0]["arguments"].get("sort_by") == "cheapest"
