# Submission Checklist

### Core Deliverables
- [x] README.md finalized and synchronized
- [x] RIME_EVIDENCE.md finalized with verified observations
- [x] source code included (frontend, backend, tests)
- [ ] demo video recorded and linked [ADD LINK]
- [x] architecture documentation included (`docs/ARCHITECTURE.md`)
- [x] .env.example included with clean placeholders
- [x] no secrets or API keys included in repository
- [ ] final ZIP created for hackathon submission

### Rime Integration
- [x] Rime is primary spoken output
- [x] exact model ID verified (`mist`)
- [x] exact speaker verified (`amber`)
- [x] language verified (`en`)
- [x] endpoint verified (`https://users.rime.ai/v1/rime-tts`)
- [x] audio format verified (`mp3`, 24,000 Hz)
- [x] transport verified (HTTP POST REST with Base64 audioContent decode)
- [x] no Rime key exposed in frontend or Git

### Voice Engineering
- [x] hard voice problem clearly stated (interruption during long-running tool calls)
- [x] testable claim formulated
- [x] explicit acceptance criteria defined (AC-1 through AC-9)
- [x] acceptance test suite executed (Tests A through F)
- [x] real test observations recorded without exaggeration
- [x] timings and latencies benchmarked
- [x] reproducibility steps documented
- [x] interruption and audio cutoff behavior verified
- [x] stale-result epoch barrier verified

### Product & Domain Handling
- [x] target user and travel problem explained
- [x] necessity of voice interaction justified
- [x] normal demo flow operational
- [x] multi-modal travel search operational (trains, flights, hotels, buses)
- [x] non-travel queries routed to conversational replies without travel tools
- [x] travel follow-up context preserved and merged
- [x] location/entity normalization verified (Kolkata -> Delhi, never Howrah)

### Security & Secret Scanning
- [x] `.env` excluded via `.gitignore`
- [x] zero API keys or credentials in tracked source code
- [x] `.env.example` contains only placeholders

### Pre-Submission / Packaging Hygiene
- [x] frontend builds cleanly (`npm run build`)
- [x] backend imports cleanly
- [ ] manual microphone audibility check on live browser hardware
- [ ] final repository push to GitHub
- [ ] clean ZIP verification (ensure no `node_modules`, `.venv`, `.git`, or logs in ZIP)
