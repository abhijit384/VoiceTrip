import pytest
import httpx
from app.services.gemini_service import GeminiService
from app.services.tool_service import ToolService
from app.models.travel import TravelIntent
from main import app


@pytest.mark.asyncio
async def test_all_individual_intent_classifications():
    gemini = GeminiService()

    # 1. Train Search
    intent1 = await gemini.extract_travel_intent("Find trains from NJP to Howrah tomorrow evening.")
    assert intent1.intent == "train_search"
    assert intent1.origin in ["NJP", "NEW JALPAIGURI", "New Jalpaiguri"]
    assert intent1.destination in ["HWH", "HOWRAH", "Howrah"]
    assert intent1.time_constraint == "evening"

    # 2. Flight Search
    intent2 = await gemini.extract_travel_intent("Find a flight from Kolkata to Delhi tomorrow.")
    assert intent2.intent == "flight_search"
    assert "Kolkata" in str(intent2.origin)
    assert "Delhi" in str(intent2.destination)

    # 3. Hotel Search
    intent3 = await gemini.extract_travel_intent("Find hotels in Goa under 5000 rupees.")
    assert intent3.intent == "hotel_search"
    assert "Goa" in str(intent3.destination)
    if intent3.budget is not None:
        assert intent3.budget == 5000.0

    # 4. Destination Info
    intent4 = await gemini.extract_travel_intent("What are the best places to visit in Jaipur?")
    assert intent4.intent == "destination_info"
    assert "Jaipur" in str(intent4.destination)

    # 5. Itinerary Planning
    intent5 = await gemini.extract_travel_intent("Plan a three day Goa trip.")
    assert intent5.intent == "itinerary_planning"
    assert "Goa" in str(intent5.destination)

    # 6. Travel Advice / Packing
    intent6 = await gemini.extract_travel_intent("What should I pack for a trip to Kashmir?")
    assert intent6.intent == "travel_advice"
    assert "Kashmir" in str(intent6.destination)

    # 7. General Travel / Best Time
    intent7 = await gemini.extract_travel_intent("What is the best time to visit Sikkim?")
    assert intent7.intent == "general_travel"
    assert "Sikkim" in str(intent7.destination)

    # 8. Route Search
    intent8 = await gemini.extract_travel_intent("How do I get from Kolkata to Darjeeling?")
    assert intent8.intent == "route_search"
    assert "Kolkata" in str(intent8.origin)
    assert "Darjeeling" in str(intent8.destination)


@pytest.mark.asyncio
async def test_tool_registry_and_grounded_results():
    # 1. Flight Tool
    flight_res = await ToolService.search_flights("Kolkata", "Delhi", "tomorrow", "morning")
    assert flight_res.source == "demo"
    assert flight_res.type == "flight_search"
    assert len(flight_res.flights) > 0
    assert flight_res.flights[0].airline in ["IndiGo", "Air India", "Vistara", "SpiceJet"]

    # 2. Hotel Tool
    hotel_res = await ToolService.search_hotels("Goa", "tomorrow", 2, budget=5000.0)
    assert hotel_res.source == "demo"
    assert hotel_res.type == "hotel_search"
    assert len(hotel_res.hotels) > 0
    for h in hotel_res.hotels:
        assert h.price_per_night <= 5000.0

    # 3. Route Tool
    route_res = await ToolService.get_route_options("Kolkata", "Darjeeling")
    assert route_res.source == "demo"
    assert route_res.type == "route_search"
    assert len(route_res.routes) > 0

    # 4. Destination Info Tool
    dest_res = await ToolService.get_destination_info("Jaipur")
    assert dest_res.source == "demo"
    assert dest_res.type == "destination_info"
    assert "Amber Fort" in dest_res.top_attractions


@pytest.mark.asyncio
async def test_six_turn_acceptance_multi_intent_flow():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        session_id = "test_multi_intent_session"
        await client.post(f"/api/chat/reset?session_id={session_id}")

        # Turn 1: "Find trains from NJP to Howrah tomorrow."
        t1_res = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Find trains from NJP to Howrah tomorrow.",
            "generation_id": "gen_1",
        })
        assert t1_res.status_code == 200
        t1_data = t1_res.json()
        assert t1_data["intent"]["intent"] == "train_search"
        assert t1_data["response_type"] == "tool_call"
        assert t1_data["tool_calls"][0]["name"] == "search_trains"

        # Turn 2: "Only evening trains."
        t2_res = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Only evening trains.",
            "generation_id": "gen_1",
        })
        assert t2_res.status_code == 200
        t2_data = t2_res.json()
        assert t2_data["intent"]["intent"] == "train_search"
        assert t2_data["intent"]["time_constraint"] == "evening"
        assert t2_data["intent"]["origin"] in ["NJP", "NEW JALPAIGURI", "New Jalpaiguri"]
        assert t2_data["intent"]["destination"] in ["HWH", "HOWRAH", "Howrah"]

        # Turn 3: "Now find hotels in Goa."
        t3_res = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Now find hotels in Goa.",
            "generation_id": "gen_1",
        })
        assert t3_res.status_code == 200
        t3_data = t3_res.json()
        assert t3_data["intent"]["intent"] == "hotel_search"
        assert t3_data["intent"]["destination"] == "Goa"
        assert t3_data["response_type"] == "tool_call"
        assert t3_data["tool_calls"][0]["name"] == "search_hotels"

        # Turn 4: "What are the best places to visit there?"
        t4_res = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "What are the best places to visit there?",
            "generation_id": "gen_1",
        })
        assert t4_res.status_code == 200
        t4_data = t4_res.json()
        assert t4_data["intent"]["intent"] == "destination_info"
        assert t4_data["intent"]["destination"] == "Goa"
        # Must not mention trains or call search_trains
        if t4_data["response_type"] == "text":
            assert "train" not in t4_data["text"].lower()

        # Turn 5: "Now find a flight from Kolkata to Delhi."
        t5_res = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Now find a flight from Kolkata to Delhi.",
            "generation_id": "gen_1",
        })
        assert t5_res.status_code == 200
        t5_data = t5_res.json()
        assert t5_data["intent"]["intent"] == "flight_search"
        assert t5_data["response_type"] == "tool_call"
        assert t5_data["tool_calls"][0]["name"] == "search_flights"

        # Turn 6: "Actually tomorrow evening."
        t6_res = await client.post("/api/chat", json={
            "session_id": session_id,
            "message": "Actually tomorrow evening.",
            "generation_id": "gen_1",
        })
        assert t6_res.status_code == 200
        t6_data = t6_res.json()
        assert t6_data["intent"]["intent"] == "flight_search"
        assert t6_data["intent"]["time_constraint"] == "evening"
        assert "Kolkata" in str(t6_data["intent"]["origin"])
        assert "Delhi" in str(t6_data["intent"]["destination"])
