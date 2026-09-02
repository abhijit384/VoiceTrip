import asyncio
import logging
from typing import Dict, Optional, Any
from app.models.travel import SearchTrainsResult

logger = logging.getLogger("interruption-manager")


class InterruptionManager:
    """
    Central manager for tracking generation epochs, active async tasks,
    tool cancellations, and stale result protection barriers.
    """

    def __init__(self):
        # Maps session_id -> active tool asyncio.Task
        self.active_tasks: Dict[str, asyncio.Task] = {}
        # Maps session_id -> current active generation ID (e.g. "gen_1")
        self.current_generation: Dict[str, str] = {}
        # Maps session_id -> number of stale results prevented from leaking into conversation
        self.stale_drop_counts: Dict[str, int] = {}

    def get_current_generation(self, session_id: str = "default") -> str:
        return self.current_generation.get(session_id, "gen_1")

    def register_new_generation(self, session_id: str, new_generation_id: str):
        """Advances the session generation epoch and immediately cancels obsolete running tasks."""
        old_gen = self.current_generation.get(session_id, "none")
        logger.info(f"Advancing generation for session '{session_id}': {old_gen} -> {new_generation_id}")

        # Cancel any active running tool task
        if session_id in self.active_tasks:
            active_task = self.active_tasks[session_id]
            if not active_task.done():
                logger.info(f"Cancelling active tool task for session '{session_id}' (epoch {old_gen})")
                active_task.cancel()
            del self.active_tasks[session_id]

        self.current_generation[session_id] = new_generation_id

    def set_active_task(self, session_id: str, generation_id: str, task: asyncio.Task):
        """Registers a newly spawned tool task under the given generation epoch."""
        # Ensure any previous task is cancelled
        if session_id in self.active_tasks:
            prev_task = self.active_tasks[session_id]
            if not prev_task.done():
                prev_task.cancel()

        self.active_tasks[session_id] = task
        self.current_generation[session_id] = generation_id

    def is_result_stale(self, session_id: str, result_generation_id: str) -> bool:
        """
        Determines whether a tool result belongs to an obsolete generation epoch.
        Returns True if the result is stale and must be barred from updating conversation state.
        """
        active_gen = self.get_current_generation(session_id)
        if result_generation_id != active_gen:
            logger.warning(
                f"[STALE RESULT DETECTED] session={session_id}: result has generation "
                f"'{result_generation_id}' but active generation is '{active_gen}'"
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
        Never allows stale results to update the active conversation state.
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

        # Clean up active task reference once completed cleanly
        if session_id in self.active_tasks and self.active_tasks[session_id].done():
            del self.active_tasks[session_id]

        return result

    def get_stale_drop_count(self, session_id: str = "default") -> int:
        return self.stale_drop_counts.get(session_id, 0)


# Global singleton instance
interruption_manager = InterruptionManager()
