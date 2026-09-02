import time
import json
import logging
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.core.config import settings

logger = logging.getLogger("llm-service")

SYSTEM_VOICE_PROMPT = """You are VoiceTrip, a helpful, realtime voice travel assistant.
You are speaking directly to the user over a voice call.
CRITICAL VOICE GUIDELINES:
1. Speak concisely in 1 to 2 conversational sentences maximum.
2. Never format your response with markdown, bullet points, asterisks, or markdown tables.
3. Be friendly, direct, and warm.
4. If the user wants to find, check, or book trains or travel, call the search_trains function.
5. If the user mentions a departure time preference (e.g. evening, morning), pass that as time_constraint.
"""

TRAIN_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_trains",
        "description": "Search for trains between stations with optional time constraints.",
        "parameters": {
            "type": "object",
            "properties": {
                "origin": {
                    "type": "string",
                    "description": "Origin city or station, e.g. Kolkata",
                },
                "destination": {
                    "type": "string",
                    "description": "Destination city or station, e.g. Delhi",
                },
                "date": {
                    "type": "string",
                    "description": "Travel date, e.g. tomorrow or specific date",
                },
                "time_constraint": {
                    "type": "string",
                    "enum": ["morning", "afternoon", "evening", "night", "any"],
                    "description": "Time of day preference if specified by the user",
                },
            },
            "required": ["origin", "destination", "date"],
        },
    },
}


class ToolCall(BaseModel):
    name: str
    arguments: Dict[str, Any]
    id: Optional[str] = None


class LLMResponse(BaseModel):
    content: Optional[str] = None
    tool_calls: List[ToolCall] = []
    latency_ms: int = 0
    model: str = ""
    provider: str = "groq"


class BaseLLMService(ABC):
    @abstractmethod
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> LLMResponse:
        pass


class GroqLLMService(BaseLLMService):
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or settings.GROQ_API_KEY
        self.model = model or settings.GROQ_MODEL or "llama-3.3-70b-versatile"
        self.is_configured = bool(
            self.api_key and "your_groq" not in self.api_key and len(self.api_key) > 10
        )
        self._client = None
        if self.is_configured:
            from groq import AsyncGroq
            self._client = AsyncGroq(api_key=self.api_key)

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> LLMResponse:
        start_time = time.time()
        tools_to_use = tools if tools is not None else [TRAIN_SEARCH_TOOL]

        # Prepare messages with system prompt
        formatted_messages = []
        if not any(m.get("role") == "system" for m in messages):
            formatted_messages.append({"role": "system", "content": SYSTEM_VOICE_PROMPT})
        formatted_messages.extend(messages)

        if self.is_configured and self._client:
            try:
                response = await self._client.chat.completions.create(
                    model=self.model,
                    messages=formatted_messages,
                    tools=tools_to_use if tools_to_use else None,
                    temperature=0.3,
                    max_tokens=150,
                )
                elapsed_ms = int((time.time() - start_time) * 1000)
                choice = response.choices[0].message

                parsed_tool_calls: List[ToolCall] = []
                if choice.tool_calls:
                    for tc in choice.tool_calls:
                        args = json.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else tc.function.arguments
                        parsed_tool_calls.append(
                            ToolCall(name=tc.function.name, arguments=args, id=tc.id)
                        )

                return LLMResponse(
                    content=choice.content,
                    tool_calls=parsed_tool_calls,
                    latency_ms=elapsed_ms,
                    model=self.model,
                    provider="groq",
                )
            except Exception as e:
                logger.error(f"Groq API error: {e}. Using fallback generator.")

        # Graceful Local Fallback generator for zero-cost hackathon dev
        elapsed_ms = int((time.time() - start_time) * 1000)
        last_user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_msg = m.get("content", "").lower()
                break

        # Simulate intelligent function calling or spoken response based on query
        if "train" in last_user_msg or "kolkata" in last_user_msg or "delhi" in last_user_msg:
            time_filter = "evening" if "evening" in last_user_msg else "morning" if "morning" in last_user_msg else "any"
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        name="search_trains",
                        arguments={
                            "origin": "Kolkata",
                            "destination": "Delhi",
                            "date": "tomorrow",
                            "time_constraint": time_filter,
                        },
                        id="call_mock_1",
                    )
                ],
                latency_ms=max(18, elapsed_ms),
                model=f"{self.model} (local dev)",
                provider="groq-mock",
            )
        else:
            return LLMResponse(
                content="I can help you search and book trains across India. Where would you like to travel?",
                tool_calls=[],
                latency_ms=max(15, elapsed_ms),
                model=f"{self.model} (local dev)",
                provider="groq-mock",
            )
