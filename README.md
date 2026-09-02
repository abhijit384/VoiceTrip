# Rime Voice Travel Assistant 🚄🎙️

> **A Realtime Voice-Native Assistant with Interruption, Recovery, and Stale Result Protection during Long-Running Tool Calls.**
> Built for the **Rime Hackathon Challenge**.

---

## 🎯 The Core Problem & Innovation

When users interact with voice assistants in practical scenarios (such as booking travel or searching itineraries), tools often take multiple seconds to execute. If a user interrupts the assistant midway (e.g. *"Actually, only evening trains"*), standard voice pipelines face major failure modes:
1. **Ghost Audio**: Obsolete audio queued up in TTS buffers continues playing over the user.
2. **Stale State Leakage**: In-flight background tools finish *after* the new prompt and erroneously overwrite the conversation state or trigger obsolete speech.
3. **Loss of Conversational Context**: The model discards the origin query and treats the second constraint in isolation.

### The Solution: Interruption + Recovery + Stale Result Protection
- **Epoch / Generation ID**: Every user turn and barge-in generates a unique monotonically increasing generation ID.
- **Immediate Task Abort**: Ongoing tool tasks are signaled for cancellation via asyncio task handles.
- **Stale Guard Barrier**: Any tool result returning with an outdated generation ID is instantly dropped before it can touch the LLM or trigger TTS.
- **Instant Audio Cutoff**: Active Rime TTS audio playback and streaming buffers are immediately paused and flushed upon user speech detection.
- **Rime as Primary Voice**: Spoken output is delivered exclusively via [Rime TTS](https://rime.ai), guaranteeing natural voice delivery.

---

## 🏗️ Architecture

```
Browser Microphone
       ↓ (WebRTC / Audio Track)
LiveKit Engine
       ↓
Deepgram STT (Streaming Transcripts + Barge-In Detector)
       ↓
Interruption & Generation Manager (FastAPI Backend)
       ↓
Groq LLM Service (Llama 3.3 Free Tier with Function Calling)
       ↓
Travel Search Tool (Simulated 5-second IRCTC search with cancelable task)
       ↓
Rime TTS Engine (Primary Spoken Audio Stream)
       ↓ (WebRTC Audio Stream)
Browser Audio Output + Interactive Waveform Visualizer
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+ & npm v9+
- Python 3.10+ (tested on Python 3.14)
- Git

### 1. Clone & Configure
```bash
cp .env.example .env
# Edit .env with your Rime, Groq, Deepgram, and LiveKit credentials
```

### 2. Backend Setup
```bash
cd backend
python -m venv .venv
# On Windows:
.\.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python main.py
```
Backend health check: [http://localhost:8000/api/health](http://localhost:8000/api/health)  
Interactive API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Frontend URL: [http://localhost:5173](http://localhost:5173)

---

## 🧪 Testing & Verification

Run automated backend tests:
```bash
cd backend
.\.venv\Scripts\pytest ../tests/ -v
```

### Acceptance Test Scenario
1. **User Prompt**: *"Find me trains from Kolkata to Delhi tomorrow."*
2. **Tool Runs**: Travel search tool starts with an intentional 5-second simulated lookup.
3. **User Interrupts**: *"Actually, only evening trains."*
4. **Verification**:
   - Audio cuts off immediately.
   - Generation ID increments from `gen_1` to `gen_2`.
   - Tool `gen_1` is aborted and marked stale.
   - LLM merges constraint to search evening trains only.
   - Rime TTS outputs the evening trains (e.g., Howrah - New Delhi Rajdhani departing 16:55).

---

## ⚙️ Environment Variables

See [`.env.example`](./.env.example) for all variables:
- `RIME_API_KEY`: API key from [Rime](https://rime.ai)
- `RIME_API_URL`: `https://users.rime.ai/v1/rime-tts`
- `RIME_SPEAKER`: `amber` (or other Rime voice)
- `RIME_MODEL_ID`: `mist`
- `GROQ_API_KEY`: Groq Cloud API key
- `DEEPGRAM_API_KEY`: Deepgram Console API key
- `LIVEKIT_URL`: LiveKit Cloud WebSocket URL
- `LIVEKIT_API_KEY`: LiveKit Cloud API Key
- `LIVEKIT_API_SECRET`: LiveKit Cloud API Secret
- `TOOL_ARTIFICIAL_DELAY_SECONDS`: `5.0` (stress-test delay)
