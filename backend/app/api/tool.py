import asyncio
import logging
from fastapi import APIRouter, HTTPException
from app.models.travel import SearchTrainsRequest, SearchTrainsResult
from app.services.tool_service import ToolService
from app.services.interruption_manager import interruption_manager

logger = logging.getLogger("tool-api")
router = APIRouter(prefix="/tools", tags=["Travel Tools"])


@router.post("/search_trains")
async def execute_search_trains(payload: SearchTrainsRequest):
    """
    Executes simulated travel search tool with an intentional 5-second delay.
    Guarded by the InterruptionManager: supports cancellation and rejects stale results.
    """
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    # Spawn search task
    coro = ToolService.search_trains(
        origin=payload.origin,
        destination=payload.destination,
        date=payload.date,
        time_constraint=payload.time_constraint,
        generation_id=generation_id,
    )
    task = asyncio.create_task(coro)
    interruption_manager.set_active_task(session_id, generation_id, task)

    try:
        raw_result = await task

        # Pass through stale-result protection barrier
        safe_result = interruption_manager.process_tool_result(session_id, raw_result)

        if safe_result is None:
            # Result was stale (e.g. user barged in during search)
            return {
                "status": "stale_result_dropped",
                "message": "Tool execution completed but was dropped because a newer user instruction arrived.",
                "generation_id": generation_id,
                "is_stale": True,
            }

        return safe_result

    except asyncio.CancelledError:
        logger.info(f"Tool execution for session {session_id} was successfully aborted.")
        return {
            "status": "cancelled",
            "message": "Tool execution was cancelled by user interruption.",
            "generation_id": generation_id,
            "is_cancelled": True,
            "is_stale": True,
        }
    except Exception as e:
        logger.error(f"Error executing search_trains: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interrupt")
async def interrupt_active_tool(session_id: str = "default", new_generation_id: str = "gen_2"):
    """
    Barge-In Interruption Endpoint:
    Immediately cancels any running tool task for the session,
    invalidates the old generation ID, and increments to new_generation_id.
    """
    interruption_manager.register_new_generation(session_id, new_generation_id)
    return {
        "status": "interrupted",
        "session_id": session_id,
        "new_generation_id": new_generation_id,
        "stale_drops_total": interruption_manager.get_stale_drop_count(session_id),
    }


@router.get("/status")
async def get_tool_status(session_id: str = "default"):
    """Returns current active generation and telemetry for a session."""
    active_task = interruption_manager.active_tasks.get(session_id)
    is_running = active_task is not None and not active_task.done()

    return {
        "session_id": session_id,
        "current_generation": interruption_manager.get_current_generation(session_id),
        "is_tool_running": is_running,
        "stale_results_dropped": interruption_manager.get_stale_drop_count(session_id),
    }
