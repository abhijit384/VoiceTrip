import sys
import os
import time
import asyncio

# Ensure backend path is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.transcript_corrector import transcript_corrector
from app.services.railway_normalizer import railway_normalizer
from app.services.tool_service import ToolService
from app.core.config import settings


def test_autocorrection():
    print("\n" + "=" * 60)
    print("RUNNING STT AUTOCORRECTION TESTS")
    print("=" * 60)

    test_cases = [
        ("Kolkatta to Delly trains tonight", "Kolkata to Delhi trains tonight"),
        ("Find hotels in Delly", "Find hotels in Delhi"),
        ("Flights from Mumbay to Delhi", "Flights from Mumbai to Delhi"),
        ("Kolkata to Delhi", "Kolkata to Delhi"),
        ("hello", "hello"),
        ("what is Python?", "what is Python?"),
        ("tell me a joke", "tell me a joke"),
        ("Hotels in Banglore", "Hotels in Bangalore"),
        ("Show trains from Haura to Delhee", "Show trains from Howrah to Delhi"),
        ("an jp to sdah trains", "NJP to Sealdah trains"),
    ]

    all_passed = True
    for input_text, expected in test_cases:
        res = transcript_corrector.correct_transcript(input_text)
        actual = res.corrected_transcript
        is_ok = actual.lower() == expected.lower()
        status = "PASSED" if is_ok else "FAILED"
        if not is_ok:
            all_passed = False
        print(f"[{status}] Input: '{input_text}' -> Output: '{actual}' (Expected: '{expected}')")

    print("=" * 60)
    if all_passed:
        print("ALL AUTOCORRECTION TESTS PASSED!")
    else:
        print("SOME AUTOCORRECTION TESTS FAILED!")
    print("=" * 60)
    return all_passed


async def test_tool_performance():
    print("\n" + "=" * 60)
    print("RUNNING TOOL PERFORMANCE & TIMING TESTS")
    print("=" * 60)

    print(f"Default TOOL_ARTIFICIAL_DELAY_SECONDS: {settings.TOOL_ARTIFICIAL_DELAY_SECONDS}s")

    t0 = time.perf_counter()
    train_res = await ToolService.search_trains(origin="HWH", destination="NDLS", date="today", time_constraint="any")
    t_train = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    flight_res = await ToolService.search_flights(origin="Delhi", destination="Mumbai", date="tomorrow")
    t_flight = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    hotel_res = await ToolService.search_hotels(destination="Delhi", check_in_date="tomorrow")
    t_hotel = (time.perf_counter() - t0) * 1000

    print(f"search_trains execution time:  {t_train:.2f}ms (found {len(train_res.trains)} trains)")
    print(f"search_flights execution time: {t_flight:.2f}ms (found {len(flight_res.flights)} flights)")
    print(f"search_hotels execution time:  {t_hotel:.2f}ms (found {len(hotel_res.hotels)} hotels)")

    passed = t_train < 100 and t_flight < 100 and t_hotel < 100
    print("=" * 60)
    if passed:
        print("ALL TOOL PERFORMANCE BENCHMARKS PASSED (<100ms)!")
    else:
        print("PERFORMANCE BENCHMARK FAILED (Tools took too long)")
    print("=" * 60)
    return passed


async def main():
    corr_ok = test_autocorrection()
    perf_ok = await test_tool_performance()
    if not (corr_ok and perf_ok):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
