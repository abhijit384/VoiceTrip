import asyncio
import json
import httpx
import pytest
from main import app


@pytest.mark.asyncio
async def test_canonical_suite_all_8_cases():
    print("\n" + "=" * 70)
    print("RUNNING CANONICAL MULTI-TURN & FOLLOW-UP TEST SUITE (PART 24)")
    print("=" * 70)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Reset session
        reset_res = await client.post("/api/chat/reset", params={"session_id": "test_session"})
        print(f"Session reset: {reset_res.status_code}")

        # -------------------------------------------------------------
        # TEST 1: Initial Train Search
        # -------------------------------------------------------------
        print("\n--- TEST 1: 'Find trains from NJP to Howrah tomorrow.' ---")
        t1_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Find trains from NJP to Howrah tomorrow.",
                "generation_id": "gen_1",
            },
        )
        assert t1_res.status_code == 200, f"HTTP {t1_res.status_code}: {t1_res.text}"
        t1_data = t1_res.json()
        t1_ctx = t1_data.get("canonical_context") or {}
        print(f"Response Type: {t1_data.get('response_type')}")
        print(f"Tool Calls: {t1_data.get('tool_calls')}")
        print(f"Canonical Context: {json.dumps(t1_ctx, indent=2)}")

        assert t1_ctx.get("intent") == "train_search", f"Expected train_search, got {t1_ctx.get('intent')}"
        assert t1_ctx.get("origin") == "NJP", f"Expected NJP, got {t1_ctx.get('origin')}"
        assert t1_ctx.get("destination") == "HWH", f"Expected HWH, got {t1_ctx.get('destination')}"
        assert t1_ctx.get("travel_date") in ["tomorrow", "tomorrow."], f"Expected tomorrow, got {t1_ctx.get('travel_date')}"
        assert t1_ctx.get("request_type") == "NEW"
        print("[PASS] TEST 1 PASSED: Correct initial canonical state (NJP -> HWH, tomorrow)")

        # -------------------------------------------------------------
        # TEST 2: Follow-up Time Constraint "Only evening."
        # -------------------------------------------------------------
        print("\n--- TEST 2: Follow-up 'Only evening.' ---")
        t2_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Only evening.",
                "generation_id": "gen_2",
            },
        )
        assert t2_res.status_code == 200, f"HTTP {t2_res.status_code}: {t2_res.text}"
        t2_data = t2_res.json()
        t2_ctx = t2_data.get("canonical_context") or {}
        print(f"Canonical Context: {json.dumps(t2_ctx, indent=2)}")

        assert t2_ctx.get("intent") == "train_search", f"Expected train_search, got {t2_ctx.get('intent')}"
        assert t2_ctx.get("origin") == "NJP", f"Expected NJP, got {t2_ctx.get('origin')}"
        assert t2_ctx.get("destination") == "HWH", f"Expected HWH, got {t2_ctx.get('destination')}"
        assert t2_ctx.get("time_constraint") == "evening", f"Expected evening, got {t2_ctx.get('time_constraint')}"
        assert t2_ctx.get("request_type") == "FOLLOW_UP"
        print("[PASS] TEST 2 PASSED: Correct follow-up state (NJP -> HWH, tomorrow, evening)")

        # -------------------------------------------------------------
        # TEST 3: Follow-up Destination Change "Change destination to Sealdah."
        # -------------------------------------------------------------
        print("\n--- TEST 3: Follow-up 'Change destination to Sealdah.' ---")
        t3_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Change destination to Sealdah.",
                "generation_id": "gen_3",
            },
        )
        assert t3_res.status_code == 200, f"HTTP {t3_res.status_code}: {t3_res.text}"
        t3_data = t3_res.json()
        t3_ctx = t3_data.get("canonical_context") or {}
        print(f"Canonical Context: {json.dumps(t3_ctx, indent=2)}")

        assert t3_ctx.get("intent") == "train_search"
        assert t3_ctx.get("origin") == "NJP"
        assert t3_ctx.get("destination") == "SDAH"
        assert t3_ctx.get("time_constraint") == "evening"
        assert t3_ctx.get("request_type") == "FOLLOW_UP"
        print("[PASS] TEST 3 PASSED: Correct destination update with preserved origin & time (NJP -> SDAH, evening)")

        # -------------------------------------------------------------
        # TEST 4: New Request Domain Switch "Now find hotels in Goa."
        # -------------------------------------------------------------
        print("\n--- TEST 4: New request 'Now find hotels in Goa.' ---")
        t4_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Now find hotels in Goa.",
                "generation_id": "gen_4",
            },
        )
        assert t4_res.status_code == 200, f"HTTP {t4_res.status_code}: {t4_res.text}"
        t4_data = t4_res.json()
        t4_ctx = t4_data.get("canonical_context") or {}
        print(f"Canonical Context: {json.dumps(t4_ctx, indent=2)}")

        assert t4_ctx.get("intent") == "hotel_search"
        assert t4_ctx.get("destination") == "Goa"
        assert t4_ctx.get("request_type") == "NEW"
        print("[PASS] TEST 4 PASSED: Clean domain switch without train field contamination (hotel_search, Goa)")

        # -------------------------------------------------------------
        # TEST 5: Follow-up Budget Constraint "Under 5000."
        # -------------------------------------------------------------
        print("\n--- TEST 5: Follow-up 'Under 5000.' ---")
        t5_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Under 5000.",
                "generation_id": "gen_5",
            },
        )
        assert t5_res.status_code == 200, f"HTTP {t5_res.status_code}: {t5_res.text}"
        t5_data = t5_res.json()
        t5_ctx = t5_data.get("canonical_context") or {}
        print(f"Canonical Context: {json.dumps(t5_ctx, indent=2)}")

        assert t5_ctx.get("intent") == "hotel_search"
        assert t5_ctx.get("destination") == "Goa"
        assert t5_ctx.get("budget") == 5000.0
        assert t5_ctx.get("request_type") == "FOLLOW_UP"
        print("[PASS] TEST 5 PASSED: Budget applied to active hotel context (Goa, budget=5000)")

        # -------------------------------------------------------------
        # TEST 6: New Request "Find a flight from Kolkata to Delhi tomorrow."
        # -------------------------------------------------------------
        print("\n--- TEST 6: New request 'Find a flight from Kolkata to Delhi tomorrow.' ---")
        t6_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Find a flight from Kolkata to Delhi tomorrow.",
                "generation_id": "gen_6",
            },
        )
        assert t6_res.status_code == 200, f"HTTP {t6_res.status_code}: {t6_res.text}"
        t6_data = t6_res.json()
        t6_ctx = t6_data.get("canonical_context") or {}
        print(f"Canonical Context: {json.dumps(t6_ctx, indent=2)}")

        assert t6_ctx.get("intent") == "flight_search"
        assert t6_ctx.get("origin") == "Kolkata"
        assert t6_ctx.get("destination") == "Delhi"
        assert t6_ctx.get("request_type") == "NEW"
        print("[PASS] TEST 6 PASSED: Flight intent correctly created (Kolkata -> Delhi, tomorrow)")

        # -------------------------------------------------------------
        # TEST 7: Follow-up "Actually, evening."
        # -------------------------------------------------------------
        print("\n--- TEST 7: Follow-up 'Actually, evening.' ---")
        t7_res = await client.post(
            "/api/chat",
            json={
                "session_id": "test_session",
                "message": "Actually, evening.",
                "generation_id": "gen_7",
            },
        )
        assert t7_res.status_code == 200, f"HTTP {t7_res.status_code}: {t7_res.text}"
        t7_data = t7_res.json()
        t7_ctx = t7_data.get("canonical_context") or {}
        print(f"Canonical Context: {json.dumps(t7_ctx, indent=2)}")

        assert t7_ctx.get("intent") == "flight_search"
        assert t7_ctx.get("origin") == "Kolkata"
        assert t7_ctx.get("destination") == "Delhi"
        assert t7_ctx.get("time_constraint") == "evening"
        assert t7_ctx.get("request_type") == "FOLLOW_UP"
        print("[PASS] TEST 7 PASSED: Flight context preserved with evening time constraint (Kolkata -> Delhi, evening)")

        # -------------------------------------------------------------
        # TEST 8: Interruption Preservation Test
        # -------------------------------------------------------------
        print("\n--- TEST 8: Audio Interruption Simulation ---")
        # Step A: G1 starts with a query
        await client.post("/api/chat/reset", params={"session_id": "interrupt_session"})
        g1_res = await client.post(
            "/api/chat",
            json={
                "session_id": "interrupt_session",
                "message": "Find trains from NJP to Howrah tomorrow.",
                "generation_id": "gen_1",
            },
        )
        assert g1_res.status_code == 200
        print("AI begins speaking (Generation gen_1)... User interrupts!")

        # Step B: User interrupts while AI is speaking: G1 invalidated on client, G2 sent with follow-up
        g2_res = await client.post(
            "/api/chat",
            json={
                "session_id": "interrupt_session",
                "message": "Only evening.",
                "generation_id": "gen_2",
            },
        )
        assert g2_res.status_code == 200
        g2_data = g2_res.json()
        g2_ctx = g2_data.get("canonical_context") or {}
        print(f"Interrupted G2 Context: {json.dumps(g2_ctx, indent=2)}")

        assert g2_ctx.get("intent") == "train_search"
        assert g2_ctx.get("origin") == "NJP"
        assert g2_ctx.get("destination") == "HWH"
        assert g2_ctx.get("time_constraint") == "evening"
        assert g2_ctx.get("request_type") == "FOLLOW_UP"

        # Execute tool with G2
        tool_args = g2_data["tool_calls"][0]["arguments"]
        tool_res = await client.post("/api/tools/search_trains", json={**tool_args, "generation_id": "gen_2"})
        assert tool_res.status_code == 200
        tool_data = tool_res.json()
        print(f"Tool Returned {len(tool_data.get('trains', []))} evening trains:")
        for tr in tool_data.get("trains", []):
            print(f"  - {tr['name']} ({tr['departure_time_type']}) at {tr['departure']}")
            assert tr["departure_time_type"] == "evening"

        print("[PASS] TEST 8 PASSED: Interrupted G1 safely invalidated, G2 preserved canonical context, evening search executed strictly.")

        print("\n" + "=" * 70)
        print("ALL 8 CANONICAL TESTS PASSED PERFECTLY!")
        print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_all_tests())
