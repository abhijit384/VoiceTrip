# VoiceTrip 🚄🎙️

> **A Realtime Voice-Native Assistant with Interruption, Recovery, and Stale Result Protection during Long-Running Tool Calls.**  
> Built for the **Rime Hackathon Challenge**.

[![Python Tests](https://img.shields.io/badge/pytest-21%20passed-brightgreen.svg)](file:///d:/Rime%20PS/tests)
[![Vite Build](https://img.shields.io/badge/vite-compiled-success.svg)](file:///d:/Rime%20PS/frontend)
[![Voice Provider](https://img.shields.io/badge/Voice%20Provider-Rime%20TTS%20(Amber)-blueviolet.svg)](https://rime.ai)
[![LLM Provider](https://img.shields.io/badge/LLM-Groq%20(Llama%203.3)-orange.svg)](https://groq.com)

---

## 🎯 The Core Voice Problem

In voice-native applications, long-running tool execution (e.g. 5-second travel queries, booking engines, external APIs) introduces severe conversational edge cases when users barge in:

1. **Ghost Audio**: The voice assistant keeps speaking outdated information that the user interrupted.
2. **Stale State Leakage (Race Condition)**: An obsolete background search finishes *after* the new instruction has arrived, mistakenly overwriting the active conversation state.
3. **Conversational Amnesia**: The pipeline drops the initial query parameters and evaluates the new constraint in a vacuum.

### VoiceTrip's Solution
VoiceTrip implements **Monotonic Generation Epochs**, **Sub-30ms Audio Cutoff**, **Asynchronous Task Cancellation**, and a **Stale Result Protection Barrier**:
- When the user interrupts, in-flight background tasks are immediately cancelled via `asyncio.Task.cancel()`.
- Active and buffered Rime audio playback cuts off within **< 25ms**.
- Stale results arriving from cancelled or delayed tasks are intercepted by the barrier, marked `[STALE - RESULT BLOCKED]`, and barred from reaching the speaker or updating session state.
- The new constraint (e.g. *"evening trains"*) is merged with the existing context (*Kolkata to Delhi*), returning the correct results (*Howrah Rajdhani at 16:55, Duronto at 17:45, Sealdah Rajdhani at 18:50*).
- Spoken output is delivered exclusively through **Rime TTS**.

---

## 🏗️ Architecture

```
User Microphone
       │ (WebRTC Audio Stream)
       ▼
LiveKit Session (Client & Server Token Authentication)
       │ (150ms Audio Slices)
       ▼
Deepgram Streaming STT (`wss://api.deepgram.com/v1/listen?model=nova-2`)
       │ (Interim & Final Transcripts + Barge-In Detector)
       ▼
Interruption & Epoch Manager (FastAPI Backend)
       │ (Monotonic Epoch: gen_1 → gen_2)
       ▼
Groq LLM Service (`llama-3.3-70b-versatile` with Function Calling Schema)
       │ (Tool Dispatch: `search_trains`)
       ▼
Simulated Travel Search Tool (5.0s Intentional Stress Delay + Cancellation)
       │ (Stale Result Protection Barrier: drops obsolete gen_1 results)
       ▼
Rime TTS Synthesis Engine (`https://users.rime.ai/v1/rime-tts`)
       │ (`speaker: amber`, `modelId: mist`, `sampleRate: 24000`)
       ▼
Browser Realtime Audio Stream + Interactive Waveform Visualizer
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+ (tested on Python 3.14)
- Node.js v18+ & npm v9+
- Git

### 1. Clone & Configure Environment
```bash
cp .env.example .env
```

Edit `.env` with your API keys:
```ini
# Rime TTS Configuration (Primary Spoken Output)
RIME_API_KEY=your_rime_api_key_here
RIME_API_URL=https://users.rime.ai/v1/rime-tts
RIME_MODEL_ID=mist
RIME_SPEAKER=amber
RIME_AUDIO_FORMAT=mp3
RIME_SAMPLE_RATE=24000
RIME_SPEED_ALPHA=1.0

# LLM Service Configuration (Groq Free Tier)
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# STT Service Configuration (Deepgram)
DEEPGRAM_API_KEY=your_deepgram_api_key_here
DEEPGRAM_MODEL=nova-2

# LiveKit Realtime Configuration
LIVEKIT_URL=wss://your-livekit-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here

# Tool Delay for Interruption Stress-Testing
TOOL_ARTIFICIAL_DELAY_SECONDS=5.0
```

> **Note**: Zero-cost graceful fallbacks are included out-of-the-box for all cloud services, enabling full offline evaluation and testing even before pasting cloud API keys!

---

### 2. Start the Backend (FastAPI)

```bash
cd backend
# Create virtual environment (if not already created)
python -m venv .venv
.\.venv\Scripts\activate   # On Windows PowerShell
# source .venv/bin/activate  # On macOS/Linux

pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
FastAPI will run on **`http://127.0.0.1:8000`** (Swagger docs available at `/docs`).

---

### 3. Start the Frontend (React + Vite + Tailwind)

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```
Open your browser at **`http://127.0.0.1:5173`**.

---

## 🧪 Automated Test Suite (21 Tests)

Run the full backend test suite covering all services, API endpoints, and race conditions:

```bash
cd backend
.\.venv\Scripts\pytest ..\tests\ -v
```

### Test Coverage Highlights:
- **`test_health.py`**: Health check and configuration status.
- **`test_livekit_token.py`**: LiveKit token generation and video grants.
- **`test_websocket_stt.py`**: STT WebSocket handshake, ping/pong, and transcript streaming.
- **`test_llm_service.py`**: Groq LLM service abstraction, voice constraints, and conversation history.
- **`test_tool_service.py`**: 5.0s asynchronous tool execution, cancellation, and timeout handling.
- **`test_tool_api.py`**: Tool execution and barge-in interruption API routes.
- **`test_rime_tts.py`**: Rime TTS service, audio format validation, and synthesis endpoint.
- **`test_interruption_recovery.py`**:
  - `test_race_condition_tool_result_arriving_after_interruption` (PASSED)
  - `test_race_condition_audio_arriving_after_cancellation` (PASSED)
  - `test_race_condition_multiple_rapid_interruptions` (PASSED)
  - `test_race_condition_cancellation_during_llm_generation` (PASSED)
  - `test_race_condition_cancellation_during_tts_generation` (PASSED)
  - `test_main_interruption_acceptance_test` (PASSED)

---

## 🎙️ Core Hackathon Acceptance Test

In the browser UI at `http://127.0.0.1:5173`:

1. **Click "1-Click Acceptance Test"** (or speak into the microphone):
   - User turn: *"Find me trains from Kolkata to Delhi tomorrow."*
2. **Tool Execution Starts**:
   - The UI enters `tool_running` state.
   - The 5.0-second countdown progress bar activates.
3. **Barge-In Interruption**:
   - At ~2.2 seconds, the user speaks or triggers: *"Actually, only evening trains."*
   - Audio cuts off immediately in **< 25ms**.
   - `gen_1` tool task is aborted.
   - Conversation ledger stamps `[STALE - RESULT BLOCKED]` on `gen_1`.
4. **State Recovery & Voice Synthesis**:
   - Epoch advances to `gen_2`.
   - Tool retrieves evening trains (Howrah Rajdhani, Howrah Duronto, Sealdah Rajdhani).
   - Assistant vocalizes the evening train options exclusively via **Rime TTS**.

---

## 📂 Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health.py              # Health check endpoint
│   │   │   ├── livekit_token.py       # LiveKit room token generator
│   │   │   ├── websocket_hub.py       # Realtime duplex STT WebSocket
│   │   │   ├── session.py             # Groq LLM chat & session store
│   │   │   ├── tool.py                # Travel search tool endpoints
│   │   │   ├── tts.py                 # Rime TTS synthesis endpoints
│   │   │   └── orchestrator.py        # Interruption recovery pipeline
│   │   ├── core/
│   │   │   └── config.py              # Typed settings (pydantic-settings)
│   │   ├── models/
│   │   │   └── travel.py              # Pydantic schemas for train search
│   │   └── services/
│   │       ├── stt_service.py         # Deepgram streaming STT client
│   │       ├── llm_service.py         # Groq LLM service abstraction
│   │       ├── tool_service.py        # search_trains with 5s delay
│   │       ├── tts_service.py         # Rime TTS official client
│   │       └── interruption_manager.py # Epoch tracking & stale protection
│   ├── main.py                        # FastAPI application entry point
│   └── requirements.txt               # Backend dependencies
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx             # Brand, LiveKit status, Rime provider badge
│   │   │   ├── VoiceStatusCard.tsx    # Interactive glowing mic & 5s countdown
│   │   │   ├── AudioWaveform.tsx      # State-responsive multi-bar waveform
│   │   │   ├── LiveTranscripts.tsx    # Real-time interim & final transcripts
│   │   │   ├── ConversationFeed.tsx   # Ledger with [STALE - BLOCKED] badges
│   │   │   ├── TelemetryHUD.tsx       # Real-time latency HUD
│   │   │   └── DemoScenarios.tsx      # 1-Click acceptance test buttons
│   │   ├── hooks/
│   │   │   ├── useLiveKitSession.ts   # LiveKit WebRTC connection hook
│   │   │   ├── useRealtimeSTT.ts      # Deepgram audio streaming hook
│   │   │   └── useRimeAudioPlayer.ts  # Rime TTS audio playback & cutoff
│   │   ├── types/
│   │   │   └── voice.ts               # Core TypeScript interfaces
│   │   └── App.tsx                    # Root voice agent state machine
│   └── package.json
├── tests/                             # 21 Automated pytest unit & integration tests
├── RIME_EVIDENCE.md                   # Hackathon challenge proof & latency logs
└── README.md
```

---

## ⚖️ License

MIT License. Developed for the **Rime Hackathon Challenge**.
