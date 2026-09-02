# Rime Voice Hackathon Evidence & Verification Log

## 1. The Hard Voice Problem
In multi-turn voice-native interactions with tool calling, latency is unavoidable when querying external systems (APIs, databases, search tools). The hardest voice engineering challenge is managing **user barge-in during long-running tool calls**:
- The user changes their mind or refines their intent while the system is processing.
- Outdated tools must be cancelled or discarded immediately.
- Audio buffers must be cleared to prevent stale speech overlap.
- New constraints must be synthesized smoothly without conversational amnesia.

## 2. The Acceptance Test

### Test Scenario
1. **Initial Instruction**:
   > *"Find me trains from Kolkata to Delhi tomorrow."*
2. **Artificial Delay**:
   > System triggers simulated IRCTC train search with an intentional `5.0-second` delay.
3. **Barge-In Interruption**:
   > User interrupts at ~2.5s: *"Actually, only evening trains."*
4. **Validation Points**:
   - Audio buffer cutoff latency (< 50ms)
   - Tool cancellation signal dispatched immediately
   - Generation ID incremented (`gen_1` -> `gen_2`)
   - Any result from `gen_1` is trapped by the Stale Result Protection barrier and dropped
   - Assistant executes new search with `time_constraint="evening"`
   - Assistant speaks the evening train option using **Rime TTS** (e.g. Rajdhani Express at 16:55).

## 3. Telemetry & Metrics Template
| Metric | Expected Target | Measured Result |
|---|---|---|
| Interruption to Audio Cutoff | < 80 ms | Pending Phase 4 Test |
| Generation Invalidation Latency | < 5 ms | Pending Phase 4 Test |
| Stale Result Leakage Rate | 0.0% (Zero Tolerated) | Pending Phase 4 Test |
| Rime TTS TTFB (Time to First Byte) | < 350 ms | Pending Phase 4 Test |
| Recovery Response Time | < 1200 ms | Pending Phase 4 Test |

---
*Detailed execution logs and audio recordings will be captured and documented in Phase 4.*
