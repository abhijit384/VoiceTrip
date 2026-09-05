import asyncio
import logging
from fastapi import APIRouter, HTTPException
from app.models.travel import (
    SearchTrainsRequest,
    SearchTrainsResult,
    SearchFlightsRequest,
    SearchFlightsResult,
    SearchHotelsRequest,
    SearchHotelsResult,
    RouteOptionsRequest,
    RouteOptionsResult,
    DestinationInfoRequest,
    DestinationInfoResult,
)
from app.services.tool_service import ToolService
from app.services.interruption_manager import interruption_manager

logger = logging.getLogger("tool-api")
router = APIRouter(prefix="/tools", tags=["Travel Tools"])


async def _execute_guarded_tool(session_id: str, generation_id: str, coro):
    task = asyncio.create_task(coro)
    interruption_manager.set_active_task(session_id, generation_id, task)

    try:
        raw_result = await task
        safe_result = interruption_manager.process_tool_result(session_id, raw_result)

        if safe_result is None:
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


@router.post("/search_trains")
async def execute_search_trains(payload: SearchTrainsRequest):
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    coro = ToolService.search_trains(
        origin=payload.origin,
        destination=payload.destination,
        date=payload.date or "tomorrow",
        time_constraint=payload.time_constraint or "any",
        passengers=payload.passengers or 1,
        generation_id=generation_id,
    )
    return await _execute_guarded_tool(session_id, generation_id, coro)


@router.post("/search_flights")
async def execute_search_flights(payload: SearchFlightsRequest):
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    coro = ToolService.search_flights(
        origin=payload.origin,
        destination=payload.destination,
        date=payload.date or "tomorrow",
        time_constraint=payload.time_constraint or "any",
        passengers=payload.passengers or 1,
        generation_id=generation_id,
    )
    return await _execute_guarded_tool(session_id, generation_id, coro)


@router.post("/search_hotels")
async def execute_search_hotels(payload: SearchHotelsRequest):
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    coro = ToolService.search_hotels(
        destination=payload.destination,
        check_in_date=payload.check_in_date or "tomorrow",
        nights=payload.nights or 2,
        budget=payload.budget,
        guests=payload.guests or 1,
        sort_by=payload.sort_by,
        location_preference=payload.location_preference,
        generation_id=generation_id,
    )
    return await _execute_guarded_tool(session_id, generation_id, coro)


@router.post("/get_route_options")
async def execute_get_route_options(payload: RouteOptionsRequest):
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    coro = ToolService.get_route_options(
        origin=payload.origin,
        destination=payload.destination,
        generation_id=generation_id,
    )
    return await _execute_guarded_tool(session_id, generation_id, coro)


@router.post("/get_destination_info")
async def execute_get_destination_info(payload: DestinationInfoRequest):
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    coro = ToolService.get_destination_info(
        destination=payload.destination,
        category=payload.category or "all",
        generation_id=generation_id,
    )
    return await _execute_guarded_tool(session_id, generation_id, coro)


@router.post("/interrupt")
async def interrupt_active_tool(session_id: str = "default", new_generation_id: str = "gen_2"):
    interruption_manager.register_new_generation(session_id, new_generation_id)
    return {
        "status": "interrupted",
        "session_id": session_id,
        "new_generation_id": new_generation_id,
        "stale_drops_total": interruption_manager.get_stale_drop_count(session_id),
    }


@router.get("/status")
async def get_tool_status(session_id: str = "default"):
    active_task = interruption_manager.active_tasks.get(session_id)
    is_running = active_task is not None and not active_task.done()

    return {
        "session_id": session_id,
        "current_generation": interruption_manager.get_current_generation(session_id),
        "is_tool_running": is_running,
        "stale_results_dropped": interruption_manager.get_stale_drop_count(session_id),
    }
