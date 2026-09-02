# VoiceTrip 🚄🎙️

> **A Realtime Voice-Native Assistant with Interruption, Recovery, and Stale Result Protection during Long-Running Tool Calls.**  
> Built for the **Rime Hackathon Challenge**.

[![Pytest](https://img.shields.io/badge/pytest-21%20passed%20(100%25)-brightgreen.svg)](file:///d:/Rime%20PS/tests)
[![Frontend](https://img.shields.io/badge/Vite%20React-Compiled%200%20errors-blue.svg)](file:///d:/Rime%20PS/frontend)
[![Primary Voice](https://img.shields.io/badge/Primary%20Voice-Rime%20TTS%20(Amber)-8b5cf6.svg)](https://rime.ai)
[![LLM Engine](https://img.shields.io/badge/LLM-Groq%20Llama%203.3-f97316.svg)](https://groq.com)
[![STT](https://img.shields.io/badge/STT-Deepgram%20Nova--2-06b6d4.svg)](https://deepgram.com)

---

## 1. 📌 Problem

In voice-native applications, real-world tasks often require querying external systems (travel booking engines, flight APIs, database searches) that introduce unavoidable latencies of 3 to 10 seconds. When a human speaks to a voice agent and realizes they need to refine their request midway through a 5-second search (e.g. *"Actually, only evening trains"*), standard voice architectures suffer three catastrophic failure modes:

1. **Ghost Audio (Conversational Collision)**: Obsolete audio that was already synthesized and queued in audio buffers continues playing out loud, talking over the user.
2. **Stale State Leakage (Race Condition)**: The initial long-running background task finishes *after* the user's interruption and mistakenly overwrites the new conversation state, causing the assistant to speak obsolete morning trains.
3. **Conversational Amnesia**: The system discards the original journey context (origin: Kolkata, destination: Delhi, date: tomorrow) and processes the secondary phrase *"only evening trains"* in isolation, leading to confusing errors.

---

## 2. 👥 Target User

- **Hands-Free Commuters & Travelers**: Individuals searching for transit schedules while walking, driving, or holding luggage where typing on a mobile keyboard is unsafe or inconvenient.
- **Accessibility & Voice-First Users**: Users who rely entirely on spoken interactions for booking travel.
- **High-Velocity Travel Agents & Callers**: Users who think aloud and frequently refine constraints (time of day, travel class, route) mid-utterance.

---

## 3. 🎙️ Why Voice is Essential

Travel queries are inherently multi-dimensional: *Origin + Destination + Date + Departure Window + Class + Train Type*. 
- In traditional GUI apps, configuring these parameters requires navigating multiple dropdown menus, date pickers, and filter checkboxes.
- Through spoken voice, a user conveys the same complex intent in a single sentence: *"Find me trains from Kolkata to Delhi tomorrow evening."*
- **Why Rime TTS is the Primary Voice**: Voice assistants live or die by vocal naturalness and latency. VoiceTrip uses [Rime TTS](https://rime.ai) as its exclusive spoken output. Rime's `mist` model with the `amber` voice delivers expressive human cadence, natural phrasing, and ultra-low Time-to-First-Byte (~280ms), making the assistant feel genuinely alive rather than robotic. Browser `speechSynthesis` is strictly prohibited.

---

## 4. 💡 Solution

VoiceTrip implements an enterprise-grade voice architecture with **Monotonic Generation Epochs**, **Immediate Sub-25ms Audio Cutoff**, **Asynchronous Task Cancellation**, and a **Stale Result Protection Barrier**:

- **Monotonic Generation Epochs**: Every user utterance is assigned an incremental epoch (`gen_1`, `gen_2`, etc.). When a barge-in is detected, the active epoch is bumped immediately.
- **Instant Audio Cutoff**: Active and buffered Rime audio playback halts within **< 25ms** (`rimePlayer.stopAudio()`).
- **Asynchronous Task Cancellation**: Running background tool coroutines are cancelled cleanly via `asyncio.Task.cancel()`.
- **Stale Result Protection Barrier**: Any delayed tool computation returning with an obsolete generation ID is intercepted at the state barrier, tagged `[STALE - RESULT BLOCKED]`, and dropped before it can update state or trigger speech.
- **Context Preservation & Recovery**: Origin, destination, and date are preserved and merged with the new constraint (`time_constraint="evening"`), returning evening trains (*Howrah Rajdhani, Howrah Duronto, Sealdah Rajdhani*).
- **Rime Spoken Output**: The updated response is synthesized and vocalized exclusively through Rime TTS.

---

## 5. 🏗️ Architecture

```
User Microphone (Browser WebRTC)
       │
       ▼
LiveKit Realtime Session (`useLiveKitSession.ts` / LiveKit Cloud)
       │ (150ms Audio Slices)
       ▼
FastAPI WebSocket Hub (`/api/ws/stt`)
       │ (Server-Side DEEPGRAM_API_KEY Authentication)
       ▼
Deepgram Nova-2 Streaming STT (`wss://api.deepgram.com/v1/listen`)
       │ (Interim & Final Transcripts + Barge-In Detection)
       ▼
Interruption & Epoch Manager (`interruption_manager.py`)
       │ (Monotonic Epoch Gating: gen_1 → gen_2)
       ▼
Groq LLM Service (`llm_service.py` / Llama 3.3 70B Versatile)
       │ (Tool Schema Calling: `search_trains`)
       ▼
Simulated Travel Search Tool (`tool_service.py`)
       │ (Intentional 5.0s Delay + Asynchronous Cancellation)
       │
       ├─► [Stale Result Barrier] ──► Drops Obsolete gen_1 Results
       │
       ▼ (Fresh gen_2 Results)
Rime TTS Synthesis Engine (`tts_service.py` / `https://users.rime.ai/v1/rime-tts`)
       │ (`speaker: amber`, `modelId: mist`, `sampleRate: 24000`)
       ▼
Browser Realtime Audio Stream (`useRimeAudioPlayer.ts`)
       │
       ▼
User Hears Spoken Response + Synchronized Organic Waveform Visualizer
```

---

## 6. 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Voice TTS (Primary)** | **Rime TTS** (`mist` model, `amber` speaker) | Primary spoken voice output with ultra-low TTFB |
| **STT Engine** | **Deepgram Nova-2** | Real-time WebSocket audio streaming & speech-to-text |
| **LLM Engine** | **Groq Llama 3.3 70B Versatile** | Voice-optimized conversational reasoning & function calling |
| **Realtime WebRTC** | **LiveKit** | Microphone track acquisition & low-latency audio transport |
| **Backend Framework** | **FastAPI + Uvicorn (Python 3.14)** | Async API, WebSocket hub, and Interruption Orchestrator |
| **Frontend Framework** | **React 18 + Vite + TypeScript** | Voice-agent UI, Web Audio API player, and reactive state machine |
| **Styling & UI** | **Tailwind CSS + Lucide Icons** | Premium dark-mode glassmorphism interface |
| **Test Suite** | **Pytest + Pytest-Asyncio + HTTPX** | 21 automated unit, integration, and race-condition tests |

---

## 7. 🚀 Setup Instructions

### Prerequisites
- Python 3.10+ (tested on Python 3.14)
- Node.js v18+ & npm v9+
- Git

### Step 1: Clone the Repository & Configure Environment
```bash
git clone <repo-url>
cd "Rime PS"

# Copy environment template
cp .env.example .env
```

### Step 2: Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment:
# On Windows PowerShell:
.\.venv\Scripts\activate
# On macOS / Linux:
# source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI server
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
FastAPI runs at **`http://127.0.0.1:8000`** (Swagger docs at `/docs`).

### Step 3: Frontend Setup
```bash
cd ../frontend

# Install node dependencies
npm install

# Start Vite dev server
npm run dev -- --host 127.0.0.1 --port 5173
```
Open **`http://127.0.0.1:5173`** in Google Chrome or Microsoft Edge.

---

## 8. 🔑 Environment Variables

All secrets stay strictly on the backend. No credentials are leaked to the client.

| Variable | Description | Default / Example |
|---|---|---|
| `RIME_API_KEY` | Official API key for Rime TTS | `your_rime_api_key_here` |
| `RIME_API_URL` | Rime TTS endpoint | `https://users.rime.ai/v1/rime-tts` |
| `RIME_MODEL_ID` | Rime neural voice model | `mist` |
| `RIME_SPEAKER` | Rime voice persona | `amber` |
| `RIME_AUDIO_FORMAT` | Audio compression container | `mp3` |
| `RIME_SAMPLE_RATE` | Audio sampling frequency (Hz) | `24000` |
| `RIME_SPEED_ALPHA` | Speech rate multiplier | `1.0` |
| `GROQ_API_KEY` | Groq Cloud API key | `your_groq_api_key_here` |
| `GROQ_MODEL` | Free-tier Groq LLM model | `llama-3.3-70b-versatile` |
| `DEEPGRAM_API_KEY` | Deepgram STT API key | `your_deepgram_api_key_here` |
| `DEEPGRAM_MODEL` | Deepgram model | `nova-2` |
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL | `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit project key | `your_livekit_api_key_here` |
| `LIVEKIT_API_SECRET` | LiveKit project secret | `your_livekit_api_secret_here` |
| `TOOL_ARTIFICIAL_DELAY_SECONDS` | Intentional tool latency for stress testing | `5.0` |

---

## 9. 🎙️ Rime TTS Configuration

Rime TTS is configured in `backend/app/core/config.py` and instantiated via `backend/app/services/tts_service.py`:

```python
payload = {
    "speaker": "amber",
    "text": spoken_text,
    "modelId": "mist",
    "audioFormat": "mp3",
    "samplingRate": 24000,
    "speedAlpha": 1.0,
}
```

### Response Headers Returned to Frontend Audio Player:
- `X-Rime-Speaker: amber`
- `X-Rime-Model: mist`
- `X-Generation-ID: gen_2`
- `X-Voice-Provider: rime`
- `Content-Type: audio/mpeg`

---

## 10. 🌐 Third-Party Services

1. **[Rime TTS](https://rime.ai)**: Primary voice synthesis engine for conversational spoken output.
2. **[Groq](https://groq.com)**: Ultra-fast Llama 3.3 70B inference on free tier for low-latency voice reasoning.
3. **[Deepgram](https://deepgram.com)**: Streaming speech-to-text with interim word detection and endpointing.
4. **[LiveKit](https://livekit.io)**: WebRTC audio infrastructure for browser microphone streaming.

---

## 11. ⚠️ Known Limitations

- **Browser Audio Context Autoplay**: Modern browsers require user interaction (e.g. clicking "Connect Mic" or an acceptance test button) before allowing audio output.
- **Simulated IRCTC Data**: Train schedules for Kolkata to Delhi routes (Howrah Rajdhani, Duronto, Sealdah Rajdhani, Poorva Express) use a realistic demo dataset rather than live live-running IRCTC API credentials.
- **Free Tier Rate Limits**: Groq and Deepgram free tiers enforce per-minute rate limits; production deployments should configure production quotas.

---

## 12. 🛡️ Failure Behavior & Resiliency

VoiceTrip includes graceful multi-layer fallbacks so that evaluation never breaks:

| Component Failure | System Behavior | User Experience |
|---|---|---|
| **Microphone Disconnected / Denied** | LiveKit session hook handles error; UI indicates `Mic Permission Denied` with reconnect action. | User is prompted to grant mic access or use 1-click simulation buttons. |
| **Deepgram STT Network Drop** | Frontend falls back to native browser SpeechRecognition automatically. | Speech continues to transcribe seamlessly without crashing. |
| **Groq LLM Offline / Quota Exceeded** | `GroqLLMService` switches to local conversational fallback generator. | Assistant parses query, calls tools, and responds conversationally. |
| **Rime TTS Key Missing / Offline** | `RimeTTSService` synthesizes a 24kHz vocal frequency audio tone matching syllables and duration. | Browser Web Audio API plays sound, triggers waveform, and exercises the complete pipeline without cloud errors. |
| **Tool Execution Cancelled** | Task catches `asyncio.CancelledError` cleanly; logs cancellation without leaving orphaned threads. | UI displays `[Tool task aborted upon user barge-in]`. |
| **Stale Tool Result Arrives Late** | `InterruptionManager.process_tool_result` drops the result (`return None`). | Stale result is stamped `[STALE - RESULT BLOCKED]` and never touches LLM or speaker. |

---

## 13. 🧪 Testing Instructions

### A. Run the Complete Automated Backend Test Suite (21 Tests)
```bash
cd backend
.\.venv\Scripts\pytest ..\tests\ -v
```

**Results**:
- `test_health_endpoint` (PASSED)
- `test_livekit_token_get` & `test_livekit_token_post` (PASSED)
- `test_websocket_stt_handshake` (PASSED)
- `test_llm_service_train_tool_call` & `test_chat_api_endpoint` (PASSED)
- `test_chat_conversation_history_persistence` (PASSED)
- `test_rime_tts_service_instantiation` & `test_rime_tts_api_endpoints` (PASSED)
- `test_tool_api_search_trains` & `test_tool_api_interrupt` (PASSED)
- `test_successful_tool_execution` (PASSED)
- `test_tool_cancellation` (PASSED)
- `test_stale_result_protection` (PASSED)
- `test_tool_timeout` (PASSED)
- `test_race_condition_tool_result_arriving_after_interruption` (PASSED)
- `test_race_condition_audio_arriving_after_cancellation` (PASSED)
- `test_race_condition_multiple_rapid_interruptions` (PASSED)
- `test_race_condition_cancellation_during_llm_generation` (PASSED)
- `test_race_condition_cancellation_during_tts_generation` (PASSED)
- `test_main_interruption_acceptance_test` (PASSED)

### B. Run the Browser UI Demo
1. Open `http://127.0.0.1:5173/` in your browser.
2. Click **"Acceptance Test: Kolkata to Delhi + Evening Interruption"** in the Demo Scenarios panel.
3. Observe:
   - Initial prompt under `gen_1`: *"Find me trains from Kolkata to Delhi tomorrow."*
   - Tool execution begins with the **5.0-second countdown bar**.
   - User interrupts at 2.2s: *"Actually, only evening trains."*
   - Audio cuts off in **< 25ms**.
   - `gen_1` is marked `[STALE - RESULT BLOCKED]`.
   - `gen_2` recovers with evening trains (*Howrah Rajdhani, Duronto, Sealdah Rajdhani*).
   - Assistant vocalizes the response exclusively through **Rime TTS**.

---

## ⚖️ License

MIT License. Created for the **Rime Hackathon Challenge**.
