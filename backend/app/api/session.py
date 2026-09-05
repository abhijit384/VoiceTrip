import time
import json
import logging
from typing import Dict, List, Optional, Any
from fastapi import APIRouter
from pydantic import BaseModel
from app.services.gemini_service import GeminiService, ToolCall
from app.models.travel import CanonicalTravelContext, TravelIntent
from app.services.railway_normalizer import railway_normalizer

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
            tool_calls=[],
            canonical_context=prior_context,
            latency_ms=0,
            model="validation_gate_blocked",
        )

    # Phonetic normalization for known station aliases (if relevant)
    norm_result = railway_normalizer.normalize(raw_msg, prior_intent=None)
    normalized_msg = norm_result.normalized_text

    # Append user message to conversation history
    sessions[session_id].append({"role": "user", "content": normalized_msg})

    # Call LLM service with canonical multi-turn memory
    llm_res = await llm_service.chat_completion(
        messages=sessions[session_id],
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
    # If the intent is greeting or conversational (non-travel), clear travel context so stale state doesn't persist
    if updated_context:
        if updated_context.intent in ["greeting", "conversational"]:
            session_contexts[session_id] = None
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
            tool_calls=[],
            canonical_context=updated_context,
            intent=llm_res.intent,
            latency_ms=llm_res.latency_ms,
            model=llm_res.model,
        )


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

    tool_summary = json.dumps(payload.tool_results) if isinstance(payload.tool_results, (dict, list)) else str(payload.tool_results)
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
        f"[DEVELOPER AUDIT] TOOL RESULT PAYLOAD:       {payload.tool_results}\n"
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


@router.post("/reset")
async def reset_session(session_id: str = "default"):
    """Resets conversation history and canonical context for a session."""
    if session_id in sessions:
        sessions[session_id] = []
    if session_id in session_contexts:
        del session_contexts[session_id]
    return {"status": "reset", "session_id": session_id}
