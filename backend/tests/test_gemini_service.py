import pytest
from app.services.gemini_service import GeminiService, ToolCall, LLMResponse
from app.services.railway_normalizer import railway_normalizer
from app.services.tool_service import ToolService
from app.models.travel import TravelIntent


@pytest.mark.asyncio
async def test_gemini_service_intent_extraction_case_1():
    """
    Test Case 1:
    User: "Find trains from NJP to Howrah tomorrow evening."
    Expected structured intent:
    origin = NJP
    destination = HWH
    date = tomorrow
    time = evening
    """
    gemini = GeminiService()
    intent = await gemini.extract_travel_intent("Find trains from NJP to Howrah tomorrow evening.")

    assert intent.intent in ["train_search", "general_query"]
    assert intent.origin == "NJP"
    assert intent.destination == "HWH"
    assert intent.travel_date == "tomorrow"
    assert intent.time_constraint == "evening"
    assert intent.passengers >= 1
    assert intent.needs_clarification is False


@pytest.mark.asyncio
async def test_gemini_service_intent_extraction_case_2_barge_in_refinement():
    """
    Test Case 2:
    Follow-up / Interruption:
    User: "Actually, morning."
    Expected:
    origin = NJP (preserved)
    destination = HWH (preserved)
    date = tomorrow (preserved)
    time = morning (updated)
    """
    gemini = GeminiService()
    prior_intent = TravelIntent(
        intent="train_search",
        origin="NJP",
        destination="HWH",
        travel_date="tomorrow",
        time_constraint="evening",
        passengers=1,
    )

    refined_intent = await gemini.extract_travel_intent(
        user_message="Actually, morning.",
        prior_intent=prior_intent,
    )

    assert refined_intent.origin == "NJP", f"Origin lost on refinement: {refined_intent.origin}"
    assert refined_intent.destination == "HWH", f"Destination lost on refinement: {refined_intent.destination}"
    assert refined_intent.travel_date == "tomorrow", f"Date lost on refinement: {refined_intent.travel_date}"
    assert refined_intent.time_constraint == "morning", f"Time constraint not updated: {refined_intent.time_constraint}"


@pytest.mark.asyncio
async def test_gemini_service_intent_extraction_case_3_destination_change():
    """
    Test Case 3:
    Follow-up:
    User: "Change destination to Sealdah."
    Expected:
    origin = NJP (preserved)
    destination = SDAH (updated)
    date = tomorrow (preserved)
    time = morning (preserved)
    """
    gemini = GeminiService()
    prior_intent = TravelIntent(
        intent="train_search",
        origin="NJP",
        destination="HWH",
        travel_date="tomorrow",
        time_constraint="morning",
        passengers=1,
    )

    updated_intent = await gemini.extract_travel_intent(
        user_message="Change destination to Sealdah.",
        prior_intent=prior_intent,
    )

    assert updated_intent.origin == "NJP", f"Origin lost on destination change: {updated_intent.origin}"
    assert updated_intent.destination == "SDAH", f"Destination not changed to SDAH: {updated_intent.destination}"
    assert updated_intent.travel_date == "tomorrow", f"Date lost: {updated_intent.travel_date}"
    assert updated_intent.time_constraint == "morning", f"Time lost: {updated_intent.time_constraint}"


@pytest.mark.asyncio
async def test_gemini_service_intent_extraction_case_4_aliases_and_defaults():
    """
    Test Case 4:
    User: "Find a train from New Jalpaiguri to Howrah tomorrow."
    Expected:
    origin = NJP
    destination = HWH
    date = tomorrow
    time = any (or default)
    """
    gemini = GeminiService()
    intent = await gemini.extract_travel_intent("Find a train from New Jalpaiguri to Howrah tomorrow.")

    assert intent.origin == "NJP"
    assert intent.destination == "HWH"
    assert intent.travel_date == "tomorrow"
    assert intent.time_constraint in ["any", "all"]


@pytest.mark.asyncio
async def test_gemini_service_chat_completion_triggers_tool():
    """
    Tests that chat_completion generates a search_trains tool call with structured parameters.
    """
    gemini = GeminiService()
    messages = [
        {"role": "user", "content": "Show me trains from NJP to Howrah tomorrow evening."}
    ]

    response = await gemini.chat_completion(messages)
    assert response.tool_calls, "Expected search_trains tool call"
    tool_call = response.tool_calls[0]
    assert tool_call.name == "search_trains"
    assert tool_call.arguments["origin"] == "NJP"
    assert tool_call.arguments["destination"] == "HWH"
    assert tool_call.arguments["time_constraint"] == "evening"


@pytest.mark.asyncio
async def test_gemini_service_generates_voice_response_for_rime():
    """
    Tests that after tool execution, Gemini synthesizes a concise spoken response for Rime TTS.
    """
    gemini = GeminiService()
    tool_res = await ToolService.search_trains(
        origin="NJP",
        destination="HWH",
        date="tomorrow",
        time_constraint="evening",
        generation_id="gen_test_1",
        delay_seconds=0.01,
    )

    prior_intent = TravelIntent(
        intent="train_search",
        origin="NJP",
        destination="HWH",
        travel_date="tomorrow",
        time_constraint="evening",
        passengers=1,
    )

    messages = [
        {"role": "user", "content": "Show me trains from NJP to Howrah tomorrow evening."},
        {"role": "tool", "content": tool_res.model_dump()},
    ]

    voice_response = await gemini.generate_response(
        messages=messages,
        tool_results=tool_res.model_dump(),
        prior_intent=prior_intent,
    )

    assert voice_response.content is not None
    assert len(voice_response.content) > 10
    # Voice guidelines: concise spoken response without markdown
    assert "*" not in voice_response.content
    assert "#" not in voice_response.content
    assert len(voice_response.content.split(".")) <= 4
