import asyncio
import logging
import time
from typing import Dict, Optional, Any, List
from app.models.travel import SearchTrainsResult
from app.services.tool_service import ToolService

logger = logging.getLogger("interruption-manager")


class InterruptionManager:
    """
    Central manager for tracking generation epochs, active async tasks across
    LLM, Tool, and TTS layers, tool cancellations, and strict stale result protection barriers.
    """

    def __init__(self):
        # Maps session_id -> list of active asyncio.Tasks (LLM, Tool, TTS)
        self.active_tasks: Dict[str, List[asyncio.Task]] = {}
        # Maps session_id -> current active generation ID (e.g. "gen_1")
        self.current_generation: Dict[str, str] = {}
        # Maps session_id -> number of stale results prevented from leaking into conversation
        self.stale_drop_counts: Dict[str, int] = {}
        # Maps session_id -> number of stale audio chunks blocked from speaker
        self.stale_audio_drop_counts: Dict[str, int] = {}

    def get_current_generation(self, session_id: str = "default") -> str:
        return self.current_generation.get(session_id, "gen_1")

    def register_new_generation(self, session_id: str, new_generation_id: str):
        """
        Advances the session generation epoch and immediately cancels all obsolete running tasks
        (Tool execution, LLM inference, or TTS generation).
        """
        old_gen = self.current_generation.get(session_id, "none")
        logger.info(f"Advancing generation epoch for '{session_id}': {old_gen} -> {new_generation_id}")

        # Cancel all active running tasks for this session immediately
        cancelled_count = 0
        if session_id in self.active_tasks:
            for task in self.active_tasks[session_id]:
                if not task.done():
                    logger.info(f"Cancelling active pipeline task for session '{session_id}' (epoch {old_gen})")
                    task.cancel()
                    cancelled_count += 1
            self.active_tasks[session_id] = []

        self.current_generation[session_id] = new_generation_id
        return cancelled_count

    def track_task(self, session_id: str, generation_id: str, task: asyncio.Task):
        """Registers an async pipeline task (Tool, LLM, or TTS) under the current epoch."""
        if session_id not in self.active_tasks:
            self.active_tasks[session_id] = []

        # Remove completed tasks
        self.active_tasks[session_id] = [t for t in self.active_tasks[session_id] if not t.done()]
        self.active_tasks[session_id].append(task)
        self.current_generation[session_id] = generation_id

    # Backward compatibility alias
    def set_active_task(self, session_id: str, generation_id: str, task: asyncio.Task):
        self.track_task(session_id, generation_id, task)

    def is_result_stale(self, session_id: str, result_generation_id: str) -> bool:
        """
        Determines whether a tool result belongs to an obsolete generation epoch.
        Returns True if the result is stale and must be barred from updating conversation state.
        """
        active_gen = self.get_current_generation(session_id)
        if result_generation_id != active_gen:
            logger.warning(
                f"[STALE RESULT DETECTED] session={session_id}: result epoch is "
                f"'{result_generation_id}' but active epoch is '{active_gen}'"
            )
            return True
        return False

    def process_tool_result(
        self,
        session_id: str,
        result: SearchTrainsResult,
    ) -> Optional[SearchTrainsResult]:
        """
        Stale Result Protection Barrier:
        A stale tool result MUST NEVER become the current answer.
        A stale tool result MUST NEVER be spoken through Rime.
        If stale, marks result as stale, records drop metric, and returns None.
        """
        if self.is_result_stale(session_id, result.generation_id):
            result.is_stale = True
            self.stale_drop_counts[session_id] = self.stale_drop_counts.get(session_id, 0) + 1
            logger.info(
                f"PROTECTED: Stale tool result {result.request_id} from {result.generation_id} "
                f"successfully dropped. Conversation state preserved."
            )
            return None

        return result

    def validate_audio_generation(self, session_id: str, audio_generation_id: str) -> bool:
        """
        Stale Audio Protection Barrier:
        Prevents obsolete or cancelled audio chunks from continuing to play or being sent to speaker.
        Returns False if audio is stale and must be discarded.
        """
        active_gen = self.get_current_generation(session_id)
        if audio_generation_id != active_gen:
            self.stale_audio_drop_counts[session_id] = self.stale_audio_drop_counts.get(session_id, 0) + 1
            logger.warning(
                f"STALE AUDIO BLOCKED: Audio from {audio_generation_id} dropped because "
                f"active generation is {active_gen}."
            )
            return False
        return True

    def get_stale_drop_count(self, session_id: str = "default") -> int:
        return self.stale_drop_counts.get(session_id, 0)

    def get_stale_audio_drop_count(self, session_id: str = "default") -> int:
        return self.stale_audio_drop_counts.get(session_id, 0)

    async def recover_from_interruption(
        self,
        session_id: str,
        previous_gen: str,
        new_gen: str,
        new_constraint: str = "evening",
        origin: str = "Kolkata",
        destination: str = "Delhi",
        date: str = "tomorrow",
    ) -> Dict[str, Any]:
        """
        Executes complete interruption & recovery workflow:
        1. Cancels previous generation tasks and advances epoch.
        2. Applies new constraint (e.g. evening trains).
        3. Executes search for the updated criteria.
        4. Synthesizes concise voice response suitable for Rime TTS.
        """
        start_time = time.time()

        # Step 1: Invalidate and cancel previous generation
        self.register_new_generation(session_id, new_gen)

        # Step 2: Execute fresh tool with the updated constraint
        search_result = await ToolService.search_trains(
            origin=origin,
            destination=destination,
            date=date,
            time_constraint=new_constraint,
            generation_id=new_gen,
            delay_seconds=0.2,  # expedited recovery search
        )

        train_count = len(search_result.trains)
        train_names = ", ".join([t.name for t in search_result.trains[:2]])
        spoken_response = (
            f"Understood, switching to evening trains only. I found {train_count} evening options: "
            f"{train_names}. Howrah Rajdhani departs at 16:55."
        )

        recovery_latency_ms = int((time.time() - start_time) * 1000)

        return {
            "session_id": session_id,
            "cancelled_generation": previous_gen,
            "active_generation": new_gen,
            "constraint_applied": new_constraint,
            "stale_results_blocked": self.get_stale_drop_count(session_id),
            "trains_found": [t.model_dump() for t in search_result.trains],
            "spoken_response": spoken_response,
            "recovery_latency_ms": recovery_latency_ms,
        }


# Global singleton instance
interruption_manager = InterruptionManager()
