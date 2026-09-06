import asyncio
import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.api.session import process_user_transcript, reset_session, ChatRequest
from app.services.gemini_service import GeminiService


async def run_all_travel_routing_tests():
    print("=" * 70)
    print("RUNNING FINAL TRAVEL CONTEXT + RESULT ROUTING TEST SUITE")
    print("=" * 70)

    # TEST 1: "Search Kolkata to, Mumbai flights."
    print("\n[TEST 1] 'Search Kolkata to, Mumbai flights.'")
    sess_1 = "test_route_sess_1"
    await reset_session(session_id=sess_1)
    r1 = await process_user_transcript(ChatRequest(session_id=sess_1, message="Search Kolkata to, Mumbai flights.", generation_id="gen_1"))
    print(f"  -> Response Type: {r1.response_type}")
    print(f"  -> Intent: {r1.canonical_context.intent if r1.canonical_context else 'None'}")
    print(f"  -> Origin: {r1.canonical_context.origin if r1.canonical_context else 'None'}")
    print(f"  -> Destination: {r1.canonical_context.destination if r1.canonical_context else 'None'}")
    assert r1.canonical_context is not None, "Context must not be None"
    assert r1.canonical_context.intent == "flight_search", f"Expected flight_search, got {r1.canonical_context.intent}"
    assert r1.canonical_context.origin == "Kolkata", f"Expected Kolkata, got {r1.canonical_context.origin}"
    assert r1.canonical_context.destination == "Mumbai", f"Expected Mumbai, got {r1.canonical_context.destination}"
    assert r1.response_type == "tool_call", "Must trigger flight search tool call"
    assert r1.tool_calls[0].name == "search_flights"
    print("  [PASS] TEST 1 PASSED (Exact flight search triggered, NOT Mumbai tourism info)")

    # TEST 2: "Flights from Kolkata to Hyderabad." (Immediately after Test 1 in same session)
    print("\n[TEST 2] 'Flights from Kolkata to Hyderabad.' (Same session, must overwrite Mumbai with Hyderabad)")
    r2 = await process_user_transcript(ChatRequest(session_id=sess_1, message="Flights from Kolkata to Hyderabad.", generation_id="gen_2"))
    print(f"  -> Response Type: {r2.response_type}")
    print(f"  -> Intent: {r2.canonical_context.intent if r2.canonical_context else 'None'}")
    print(f"  -> Origin: {r2.canonical_context.origin if r2.canonical_context else 'None'}")
    print(f"  -> Destination: {r2.canonical_context.destination if r2.canonical_context else 'None'}")
    assert r2.canonical_context is not None, "Context must not be None"
    assert r2.canonical_context.intent == "flight_search", f"Expected flight_search, got {r2.canonical_context.intent}"
    assert r2.canonical_context.origin == "Kolkata", f"Expected Kolkata, got {r2.canonical_context.origin}"
    assert r2.canonical_context.destination == "Hyderabad", f"Expected Hyderabad (0 Mumbai leakage), got {r2.canonical_context.destination}"
    assert r2.response_type == "tool_call", "Must trigger flight search tool call"
    assert r2.tool_calls[0].name == "search_flights"
    print("  [PASS] TEST 2 PASSED (Hyderabad flight search triggered, NOT generic greeting)")

    # TEST 3: "Kolkata to Delhi trains tonight?"
    print("\n[TEST 3] 'Kolkata to Delhi trains tonight?'")
    sess_3 = "test_route_sess_3"
    await reset_session(session_id=sess_3)
    r3 = await process_user_transcript(ChatRequest(session_id=sess_3, message="Kolkata to Delhi trains tonight?", generation_id="gen_1"))
    print(f"  -> Intent: {r3.canonical_context.intent if r3.canonical_context else 'None'}")
    print(f"  -> Origin: {r3.canonical_context.origin if r3.canonical_context else 'None'}")
    print(f"  -> Destination: {r3.canonical_context.destination if r3.canonical_context else 'None'}")
    print(f"  -> Time Constraint: {r3.canonical_context.time_constraint if r3.canonical_context else 'None'}")
    assert r3.canonical_context.intent == "train_search"
    assert r3.canonical_context.origin in ["Kolkata", "KOAA", "HWH", "SDAH"]
    assert r3.canonical_context.destination in ["Delhi", "NDLS", "DLI"]
    assert r3.canonical_context.time_constraint == "night"
    print("  [PASS] TEST 3 PASSED (Train search Kolkata -> Delhi tonight)")

    # TEST 4: "Find hotels in Delhi."
    print("\n[TEST 4] 'Find hotels in Delhi.'")
    sess_4 = "test_route_sess_4"
    await reset_session(session_id=sess_4)
    r4 = await process_user_transcript(ChatRequest(session_id=sess_4, message="Find hotels in Delhi.", generation_id="gen_1"))
    print(f"  -> Intent: {r4.canonical_context.intent if r4.canonical_context else 'None'}")
    print(f"  -> Destination: {r4.canonical_context.destination if r4.canonical_context else 'None'}")
    assert r4.canonical_context.intent == "hotel_search"
    assert r4.canonical_context.destination == "Delhi"
    print("  [PASS] TEST 4 PASSED (Hotel search in Delhi)")

    # TEST 5: "what can you do?"
    print("\n[TEST 5] 'what can you do?'")
    sess_5 = "test_route_sess_5"
    await reset_session(session_id=sess_5)
    r5 = await process_user_transcript(ChatRequest(session_id=sess_5, message="what can you do?", generation_id="gen_1"))
    print(f"  -> Intent: {r5.canonical_context.intent if r5.canonical_context else 'None'}")
    print(f"  -> Response: {r5.text[:60] if r5.text else 'None'}...")
    assert r5.canonical_context.intent == "conversational"
    assert r5.response_type == "text"
    assert len(r5.tool_calls) == 0
    print("  [PASS] TEST 5 PASSED (Conversational answer, 0 travel tools)")

    # TEST 6: "hello"
    print("\n[TEST 6] 'hello'")
    sess_6 = "test_route_sess_6"
    await reset_session(session_id=sess_6)
    r6 = await process_user_transcript(ChatRequest(session_id=sess_6, message="hello", generation_id="gen_1"))
    print(f"  -> Intent: {r6.canonical_context.intent if r6.canonical_context else 'None'}")
    assert r6.canonical_context.intent == "greeting"
    assert r6.response_type == "text"
    assert len(r6.tool_calls) == 0
    print("  [PASS] TEST 6 PASSED (Greeting, 0 travel tools)")

    # TEST 7: After "Kolkata to Mumbai flights", say "What about tomorrow?"
    print("\n[TEST 7] Follow-up 'What about tomorrow?' after 'Kolkata to Mumbai flights'")
    sess_7 = "test_route_sess_7"
    await reset_session(session_id=sess_7)
    await process_user_transcript(ChatRequest(session_id=sess_7, message="Kolkata to Mumbai flights", generation_id="gen_1"))
    r7 = await process_user_transcript(ChatRequest(session_id=sess_7, message="What about tomorrow?", generation_id="gen_2"))
    print(f"  -> Intent: {r7.canonical_context.intent if r7.canonical_context else 'None'}")
    print(f"  -> Origin: {r7.canonical_context.origin if r7.canonical_context else 'None'}")
    print(f"  -> Destination: {r7.canonical_context.destination if r7.canonical_context else 'None'}")
    print(f"  -> Date: {r7.canonical_context.travel_date if r7.canonical_context else 'None'}")
    assert r7.canonical_context.intent == "flight_search"
    assert r7.canonical_context.origin == "Kolkata"
    assert r7.canonical_context.destination == "Mumbai"
    assert r7.canonical_context.travel_date == "tomorrow"
    print("  [PASS] TEST 7 PASSED (Follow-up date merged with active Kolkata -> Mumbai flight search)")

    # TEST 8: "New Chat" -> "Kolkata to Hyderabad flights" (0 Mumbai context leakage)
    print("\n[TEST 8] New Chat -> 'Kolkata to Hyderabad flights'")
    sess_8 = "test_route_sess_8"
    await reset_session(session_id=sess_8)
    r8 = await process_user_transcript(ChatRequest(session_id=sess_8, message="Kolkata to Hyderabad flights", generation_id="gen_1"))
    print(f"  -> Intent: {r8.canonical_context.intent if r8.canonical_context else 'None'}")
    print(f"  -> Origin: {r8.canonical_context.origin if r8.canonical_context else 'None'}")
    print(f"  -> Destination: {r8.canonical_context.destination if r8.canonical_context else 'None'}")
    assert r8.canonical_context.intent == "flight_search"
    assert r8.canonical_context.origin == "Kolkata"
    assert r8.canonical_context.destination == "Hyderabad"
    print("  [PASS] TEST 8 PASSED (Completely fresh session with 0 context leakage)")

    print("\n" + "=" * 70)
    print("ALL 8 VERIFICATION TESTS PASSED 100%!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_all_travel_routing_tests())
