import asyncio
import pytest
from app.services.railway_normalizer import railway_normalizer
from app.services.gemini_service import GeminiService


def test_fixed_eight_phrases():
    phrases = [
        ("Book a train from Howrah to New Delhi.", "HWH", "NDLS", "tomorrow", "any"),
        ("Find trains from NJP to Howrah.", "NJP", "HWH", "tomorrow", "any"),
        ("I want to travel from New Jalpaiguri to Kolkata.", "NJP", "KOAA", "tomorrow", "any"),
        ("Show evening trains from Sealdah.", "SDAH", None, "tomorrow", "evening"),
        ("Find a train from Kharagpur to Delhi.", "KGP", "DLI", "tomorrow", "any"),
        ("The station is NJP.", "NJP", None, "tomorrow", "any"),
        ("Go from Howrah Junction tomorrow.", "HWH", None, "tomorrow", "any"),
        ("Find trains from Barddhaman to Kolkata.", "BWN", "KOAA", "tomorrow", "any"),
    ]

    for phrase, exp_orig, exp_dest, exp_date, exp_time in phrases:
        norm = railway_normalizer.normalize(phrase)
        entities = norm.entities
        print(f"\n[PHRASE]: {phrase}")
        print(f" -> Normalized: {norm.normalized_text}")
        print(f" -> Entities: {entities}")

        if exp_orig:
            assert entities.get("origin") == exp_orig, f"Failed origin for {phrase}: got {entities.get('origin')}, expected {exp_orig}"
        if exp_dest:
            assert entities.get("destination") == exp_dest, f"Failed dest for {phrase}: got {entities.get('destination')}, expected {exp_dest}"
        if exp_time != "any":
            assert entities.get("time_constraint") == exp_time, f"Failed time for {phrase}: got {entities.get('time_constraint')}, expected {exp_time}"


def test_acoustic_corrections_and_safety():
    # Misrecognized phrases that should correct
    corr_cases = [
        ("Find trains from and jp to Howrah tomorrow evening.", "NJP", "HWH", "evening"),
        ("the station is and jp.", "NJP", None, "any"),
        ("find trains from burdwan to kolkata.", "BWN", "KOAA", "any"),
        ("find a train from kharag pur to delhi.", "KGP", "DLI", "any"),
    ]
    for text, exp_orig, exp_dest, exp_time in corr_cases:
        norm = railway_normalizer.normalize(text)
        assert norm.entities.get("origin") == exp_orig, f"Correction failed for {text}: got {norm.entities}"

    # Ordinary English sentences that MUST NOT convert
    safety_cases = [
        "me and jp went to market",
        "just saying and thinking",
        "fish and chips for dinner",
    ]
    for text in safety_cases:
        norm = railway_normalizer.normalize(text)
        assert "NJP" not in norm.normalized_text, f"Safety failed: '{text}' falsely normalized to '{norm.normalized_text}'"


@pytest.mark.asyncio
async def test_interruption_followup_preservation():
    llm = GeminiService()
    # Turn 1: User says: "Find trains from NJP to Howrah tomorrow evening."
    history = [
        {"role": "user", "content": "Find trains from NJP to Howrah tomorrow evening."}
    ]
    res1 = await llm.chat_completion(history, tools=[{}])
    assert res1.tool_calls, "Expected tool call on Turn 1"
    args1 = res1.tool_calls[0].arguments
    assert args1["origin"] == "NJP"
    assert args1["destination"] == "HWH"
    assert args1["time_constraint"] == "evening"

    # Turn 2: User interrupts: "Actually, morning."
    history.append({"role": "assistant", "content": "I am looking for trains from NJP to Howrah tomorrow evening..."})
    history.append({"role": "user", "content": "Actually, morning."})

    res2 = await llm.chat_completion(history, tools=[{}])
    assert res2.tool_calls, "Expected tool call on Turn 2 after interruption"
    args2 = res2.tool_calls[0].arguments
    assert args2["origin"] == "NJP", f"Origin lost on follow-up: {args2}"
    assert args2["destination"] == "HWH", f"Destination lost on follow-up: {args2}"
    assert args2["time_constraint"] == "morning", f"Time constraint not updated: {args2}"
