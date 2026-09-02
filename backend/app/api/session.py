import time
import logging
from typing import Dict, List, Optional, Any
from fastapi import APIRouter
from pydantic import BaseModel
from app.services.llm_service import GroqLLMService, ToolCall

logger = logging.getLogger("session-chat")
router = APIRouter(prefix="/chat", tags=["Chat & LLM"])

# In-memory session store: session_id -> list of message dicts
sessions: Dict[str, List[Dict[str, str]]] = {}
llm_service = GroqLLMService()


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
    response_type: str # "text" or "tool_call"
    text: Optional[str] = None
    tool_calls: List[ToolCall] = []
    latency_ms: int = 0
    model: str = ""


@router.post("", response_model=ChatResponse)
async def process_user_transcript(payload: ChatRequest):
    """
    Receives final user transcript, appends to conversation history,
    and queries Groq LLM with voice-specific system instructions and tool calling.
    """
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    if session_id not in sessions:
        sessions[session_id] = []

    # Append user turn
    sessions[session_id].append({"role": "user", "content": payload.message})

    # Call LLM service
    llm_res = await llm_service.chat_completion(sessions[session_id])

    if llm_res.tool_calls:
        # LLM requested a function call
        return ChatResponse(
            session_id=session_id,
            generation_id=generation_id,
            response_type="tool_call",
            text=None,
            tool_calls=llm_res.tool_calls,
            latency_ms=llm_res.latency_ms,
            model=llm_res.model,
        )
    else:
        # LLM provided a direct spoken text response
        content = llm_res.content or "I am ready to help you plan your journey."
        sessions[session_id].append({"role": "assistant", "content": content})
        return ChatResponse(
            session_id=session_id,
            generation_id=generation_id,
            response_type="text",
            text=content,
            tool_calls=[],
            latency_ms=llm_res.latency_ms,
            model=llm_res.model,
        )


@router.post("/tool_result", response_model=ChatResponse)
async def process_tool_result(payload: ToolResultRequest):
    """
    Feeds completed tool results back to Groq LLM to synthesize a concise spoken voice response.
    """
    session_id = payload.session_id or "default"
    generation_id = payload.generation_id or "gen_1"

    if session_id not in sessions:
        sessions[session_id] = []

    # Append tool output to context
    tool_summary = f"Tool {payload.tool_name} returned results: {payload.tool_results}"
    sessions[session_id].append({
        "role": "function",
        "name": payload.tool_name,
        "content": tool_summary,
    })

    # Ask LLM for concise voice summary of the tool output
    llm_res = await llm_service.chat_completion(sessions[session_id], tools=[])
    content = llm_res.content or "Here are the train options for your journey."
    sessions[session_id].append({"role": "assistant", "content": content})

    return ChatResponse(
        session_id=session_id,
        generation_id=generation_id,
        response_type="text",
        text=content,
        tool_calls=[],
        latency_ms=llm_res.latency_ms,
        model=llm_res.model,
    )


@router.post("/reset")
async def reset_session(session_id: str = "default"):
    """Resets conversation history for a session."""
    if session_id in sessions:
        sessions[session_id] = []
    return {"status": "reset", "session_id": session_id}
