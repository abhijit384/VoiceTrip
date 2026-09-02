import uuid
import time
import asyncio
import logging
from typing import List, Optional
from app.core.config import settings
from app.models.travel import TrainItem, SearchTrainsResult

logger = logging.getLogger("tool-service")

DEMO_TRAINS: List[TrainItem] = [
  TrainItem(
    train_number="12303",
    name="Poorva Express",
    departure="08:00 (HWH)",
    arrival="06:00 (+1)",
    duration="22h 00m",
    departure_time_type="morning",
    classes=["1A", "2A", "3A", "SL"],
    price="₹2,450",
  ),
  TrainItem(
    train_number="12301",
    name="Howrah - New Delhi Rajdhani Express",
    departure="16:55 (HWH)",
    arrival="10:05 (+1)",
    duration="17h 10m",
    departure_time_type="evening",
    classes=["1A", "2A", "3A"],
    price="₹3,890",
  ),
  TrainItem(
    train_number="12273",
    name="Howrah - New Delhi Duronto Express",
    departure="17:45 (HWH)",
    arrival="10:50 (+1)",
    duration="17h 05m",
    departure_time_type="evening",
    classes=["1A", "2A", "3A", "3E"],
    price="₹3,420",
  ),
  TrainItem(
    train_number="12313",
    name="Sealdah - New Delhi Rajdhani Express",
    departure="18:50 (SDAH)",
    arrival="10:50 (+1)",
    duration="16h 00m",
    departure_time_type="evening",
    classes=["1A", "2A", "3A"],
    price="₹3,950",
  ),
  TrainItem(
    train_number="12329",
    name="West Bengal Sampark Kranti Express",
    departure="23:00 (SDAH)",
    arrival="22:30 (+1)",
    duration="23h 30m",
    departure_time_type="night",
    classes=["1A", "2A", "3A", "SL"],
    price="₹2,100",
  ),
]


class ToolService:
  """
  Service managing simulated travel search tool executions with intentional latency
  and cancellation support.
  """

  @staticmethod
  async def search_trains(
    origin: str,
    destination: str,
    date: str,
    time_constraint: Optional[str] = "any",
    generation_id: str = "gen_1",
    delay_seconds: Optional[float] = None,
  ) -> SearchTrainsResult:
    """
    Simulates a long-running travel search tool with an intentional 5-second delay.
    Supports asynchronous cancellation when user barge-in occurs.
    """
    request_id = f"req_{uuid.uuid4().hex[:8]}"
    effective_delay = (
      delay_seconds
      if delay_seconds is not None
      else settings.TOOL_ARTIFICIAL_DELAY_SECONDS
    )
    start_time = time.time()

    logger.info(
      f"[{request_id}] Starting search_trains ({origin} -> {destination} on {date}, "
      f"time={time_constraint}, gen={generation_id}, delay={effective_delay}s)"
    )

    try:
      # Intentional stress-test delay for voice interruption testing
      await asyncio.sleep(effective_delay)

      # Filter trains based on time_constraint
      normalized_time = (time_constraint or "any").lower().strip()
      if normalized_time in ["morning", "afternoon", "evening", "night"]:
        matched_trains = [
          t for t in DEMO_TRAINS if t.departure_time_type == normalized_time
        ]
      else:
        matched_trains = list(DEMO_TRAINS)

      elapsed_ms = int((time.time() - start_time) * 1000)
      logger.info(
        f"[{request_id}] search_trains completed successfully in {elapsed_ms}ms "
        f"(found {len(matched_trains)} trains)"
      )

      return SearchTrainsResult(
        request_id=request_id,
        generation_id=generation_id,
        origin=origin,
        destination=destination,
        date=date,
        time_constraint=time_constraint,
        trains=matched_trains,
        is_cancelled=False,
        is_stale=False,
        execution_time_ms=elapsed_ms,
      )

    except asyncio.CancelledError:
      elapsed_ms = int((time.time() - start_time) * 1000)
      logger.warning(
        f"[{request_id}] search_trains was CANCELLED after {elapsed_ms}ms! "
        f"(generation {generation_id})"
      )
      # Re-raise CancelledError to propagate cancellation cleanly to task wrappers,
      # or return cancelled result
      raise
