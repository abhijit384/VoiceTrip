"""
Repeatable Evaluation Test Suite for Railway STT, Domain Normalization,
Structured Intent Extraction, and Deterministic Tool Invocations.
Covers all 7 benchmark test cases from Part 14.
"""
import pytest
import asyncio
from app.services.railway_normalizer import railway_normalizer
from app.services.tool_service import ToolService
from app.services.stt_service import build_deepgram_ws_url
from app.core.railway_vocabulary import DEEPGRAM_KEYTERMS
from app.models.travel import TravelIntent


# Part 14 Benchmark Evaluation Dataset
BENCHMARK_CASES = [
    {
        "id": 1,
        "phrase": "Find trains from NJP to Howrah tomorrow evening.",
        "expected_origin": "NJP",
        "expected_dest": "HWH",
        "expected_date": "tomorrow",
        "expected_time": "evening",
        "is_followup": False,
    },
    {
        "id": 2,
        "phrase": "Find trains from New Jalpaiguri to Howrah.",
        "expected_origin": "NJP",
        "expected_dest": "HWH",
        "expected_date": "tomorrow",
        "expected_time": "any",
        "is_followup": False,
    },
    {
        "id": 3,
        "phrase": "Show me trains from Howrah to New Delhi tomorrow morning.",
        "expected_origin": "HWH",
        "expected_dest": "NDLS",
        "expected_date": "tomorrow",
        "expected_time": "morning",
        "is_followup": False,
    },
    {
        "id": 4,
        "phrase": "I want to travel from Sealdah to Kharagpur.",
        "expected_origin": "SDAH",
        "expected_dest": "KGP",
        "expected_date": "tomorrow",
        "expected_time": "any",
        "is_followup": False,
    },
    {
        "id": 5,
        "phrase": "Find an evening train from NJP to Kolkata.",
        "expected_origin": "NJP",
        "expected_dest": "KOAA",
        "expected_date": "tomorrow",
        "expected_time": "evening",
        "is_followup": False,
    },
    {
        "id": 6,
        "phrase": "Actually, make that morning.",
        "expected_origin": "NJP",
        "expected_dest": "KOAA",
        "expected_date": "tomorrow",
        "expected_time": "morning",
        "is_followup": True, # Preserves origin and destination from Case 5
    },
    {
        "id": 7,
        "phrase": "Change the destination to Sealdah.",
        "expected_origin": "NJP",
        "expected_dest": "SDAH",
        "expected_date": "tomorrow",
        "expected_time": "morning",
        "is_followup": True, # Preserves origin (NJP) and time (morning) from Case 6
    },
]


def test_deepgram_flux_endpoint_and_keyterms_configuration():
    """Verify Flux model uses /v2/listen and unweighted Keyterm Prompting parameters."""
    ws_url, endpoint = build_deepgram_ws_url("flux-general-en", sample_rate=48000, language="en")
    assert endpoint == "/v2/listen"
    assert "wss://api.deepgram.com/v2/listen?" in ws_url
    assert "model=flux-general-en" in ws_url
    assert "keyterm=NJP" in ws_url
    assert "keyterm=Howrah" in ws_url
    assert "keyterm=Sealdah" in ws_url
    assert "keyterm=Kharagpur" in ws_url
    # Ensure no legacy weight colons are appended to Keyterm Prompting strings
    assert "keyterm=NJP:3" not in ws_url
    assert "keyterm=Howrah:2" not in ws_url


@pytest.mark.asyncio
async def test_full_evaluation_benchmark_suite():
    """
    Executes the 7 evaluation benchmark phrases and calculates:
    - Transcription Accuracy
    - Location Recognition Accuracy (Origin & Destination)
    - Date/Time Extraction Accuracy
    - Correct Tool Invocation Rate
    """
    total_cases = len(BENCHMARK_CASES)
    location_correct = 0
    date_time_correct = 0
    tool_invocation_correct = 0

    evaluation_report = []
    active_intent: TravelIntent = None

    for case in BENCHMARK_CASES:
        raw_phrase = case["phrase"]

        # Run Normalization & Intent Extraction
        norm_result = railway_normalizer.normalize(raw_phrase, prior_intent=active_intent)
        intent = norm_result.intent
        active_intent = intent # Update active context

        # Evaluate Origin & Destination Recognition
        loc_pass = (
            intent.origin == case["expected_origin"]
            and intent.destination == case["expected_dest"]
        )
        if loc_pass:
            location_correct += 1

        # Evaluate Date & Time Constraint
        dt_pass = (
            intent.travel_date == case["expected_date"]
            and intent.time_constraint == case["expected_time"]
        )
        if dt_pass:
            date_time_correct += 1

        # Execute Tool Search with Structured Parameters
        search_result = await ToolService.search_trains(
            origin=intent.origin,
            destination=intent.destination,
            date=intent.travel_date,
            time_constraint=intent.time_constraint,
            generation_id=f"gen_{case['id']}",
            delay_seconds=0.01,
        )

        tool_pass = (
            len(search_result.trains) > 0
            and search_result.origin == case["expected_origin"]
            and search_result.destination == case["expected_dest"]
        )
        if tool_pass:
            tool_invocation_correct += 1

        evaluation_report.append({
            "id": case["id"],
            "raw_phrase": raw_phrase,
            "normalized_transcript": norm_result.normalized_text,
            "intent": intent.model_dump(),
            "trains_found": len(search_result.trains),
            "sample_train": search_result.trains[0].name if search_result.trains else "None",
            "loc_pass": loc_pass,
            "dt_pass": dt_pass,
            "tool_pass": tool_pass,
        })

    loc_accuracy = (location_correct / total_cases) * 100
    dt_accuracy = (date_time_correct / total_cases) * 100
    tool_rate = (tool_invocation_correct / total_cases) * 100

    print("\n" + "=" * 80)
    print("RAILWAY STT & INTENT EVALUATION BENCHMARK RESULTS (PART 14)")
    print("=" * 80)
    for rep in evaluation_report:
        print(f"Case #{rep['id']}: \"{rep['raw_phrase']}\"")
        print(f"  -> Normalized: \"{rep['normalized_transcript']}\"")
        t_date = rep['intent'].get('date') or rep['intent'].get('travel_date')
        print(f"  -> Intent: origin={rep['intent']['origin']}, dest={rep['intent']['destination']}, date={t_date}, time={rep['intent']['time_constraint']}")
        print(f"  -> Tool Invocation: {rep['trains_found']} trains (e.g. {rep['sample_train']})")
        print(f"  -> Status: Loc={rep['loc_pass']} | DT={rep['dt_pass']} | Tool={rep['tool_pass']}")
        print("-" * 80)

    print(f"Location Recognition Accuracy: {loc_accuracy:.1f}% ({location_correct}/{total_cases})")
    print(f"Date/Time Extraction Accuracy: {dt_accuracy:.1f}% ({date_time_correct}/{total_cases})")
    print(f"Correct Tool Invocation Rate:  {tool_rate:.1f}% ({tool_invocation_correct}/{total_cases})")
    print("=" * 80)

    assert loc_accuracy == 100.0, f"Location accuracy {loc_accuracy}% was less than 100%"
    assert dt_accuracy == 100.0, f"Date/Time accuracy {dt_accuracy}% was less than 100%"
    assert tool_rate == 100.0, f"Tool invocation rate {tool_rate}% was less than 100%"


def test_acoustic_phonetic_contextual_guard():
    """Verify 'and jp' is converted to 'NJP' ONLY in railway/travel context, not in arbitrary English."""
    # Travel context: Should convert to NJP with explicit audit log
    travel_msg = "Book a train from and jp to howrah tomorrow."
    norm_travel = railway_normalizer.normalize(travel_msg)
    assert "NJP" in norm_travel.normalized_text
    assert norm_travel.intent.origin == "NJP"
    assert norm_travel.intent.destination == "HWH"
    assert len(norm_travel.corrections) > 0

    # Non-travel context: "Me and jp went to the park" should NOT blindly replace "and" with "NJP"
    non_travel_msg = "me and jp went to the cinema"
    norm_non_travel = railway_normalizer.normalize(non_travel_msg)
    assert "cinema" in norm_non_travel.normalized_text
    # Should not treat as railway search
    assert norm_non_travel.intent.intent in ("general_query", "general_travel")
