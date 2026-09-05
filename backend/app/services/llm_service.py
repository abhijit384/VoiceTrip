import time
import logging
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod
from pydantic import BaseModel
from app.models.travel import TravelIntent
from app.services.gemini_service import (
    GeminiService,
    ToolCall,
    LLMResponse,
    SYSTEM_VOICE_PROMPT,
    INTENT_EXTRACTION_SYSTEM_PROMPT,
)

logger = logging.getLogger("llm-service")


class BaseLLMService(ABC):
    @abstractmethod
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        prior_intent: Optional[TravelIntent] = None,
    ) -> LLMResponse:
        pass


# Gemini is now the primary LLM provider
llm_service = GeminiService()

__all__ = [
    "GeminiService",
    "BaseLLMService",
    "ToolCall",
    "LLMResponse",
    "SYSTEM_VOICE_PROMPT",
    "INTENT_EXTRACTION_SYSTEM_PROMPT",
    "llm_service",
]
