import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.api.session import process_user_transcript, ChatRequest, reset_session
from app.services.gemini_service import GeminiService


async def run_final_ux_tests():
    print("\n" + "=" * 70)
    print("RUNNING FINAL CHAT UX & MULTI-TURN CONTEXT VERIFICATION SUITE")
    print("=" * 70)

    # CASE 1: Greeting "hello"
    print("\n[TEST CASE 1] Input: 'hello'")
    sess_id = "test_ux_1"
    await reset_session(session_id=sess_id)
    r1 = await process_user_transcript(ChatRequest(session_id=sess_id, message="hello", generation_id="gen_1"))
    print(f"  -> Response Type: {r1.response_type} (Expected: text)")
    print(f"  -> Tool Calls: {len(r1.tool_calls)} (Expected: 0)")
    print(f"  -> AI Text: '{r1.text}'")
    assert r1.response_type == "text"
    assert len(r1.tool_calls) == 0
    print("  [PASS] CASE 1 PASSED")

    # CASE 2: Conversational "What can you do?"
    print("\n[TEST CASE 2] Input: 'What can you do?'")
    r2 = await process_user_transcript(ChatRequest(session_id=sess_id, message="What can you do?", generation_id="gen_2"))
    print(f"  -> Response Type: {r2.response_type} (Expected: text)")
    print(f"  -> Tool Calls: {len(r2.tool_calls)} (Expected: 0)")
    print(f"  -> AI Text: '{r2.text}'")
    assert r2.response_type == "text"
    assert len(r2.tool_calls) == 0
    print("  [PASS] CASE 2 PASSED")

    # CASE 3: Initial Travel Request "Find flights from Kolkata to Mumbai"
    print("\n[TEST CASE 3] Input: 'Find flights from Kolkata to Mumbai'")
    r3 = await process_user_transcript(ChatRequest(session_id=sess_id, message="Find flights from Kolkata to Mumbai", generation_id="gen_3"))
    print(f"  -> Response Type: {r3.response_type}")
    print(f"  -> Intent: {r3.canonical_context.intent if r3.canonical_context else 'None'}")
    print(f"  -> Origin: {r3.canonical_context.origin if r3.canonical_context else 'None'}")
    print(f"  -> Destination: {r3.canonical_context.destination if r3.canonical_context else 'None'}")
    assert r3.canonical_context.intent == "flight_search"
    assert r3.canonical_context.origin == "Kolkata"
    assert r3.canonical_context.destination == "Mumbai"
    print("  [PASS] CASE 3 PASSED")

    # CASE 4: Follow-up Short Answer "Tomorrow"
    print("\n[TEST CASE 4] Follow-up Input: 'Tomorrow.'")
    r4 = await process_user_transcript(ChatRequest(session_id=sess_id, message="Tomorrow.", generation_id="gen_4"))
    print(f"  -> Response Type: {r4.response_type}")
    print(f"  -> Intent: {r4.canonical_context.intent if r4.canonical_context else 'None'}")
    print(f"  -> Request Type: {r4.canonical_context.request_type if r4.canonical_context else 'None'}")
    print(f"  -> Preserved Origin: {r4.canonical_context.origin if r4.canonical_context else 'None'}")
    print(f"  -> Preserved Destination: {r4.canonical_context.destination if r4.canonical_context else 'None'}")
    print(f"  -> Updated Date: {r4.canonical_context.travel_date if r4.canonical_context else 'None'}")
    assert r4.canonical_context.intent == "flight_search"
    assert r4.canonical_context.origin in ["Kolkata", "KOAA", "HWH", "SDAH"]
    assert r4.canonical_context.destination in ["Mumbai", "CSMT", "BCT", "BVI", "BDTS"]
    assert r4.canonical_context.travel_date == "tomorrow"
    assert r4.canonical_context.request_type == "FOLLOW_UP"
    print("  [PASS] CASE 4 PASSED (Follow-up 'Tomorrow' correctly preserved route & flight intent!)")

    # CASE 5: Refinement "Which one is cheapest?"
    print("\n[TEST CASE 5] Follow-up Filter: 'Which one is cheapest?'")
    r5 = await process_user_transcript(ChatRequest(session_id=sess_id, message="Which one is cheapest?", generation_id="gen_5"))
    print(f"  -> Intent: {r5.canonical_context.intent if r5.canonical_context else 'None'}")
    print(f"  -> Sort By: {r5.canonical_context.sort_by if r5.canonical_context else 'None'}")
    print(f"  -> Preserved Origin: {r5.canonical_context.origin if r5.canonical_context else 'None'}")
    print(f"  -> Preserved Destination: {r5.canonical_context.destination if r5.canonical_context else 'None'}")
    assert r5.canonical_context.intent == "flight_search"
    assert r5.canonical_context.sort_by == "cheapest"
    assert r5.canonical_context.origin == "Kolkata"
    assert r5.canonical_context.destination == "Mumbai"
    print("  [PASS] CASE 5 PASSED (Refinement correctly filtered previous flight context!)")

    # CASE 6 & 7: New Chat + Independent Search "Find hotels in Delhi"
    print("\n[TEST CASE 6 & 7] New Chat Session -> 'Find hotels in Delhi'")
    sess_new = "test_ux_2"
    await reset_session(session_id=sess_new)
    r6 = await process_user_transcript(ChatRequest(session_id=sess_new, message="Find hotels in Delhi", generation_id="gen_1"))
    print(f"  -> Intent: {r6.canonical_context.intent if r6.canonical_context else 'None'}")
    print(f"  -> Destination: {r6.canonical_context.destination if r6.canonical_context else 'None'}")
    print(f"  -> Origin: {r6.canonical_context.origin if r6.canonical_context else 'None'}")
    assert r6.canonical_context.intent == "hotel_search"
    assert r6.canonical_context.destination == "Delhi"
    assert r6.canonical_context.origin is None  # 0 leakage from Session 1!
    print("  [PASS] CASE 6 & 7 PASSED (New Chat created independent state with 0 cross-session leakage!)")

    # CASE 8: Mode Switch "Okay. Search flights."
    print("\n[TEST CASE 8] Mode switch: 'Okay. Search flights.'")
    sess_switch = "test_ux_3"
    await reset_session(session_id=sess_switch)
    # Start with train query
    await process_user_transcript(ChatRequest(session_id=sess_switch, message="Trains from Kolkata to Mumbai", generation_id="gen_1"))
    # Switch to flights
    r8 = await process_user_transcript(ChatRequest(session_id=sess_switch, message="Okay. Search flights.", generation_id="gen_2"))
    print(f"  -> Intent: {r8.canonical_context.intent if r8.canonical_context else 'None'}")
    print(f"  -> Origin: {r8.canonical_context.origin if r8.canonical_context else 'None'}")
    print(f"  -> Destination: {r8.canonical_context.destination if r8.canonical_context else 'None'}")
    assert r8.canonical_context.intent == "flight_search"
    assert r8.canonical_context.origin in ["Kolkata", "KOAA", "HWH", "SDAH"]
    assert r8.canonical_context.destination in ["Mumbai", "CSMT", "BCT", "BVI", "BDTS"]
    print("  [PASS] CASE 8 PASSED ('Okay. Search flights.' correctly switched mode while preserving route!)")

    print("\n" + "=" * 70)
    print("ALL 8 VERIFICATION TEST CASES PASSED 100%!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_final_ux_tests())
