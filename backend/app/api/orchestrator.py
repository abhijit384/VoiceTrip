import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any
from app.services.interruption_manager import interruption_manager

logger = logging.getLogger("orchestrator-api")
router = APIRouter(prefix="/orchestrator", tags=["Interruption Orchestrator"])


class InterruptionRecoveryRequest(BaseModel):
    session_id: Optional[str] = "default"
    previous_generation_id: str = "gen_1"
    new_generation_id: str = "gen_2"
    interruption_utterance: str = "Actually, only evening trains."
    new_constraint: Optional[str] = "evening"
    origin: Optional[str] = "Kolkata"
    destination: Optional[str] = "Delhi"
    date: Optional[str] = "tomorrow"


@router.post("/interrupt_and_recover")
async def interrupt_and_recover(payload: InterruptionRecoveryRequest):
    """
    Core Interruption & Recovery API:
    1. Immediately terminates and aborts running operations from previous_generation_id.
    2. Advances the session epoch to new_generation_id.
    3. Prevents any pending results or audio from previous_generation_id from reaching the speaker.
    4. Applies new user constraint (e.g. evening trains).
    5. Dispatches new search and generates updated voice response for Rime TTS.
    """
    logger.info(
        f"Processing interruption for session {payload.session_id}: "
        f"aborting {payload.previous_generation_id} -> starting {payload.new_generation_id} "
        f"('{payload.interruption_utterance}')"
    )

    result = await interruption_manager.recover_from_interruption(
        session_id=payload.session_id or "default",
        previous_gen=payload.previous_generation_id,
        new_gen=payload.new_generation_id,
        new_constraint=payload.new_constraint or "evening",
        origin=payload.origin or "Kolkata",
        destination=payload.destination or "Delhi",
        date=payload.date or "tomorrow",
    )

    return result


@router.get("/telemetry")
async def get_orchestrator_telemetry(session_id: str = "default"):
    """Returns real-time telemetry on interruption counts and stale protection drops."""
    return {
        "session_id": session_id,
        "current_generation": interruption_manager.get_current_generation(session_id),
        "stale_tool_results_blocked": interruption_manager.get_stale_drop_count(session_id),
        "stale_audio_chunks_blocked": interruption_manager.get_stale_audio_drop_count(session_id),
    }
