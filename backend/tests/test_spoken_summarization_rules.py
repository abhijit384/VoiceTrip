import pytest
from app.services.gemini_service import GeminiService
from app.models.travel import CanonicalTravelContext
from app.services.tool_service import ToolService


@pytest.mark.asyncio
async def test_spoken_summary_trains_njp_howrah():
    """
    Test: 'Find trains from NJP to Howrah tomorrow.'
    Verifies that all returned trains are verbally summarized with names, departures, and fares.
    """
    gemini = GeminiService()
    tool_res = await ToolService.search_trains(
        origin="NJP",
        destination="HWH",
        date="tomorrow",
        time_constraint="any",
        generation_id="gen_train_test",
        delay_seconds=0.0,
    )

    ctx = CanonicalTravelContext(
        intent="train_search",
        origin="NJP",
        destination="HWH",
        travel_date="tomorrow",
        time_constraint="any",
    )

    summary = gemini._format_deterministic_tool_speech(tool_res.model_dump(), ctx)

    assert "train option" in summary.lower()
    assert "Shatabdi" in summary or "Saraighat" in summary or "Padatik" in summary or "Vande Bharat" in summary
    assert "₹" in summary or "fare" in summary
    assert "demo" not in summary.lower()


@pytest.mark.asyncio
async def test_spoken_summary_hotels_goa():
    """
    Test: 'Find hotels near Goa.'
    Verifies that returned hotels are verbally summarized with names and prices.
    """
    gemini = GeminiService()
    tool_res = await ToolService.search_hotels(
        destination="Goa",
        check_in_date="tomorrow",
        generation_id="gen_hotel_test",
    )

    ctx = CanonicalTravelContext(
        intent="hotel_search",
        destination="Goa",
        travel_date="tomorrow",
    )

    summary = gemini._format_deterministic_tool_speech(tool_res.model_dump(), ctx)

    assert "hotel option" in summary.lower()
    assert "Taj" in summary or "Heritage" in summary or "Resort" in summary or "Inn" in summary
    assert "₹" in summary or "night" in summary
    assert "demo" not in summary.lower()


@pytest.mark.asyncio
async def test_spoken_summary_flights_kolkata_delhi():
    """
    Test: 'Find flights from Kolkata to Delhi.'
    Verifies that returned flights are verbally summarized with airline, departure, arrival, and price.
    """
    gemini = GeminiService()
    tool_res = await ToolService.search_flights(
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        generation_id="gen_flight_test",
    )

    ctx = CanonicalTravelContext(
        intent="flight_search",
        origin="Kolkata",
        destination="Delhi",
        travel_date="tomorrow",
    )

    summary = gemini._format_deterministic_tool_speech(tool_res.model_dump(), ctx)

    assert "flight option" in summary.lower()
    assert "IndiGo" in summary or "Air India" in summary or "Vistara" in summary
    assert "departs" in summary or "departing" in summary
    assert "₹" in summary
    assert "demo" not in summary.lower()
