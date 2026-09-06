import time
import json
import logging
from typing import Dict, List, Optional, Any
from fastapi import APIRouter
from pydantic import BaseModel
from app.services.gemini_service import GeminiService, ToolCall
from app.models.travel import CanonicalTravelContext, TravelIntent
from app.services.railway_normalizer import railway_normalizer
from app.services.transcript_corrector import transcript_corrector, CorrectionItem
from app.services.interruption_manager import interruption_manager

logger = logging.getLogger("session-chat")
router = APIRouter(prefix="/chat", tags=["Chat & LLM"])

# In-memory session store: session_id -> list of message dicts
sessions: Dict[str, List[Dict[str, str]]] = {}
# Canonical Conversation State: session_id -> CanonicalTravelContext (Single Source of Truth)
session_contexts: Dict[str, Optional[CanonicalTravelContext]] = {}

llm_service = GeminiService()

ALLOWED_TRAVEL_INTENTS = {
    "hotel_search",
    "flight_search",
    "train_search",
    "route_search",
    "bus_search",
    "destination_info",
}


class ChatRequest(BaseModel):
    session_id: Optional[str] = "default"
    message: str
    generation_id: Optional[str] = "gen_1"


class ToolResultRequest(BaseModel):
    session_id: Optional[str] = "default"
    tool_name: str
    tool_results: Any
    generation_id: Optional[str] = "gen_1"


class ChatResponse(BaseModel):
    session_id: str
    generation_id: str
    response_type: str  # "text" or "tool_call"
    text: Optional[str] = None
    raw_transcript: Optional[str] = None
    corrected_transcript: Optional[str] = None
    was_corrected: bool = False
    corrections: List[CorrectionItem] = []
    tool_calls: List[ToolCall] = []
    canonical_context: Optional[CanonicalTravelContext] = None
    intent: Optional[TravelIntent] = None
    latency_ms: int = 0
    model: str = ""


@router.post("", response_model=ChatResponse)
async def process_user_transcript(payload: ChatRequest):
    """
    Receives user transcript, resolves multi-turn CanonicalTravelContext (preserving prior state across
    follow-ups and audio interruptions), validates parameters, and executes structured tools with Gemini 3.6 Flash.
    """
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    # Register new generation to immediately invalidate/abort previous async tool tasks
    interruption_manager.register_new_generation(session_id, generation_id)

    if session_id not in sessions:
        sessions[session_id] = []
    prior_context = session_contexts.get(session_id)

    raw_msg = (payload.message or "").strip()
    alphanumeric_chars = [c for c in raw_msg if c.isalnum()]
    if len(raw_msg) == 0 or len(alphanumeric_chars) < 2:
        logger.info(f"[VALIDATION GATE] Discarded noise/non-speech input: '{raw_msg}'")
        return ChatResponse(
            session_id=session_id,
            generation_id=generation_id,
            response_type="text",
            text=None,
            raw_transcript=raw_msg,
            corrected_transcript=raw_msg,
            was_corrected=False,
            corrections=[],
            tool_calls=[],
            canonical_context=prior_context,
            latency_ms=0,
            model="validation_gate_blocked",
        )

    # Step 1: Safe Deterministic Transcript Correction & Normalization Layer
    correction_res = transcript_corrector.correct_transcript(raw_msg)
    corrected_msg = correction_res.corrected_transcript

    # Step 2: Railway domain alias casing & station resolver
    norm_result = railway_normalizer.normalize(corrected_msg, prior_intent=None)
    normalized_msg = norm_result.normalized_text

    # Append canonical user message to conversation history
    sessions[session_id].append({"role": "user", "content": normalized_msg})

    # Limit conversation history to prevent prompt bloat (last 8 messages = ~4 turns)
    recent_history = sessions[session_id][-8:] if len(sessions[session_id]) > 8 else sessions[session_id]

    # Truncate large tool result messages in history to prevent huge prompts
    trimmed_history = []
    for msg in recent_history:
        if msg.get("role") == "tool" and msg.get("content"):
            content_str = str(msg["content"])
            if len(content_str) > 600:
                trimmed_history.append({**msg, "content": content_str[:600] + "... (truncated)"})
            else:
                trimmed_history.append(msg)
        else:
            trimmed_history.append(msg)

    # Call LLM service with canonical multi-turn memory
    llm_res = await llm_service.chat_completion(
        messages=trimmed_history,
        prior_context=prior_context,
    )

    updated_context = llm_res.canonical_context

    # Server-Side Travel Tool Security Guard:
    # Only allow travel tool execution if intent is a confirmed travel search intent
    if llm_res.tool_calls:
        if not updated_context or updated_context.intent not in ALLOWED_TRAVEL_INTENTS:
            logger.warning(
                f"[SECURITY GUARD] Blocked travel tool call '{llm_res.tool_calls[0].name}' "
                f"for non-travel intent '{updated_context.intent if updated_context else 'None'}'"
            )
            llm_res.tool_calls = []
            if not llm_res.content:
                llm_res.content = "Hello! I'm VoiceTrip. How can I help with your travel plans today?"

    # Context Lifecycle Management:
    # Preserve active travel context across follow-ups, pending questions, and clarifications.
    # Clear old context only when user explicitly switches to general non-travel conversation or standalone greeting.
    if updated_context:
        if updated_context.intent == "greeting":
            session_contexts[session_id] = None
        elif updated_context.intent == "conversational":
            # If purely conversational without pending travel parameters, clear travel context
            if not updated_context.origin and not updated_context.destination:
                session_contexts[session_id] = None
            else:
                session_contexts[session_id] = updated_context
        elif updated_context.intent == "unclear" and not updated_context.needs_clarification:
            session_contexts[session_id] = None
        elif updated_context.request_type == "NEW" and prior_context:
            if updated_context.intent != prior_context.intent:
                logger.info(
                    f"[CONTEXT] Domain switch: {prior_context.intent} -> {updated_context.intent}."
                )
            session_contexts[session_id] = updated_context
        else:
            session_contexts[session_id] = updated_context

    tool_name = llm_res.tool_calls[0].name if llm_res.tool_calls else "None"
    tool_args = llm_res.tool_calls[0].arguments if llm_res.tool_calls else {}

    # Comprehensive Developer Mode Telemetry & Audit Logging
    logger.info(
        f"\n{'='*70}\n"
        f"TURN ID:                      {len(sessions[session_id]) // 2 + 1}\n"
        f"GENERATION ID:                {generation_id}\n"
        f"RAW USER TRANSCRIPT:          {raw_msg}\n"
        f"CORRECTED TRANSCRIPT:         {normalized_msg} (changed={correction_res.was_corrected})\n"
        f"INTENT CLASSIFIED:            {updated_context.intent if updated_context else 'None'}\n"
        f"CURRENT CONVERSATION CONTEXT: {len(sessions[session_id])} turns in session '{session_id}'\n"
        f"CURRENT TRAVEL CONTEXT:       {json.dumps(updated_context.model_dump()) if updated_context else 'None'}\n"
        f"TOOL NAME:                    {tool_name}\n"
        f"TOOL ARGUMENTS:               {json.dumps(tool_args)}\n"
        f"FINAL AI RESPONSE:            {llm_res.content or '(Routing to Tool Call)'}\n"
        f"DISPLAY RESULT:               {updated_context.to_readable_summary() if updated_context else 'None'}\n"
        f"{'='*70}"
    )

    if llm_res.tool_calls:
        first_call = llm_res.tool_calls[0]
        call_id = first_call.id or "call_1"
        sessions[session_id].append({
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": first_call.name,
                        "arguments": json.dumps(first_call.arguments) if isinstance(first_call.arguments, dict) else str(first_call.arguments),
                    },
                }
            ],
        })

        return ChatResponse(
            session_id=session_id,
            generation_id=generation_id,
            response_type="tool_call",
            text=None,
            raw_transcript=raw_msg,
            corrected_transcript=normalized_msg,
            was_corrected=correction_res.was_corrected,
            corrections=correction_res.corrections,
            tool_calls=llm_res.tool_calls,
            canonical_context=updated_context,
            intent=llm_res.intent,
            latency_ms=llm_res.latency_ms,
            model=llm_res.model,
        )
    else:
        content = llm_res.content or "Hello! I'm VoiceTrip. How can I help with your travel plans today?"
        sessions[session_id].append({"role": "assistant", "content": content})
        return ChatResponse(
            session_id=session_id,
            generation_id=generation_id,
            response_type="text",
            text=content,
            raw_transcript=raw_msg,
            corrected_transcript=normalized_msg,
            was_corrected=correction_res.was_corrected,
            corrections=correction_res.corrections,
            tool_calls=[],
            canonical_context=updated_context,
            intent=llm_res.intent,
            latency_ms=llm_res.latency_ms,
            model=llm_res.model,
        )


def _compact_tool_results_for_voice(tool_name: str, results: Any) -> Any:
    """Compacts tool result payload down to essential voice-summary fields to maximize LLM speed."""
    if not isinstance(results, dict):
        return results

    if tool_name == "search_trains" and "trains" in results:
        trains = results.get("trains", [])
        return {
            "type": "train_search",
            "total_found": len(trains),
            "origin": results.get("origin"),
            "destination": results.get("destination"),
            "trains": [
                {
                    "name": t.get("name"),
                    "departure": t.get("departure"),
                    "arrival": t.get("arrival"),
                    "price": t.get("price") or t.get("fare"),
                }
                for t in trains if isinstance(t, dict)
            ],
        }

    if tool_name == "search_flights" and "flights" in results:
        flights = results.get("flights", [])
        return {
            "type": "flight_search",
            "total_found": len(flights),
            "origin": results.get("origin"),
            "destination": results.get("destination"),
            "flights": [
                {
                    "flight_number": f.get("flight_number"),
                    "airline": f.get("airline"),
                    "departure": f.get("departure"),
                    "arrival": f.get("arrival"),
                    "price": f.get("price"),
                }
                for f in flights if isinstance(f, dict)
            ],
        }

    if tool_name == "search_hotels" and "hotels" in results:
        hotels = results.get("hotels", [])
        return {
            "type": "hotel_search",
            "total_found": len(hotels),
            "destination": results.get("destination"),
            "hotels": [
                {
                    "name": h.get("name"),
                    "price_formatted": h.get("price_formatted") or (f"₹{h.get('price')}" if h.get("price") else None),
                    "rating": h.get("rating"),
                    "location": h.get("location"),
                }
                for h in hotels if isinstance(h, dict)
            ],
        }

    if tool_name in ["get_route_options", "search_buses"] and ("routes" in results or "buses" in results):
        routes = results.get("routes", []) or results.get("buses", [])
        return {
            "type": "route_search",
            "total_found": len(routes),
            "origin": results.get("origin"),
            "destination": results.get("destination"),
            "routes": [
                {
                    "mode": r.get("mode") or r.get("operator") or "transit",
                    "departure": r.get("departure"),
                    "duration": r.get("duration"),
                    "price": r.get("price"),
                }
                for r in routes if isinstance(r, dict)
            ],
        }

    return results


@router.post("/tool_result", response_model=ChatResponse)
async def process_tool_result(payload: ToolResultRequest):
    """
    Feeds completed tool results back to Gemini LLM to synthesize a concise spoken voice response for Rime TTS.
    """
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    if session_id not in sessions:
        sessions[session_id] = []

    # Find the matching tool_call_id from last assistant turn if available
    tool_call_id = "call_1"
    for msg in reversed(sessions[session_id]):
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            calls = msg.get("tool_calls")
            if calls and len(calls) > 0:
                tool_call_id = calls[0].get("id", "call_1")
                break

    # Compact payload for maximum LLM speed
    compact_results = _compact_tool_results_for_voice(payload.tool_name, payload.tool_results)
    tool_summary = json.dumps(compact_results)

    sessions[session_id].append({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": tool_summary,
    })

    current_context = session_contexts.get(session_id)

    # Ask LLM for concise voice summary of the tool output
    llm_res = await llm_service.chat_completion(
        messages=sessions[session_id],
        tools=[],
        prior_context=current_context,
    )
    content = llm_res.content or "Here are the travel options found for your journey."
    sessions[session_id].append({"role": "assistant", "content": content})

    logger.info(
        f"\n{'='*70}\n"
        f"[DEVELOPER AUDIT] TOOL RESULT RETURNED:      '{payload.tool_name}'\n"
        f"[DEVELOPER AUDIT] FINAL RESPONSE (RIME TTS): '{content}'\n"
        f"{'='*70}"
    )

    return ChatResponse(
        session_id=session_id,
        generation_id=generation_id,
        response_type="text",
        text=content,
        tool_calls=[],
        canonical_context=current_context,
        intent=llm_res.intent,
        latency_ms=llm_res.latency_ms,
        model=llm_res.model,
    )


class ResetRequest(BaseModel):
    session_id: Optional[str] = "default"


@router.post("/reset")
async def reset_session(payload: Optional[ResetRequest] = None, session_id: str = "default"):
    """Resets conversation history and canonical context for a session."""
    sid = (payload.session_id if payload and payload.session_id else session_id) or "default"
    if sid in sessions:
        sessions[sid] = []
    if sid in session_contexts:
        del session_contexts[sid]
    logger.info(f"[RESET] Session '{sid}' conversation and context cleared.")
    return {"status": "reset", "session_id": sid}
