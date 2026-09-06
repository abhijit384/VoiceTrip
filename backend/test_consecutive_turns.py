import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.api.session import process_user_transcript, ChatRequest, reset_session
from app.services.transcript_corrector import transcript_corrector


async def test_consecutive_turns():
    print("\n" + "=" * 60)
    print("TESTING CONSECUTIVE MULTI-TURN MESSAGES & CONTEXT ISOLATION")
    print("=" * 60)

    # Reset test session
    await reset_session(session_id="test_session_perf")

    # Turn 1: "Find hotels in Delly"
    t1_req = ChatRequest(session_id="test_session_perf", message="Find hotels in Delly", generation_id="gen_1")
    t1_res = await process_user_transcript(t1_req)
    print(f"Turn 1 Input: 'Find hotels in Delly'")
    print(f"  -> Raw: '{t1_res.raw_transcript}', Corrected: '{t1_res.corrected_transcript}'")
    print(f"  -> Response Type: {t1_res.response_type}, Intent: {t1_res.intent.intent if t1_res.intent else 'None'}")
    print(f"  -> Destination: {t1_res.canonical_context.destination if t1_res.canonical_context else 'None'}")
    assert t1_res.corrected_transcript == "Find hotels in Delhi"
    assert t1_res.canonical_context.destination == "Delhi"

    # Turn 2: "Find trains from Kolkatta to Mumbay"
    t2_req = ChatRequest(session_id="test_session_perf", message="Find trains from Kolkatta to Mumbay", generation_id="gen_2")
    t2_res = await process_user_transcript(t2_req)
    print(f"\nTurn 2 Input: 'Find trains from Kolkatta to Mumbay'")
    print(f"  -> Raw: '{t2_res.raw_transcript}', Corrected: '{t2_res.corrected_transcript}'")
    print(f"  -> Response Type: {t2_res.response_type}, Intent: {t2_res.intent.intent if t2_res.intent else 'None'}")
    print(f"  -> Origin: {t2_res.canonical_context.origin if t2_res.canonical_context else 'None'}")
    print(f"  -> Destination: {t2_res.canonical_context.destination if t2_res.canonical_context else 'None'}")
    assert "Kolkata" in t2_res.corrected_transcript
    assert "Mumbai" in t2_res.corrected_transcript
    assert t2_res.canonical_context.origin in ["Kolkata", "KOAA", "HWH", "SDAH"]
    assert t2_res.canonical_context.destination in ["Mumbai", "BCT", "CSMT", "LTT"]

    # Turn 3: "What about tomorrow?"
    t3_req = ChatRequest(session_id="test_session_perf", message="What about tomorrow?", generation_id="gen_3")
    t3_res = await process_user_transcript(t3_req)
    print(f"\nTurn 3 Input: 'What about tomorrow?'")
    print(f"  -> Raw: '{t3_res.raw_transcript}', Corrected: '{t3_res.corrected_transcript}'")
    print(f"  -> Intent: {t3_res.canonical_context.intent if t3_res.canonical_context else 'None'}")
    print(f"  -> Request Type: {t3_res.canonical_context.request_type if t3_res.canonical_context else 'None'}")
    print(f"  -> Preserved Origin: {t3_res.canonical_context.origin if t3_res.canonical_context else 'None'}")
    print(f"  -> Preserved Destination: {t3_res.canonical_context.destination if t3_res.canonical_context else 'None'}")
    print(f"  -> Updated Date: {t3_res.canonical_context.travel_date if t3_res.canonical_context else 'None'}")
    assert t3_res.canonical_context.origin in ["Kolkata", "KOAA", "HWH", "SDAH"]
    assert t3_res.canonical_context.destination in ["Mumbai", "BCT", "CSMT", "LTT"]
    assert t3_res.canonical_context.travel_date == "tomorrow"

    print("\n" + "=" * 60)
    print("ALL CONSECUTIVE MULTI-TURN ISOLATION TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_consecutive_turns())
