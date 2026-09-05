# VoiceTrip Architecture

## Overview
VoiceTrip is a voice-native travel assistant built to handle complex, asynchronous, realtime speech interactions. 
Its architecture specifically resolves the **hard voice problem**: managing state and stale audio during long-running async tool calls when a user barges in to interrupt or change constraints.

## Components
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS. Handles the UI, LiveKit / WebSocket microphone streams, and Web Audio API for playback.
- **Realtime Transport**: LiveKit Cloud WebRTC and FastAPI WebSocket audio hubs for low-latency microphone audio streaming.
- **STT**: Deepgram Flux / Nova-2 via WebSocket for realtime speech-to-text with acoustic keyterm boosting and barge-in detection.
- **Intent & Canonical Context**: Google Gemini 3.6 Flash LLM for intent routing, parameter extraction, and multi-turn state resolution (`gemini_service.py`) with deterministic regex fallback.
- **Domain Normalizer**: Railway Station and City entity normalizer (`railway_normalizer.py`) ensuring exact origin/destination resolution without phonetic drift.
- **Travel Tools**: High-fidelity simulated API services executing multi-modal travel searches (Trains, Flights, Hotels, Buses) with realistic data and intentional latency windows (`tool_service.py`).
- **State Management & Concurrency**: Epoch-based concurrency manager (`interruption_manager.py`) tracking monotonic `generation_id` across turns.
- **Rime TTS**: Primary spoken voice engine (`tts_service.py`) synthesizing natural conversational audio via HTTP POST to `https://users.rime.ai/v1/rime-tts` (`mist` model, `amber` voice).
- **UI / Result Rendering**: Interactive React components rendering structured flight, train, and hotel search cards natively alongside live audio telemetry.

## End-to-End Data Flow

```
User speech
-> microphone (Browser Web Audio / LiveKit)
-> Realtime Audio Transport (WebSocket / WebRTC)
-> STT Engine (Deepgram Flux / Nova-2)
-> Intent Classification & Canonical Context Engine (Gemini 3.6 Flash)
-> Normalized Request (Railway / City Entities via railway_normalizer.py)
-> Guarded Travel Tool Execution (if valid travel intent)
-> Tool Result
-> Stale Result Protection Barrier (Checks generation_id vs active epoch)
-> Gemini Spoken Response Generation (Concise 1–3 sentence voice summary)
-> Rime TTS Engine (mist model / amber voice)
-> Binary Audio Stream / Base64 Decode
-> Audio Playback (Browser Web Audio API AudioBufferSourceNode + HTMLAudioElement)
```

## Interruption Flow

When the user barges in while the assistant is speaking or awaiting tool execution:
```
User speaks (Barge-in detected by STT or "Interrupt AI" button pressed)
-> Active response or tool work in progress
-> Interrupt / change request triggered
-> Stop active Rime playback on frontend (< 25ms Web Audio buffer flush)
-> Increment generation_id epoch in backend (gen_1 -> gen_2)
-> Invalidate in-flight background tasks via asyncio.CancelledError
-> Stale tool results tagged [STALE - RESULT BLOCKED] and dropped
-> Process new request with preserved canonical context
-> New result generated
-> New Rime response synthesized and vocalized
```

## State & Stale Result Protection
VoiceTrip utilizes **Monotonic Generation Epochs**. 
Every voice turn is tagged with a unique `generation_id` (e.g. `gen_1`, `gen_2`). Background tasks (LLM generation, tool execution) are tracked under this ID.
When a user barges in, the session epoch increments (`gen_1` $\to$ `gen_2`).
If a delayed tool from `gen_1` returns later, it hits the **Stale Result Protection Barrier** in `interruption_manager.py`. The barrier checks `result.generation_id == current_generation_id`. Since `gen_1 != gen_2`, the result is dropped immediately (`[STALE - RESULT BLOCKED]`) before it can mutate conversational state or trigger Rime TTS.

## Travel Routing
Inputs are categorized through intent classification:
- **Trains, Flights, Hotels, Buses**: Extracts `origin`, `destination`, `date`, `time_constraint`, `budget`, etc., and executes the relevant tool if data is complete.
- **General / Conversational**: Greetings, jokes, and general questions do not trigger travel tools. Handled conversationally via Gemini.
- **Travel Follow-ups**: Preserves the active `CanonicalTravelContext` (e.g., origin/destination) and merges new constraints (e.g., "Actually, make it evening" or "Show cheaper ones").
- **Ambiguous Requests**: If entities are missing, prompts the user with a concise 1-sentence clarification question.

## Failure Recovery
- **Microphone permission fails**: Frontend catches the exception and prompts the user with UI guidance.
- **STT fails / network drops**: Deepgram errors are logged; frontend falls back to native SpeechRecognition or text simulation.
- **Gemini fails / rate limit**: Automatically falls back to deterministic rule-based canonical intent classification.
- **Rime fails / offline**: Generates a 24kHz synthesized vocal cadence tone locally so the pipeline never crashes during offline evaluation.
- **Travel search fails / timeouts**: Handled gracefully via `try/except` blocks in `tool_service.py`.
- **User interrupts**: Tasks are cancelled asynchronously via `asyncio.Task.cancel()`.
- **Stale tool result arrives**: Filtered by `InterruptionManager` and dropped instantly.

## External Services
- **Rime**: Primary TTS provider generating natural, ultra-low latency voice responses (`mist` model, `amber` voice).
- **LiveKit**: WebRTC transport infrastructure for microphone audio.
- **Deepgram**: Realtime STT engine translating microphone audio to text.
- **Gemini (Google GenAI)**: LLM for intent routing, context extraction, and voice summaries.
- **Supabase**: Optional backend database persistence.
