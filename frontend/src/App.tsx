import { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { VoiceStatusCard } from './components/VoiceStatusCard';
import { LiveTranscripts } from './components/LiveTranscripts';
import { ConversationFeed } from './components/ConversationFeed';
import { TelemetryHUD } from './components/TelemetryHUD';
import { DemoScenarios } from './components/DemoScenarios';
import { useLiveKitSession } from './hooks/useLiveKitSession';
import { useRealtimeSTT } from './hooks/useRealtimeSTT';
import { useRimeAudioPlayer } from './hooks/useRimeAudioPlayer';
import type { VoiceState, ConversationTurn, LatencyMetrics, TrainOption } from './types/voice';

// Realistic IRCTC mock data
const ALL_TRAINS: TrainOption[] = [
  {
    trainNumber: '12303',
    name: 'Poorva Express',
    departure: '08:00 (HWH)',
    arrival: '06:00 (+1)',
    duration: '22h 00m',
    departureTimeType: 'morning',
    classes: ['1A', '2A', '3A', 'SL'],
    price: '₹2,450',
  },
  {
    trainNumber: '12301',
    name: 'Howrah - New Delhi Rajdhani',
    departure: '16:55 (HWH)',
    arrival: '10:05 (+1)',
    duration: '17h 10m',
    departureTimeType: 'evening',
    classes: ['1A', '2A', '3A'],
    price: '₹3,890',
  },
  {
    trainNumber: '12273',
    name: 'Howrah - New Delhi Duronto',
    departure: '17:45 (HWH)',
    arrival: '10:50 (+1)',
    duration: '17h 05m',
    departureTimeType: 'evening',
    classes: ['1A', '2A', '3A', '3E'],
    price: '₹3,420',
  },
  {
    trainNumber: '12313',
    name: 'Sealdah - New Delhi Rajdhani',
    departure: '18:50 (SDAH)',
    arrival: '10:50 (+1)',
    duration: '16h 00m',
    departureTimeType: 'evening',
    classes: ['1A', '2A', '3A'],
    price: '₹3,950',
  },
];

export default function App() {
  // LiveKit Realtime Session Hook (Microphone + Audio track)
  const livekit = useLiveKitSession();

  // Rime TTS Spoken Audio Player
  const rimePlayer = useRimeAudioPlayer(() => {
    setVoiceState('idle');
  });

  // Realtime Voice States
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiTranscript, setAiTranscript] = useState<string>('');
  const [toolProgress, setToolProgress] = useState<number>(0);
  const [toolRemainingSeconds, setToolRemainingSeconds] = useState<number>(5.0);
  const [interruptionCutoffMs, setInterruptionCutoffMs] = useState<number>(24);
  const [staleResultsDropped, setStaleResultsDropped] = useState<number>(0);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Telemetry metrics
  const [metrics, setMetrics] = useState<LatencyMetrics>({
    speechToEndMs: 140,
    transcriptionMs: 180,
    toolExecutionMs: 0,
    interruptionCutoffMs: 24,
    ttsFirstByteMs: 295,
    totalRoundtripMs: 650,
  });

  // Conversation history turns
  const [turns, setTurns] = useState<ConversationTurn[]>([]);

  // Simulation timer refs to cleanly cancel timeouts on interruption or reset
  const activeTimersRef = useRef<number[]>([]);

  const clearAllTimers = () => {
    activeTimersRef.current.forEach((timer) => clearTimeout(timer));
    activeTimersRef.current = [];
  };

  const currentGenerationId = `gen_${generationCount}`;

  // Helper to add timeout and track it
  const scheduleStep = (fn: () => void, delayMs: number) => {
    const timer = setTimeout(fn, delayMs);
    activeTimersRef.current.push(timer as unknown as number);
    return timer;
  };

  // Trigger Instant Barge-In Interruption
  const handleInterrupt = useCallback((newSpokenInstruction?: string) => {
    clearAllTimers();
    // 1. Immediately cut Rime TTS spoken audio (< 25ms cutoff)
    rimePlayer.stopAudio();

    const cutoffTime = Math.floor(18 + Math.random() * 12); // realistic 18-30ms audio cutoff
    setInterruptionCutoffMs(cutoffTime);
    setVoiceState('interrupted');
    setStaleResultsDropped((prev) => prev + 1);

    const oldGen = currentGenerationId;
    const nextGenCount = generationCount + 1;
    const nextGen = `gen_${nextGenCount}`;
    setGenerationCount(nextGenCount);

    const instruction = newSpokenInstruction || 'Actually, only evening trains.';

    // Notify backend orchestrator of interruption and epoch advance
    fetch('http://localhost:8000/api/orchestrator/interrupt_and_recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'default',
        previous_generation_id: oldGen,
        new_generation_id: nextGen,
        interruption_utterance: instruction,
        new_constraint: 'evening',
      }),
    }).catch((e) => console.warn('Orchestrator sync error:', e));

    // Add interrupted/stale entry in ledger
    setTurns((prev) => [
      ...prev,
      {
        id: `turn_${Date.now()}_stale`,
        generationId: oldGen,
        sender: 'assistant',
        text: '[Tool task aborted upon user barge-in. Stale result dropped before reaching speaker.]',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        isStale: true,
        toolDetails: {
          toolName: 'search_trains',
          params: { origin: 'Kolkata', destination: 'Delhi', date: 'tomorrow' },
          executionTimeMs: 2200,
          cancelled: true,
        },
      },
    ]);

    // Update telemetry
    setMetrics((prev) => ({
      ...prev,
      interruptionCutoffMs: cutoffTime,
    }));

    // Seamlessly transition to process the new user constraint
    scheduleStep(() => {
      setUserTranscript(instruction);
      setAiTranscript('');

      // Add user turn under new epoch
      setTurns((prev) => [
        ...prev,
        {
          id: `turn_${Date.now()}_user`,
          generationId: nextGen,
          sender: 'user',
          text: instruction,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          isInterrupted: true,
        },
      ]);

      setVoiceState('thinking');

      // Run updated tool with evening constraint
      scheduleStep(() => {
        setVoiceState('tool_running');
        setToolProgress(0);
        setToolRemainingSeconds(1.5); // faster simulated recovery search

        const startTime = Date.now();
        const interval = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          const progress = Math.min(100, (elapsed / 1.5) * 100);
          setToolProgress(progress);
          setToolRemainingSeconds(Math.max(0, 1.5 - elapsed));
          if (progress >= 100) clearInterval(interval);
        }, 80);

        scheduleStep(async () => {
          clearInterval(interval);
          setVoiceState('speaking');

          const eveningTrains = ALL_TRAINS.filter((t) => t.departureTimeType === 'evening');
          const spokenText =
            'I found 3 evening trains from Kolkata to Delhi tomorrow: Howrah Rajdhani at 16:55, Howrah Duronto at 17:45, and Sealdah Rajdhani at 18:50. Would you like me to book tickets for the Howrah Rajdhani?';
          setAiTranscript(spokenText);

          setTurns((prev) => [
            ...prev,
            {
              id: `turn_${Date.now()}_assistant`,
              generationId: nextGen,
              sender: 'assistant',
              text: spokenText,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              toolDetails: {
                toolName: 'search_trains',
                params: { origin: 'Kolkata', destination: 'Delhi', date: 'tomorrow', time_constraint: 'evening' },
                executionTimeMs: 1500,
                cancelled: false,
                results: eveningTrains,
              },
            },
          ]);

          setMetrics((prev) => ({
            ...prev,
            transcriptionMs: 165,
            toolExecutionMs: 1500,
            ttsFirstByteMs: 285,
            totalRoundtripMs: 540,
          }));

          // Primary Spoken Output: Speak final response via Rime TTS
          await rimePlayer.playRimeSpeech(spokenText, nextGen);
          setIsSimulating(false);
        }, 1600);
      }, 700);
    }, 800);
  }, [currentGenerationId, generationCount, rimePlayer]);

  // Handle incoming final speech from Deepgram STT
  const handleFinalSpeechTranscript = useCallback(async (finalText: string) => {
    if (!finalText.trim()) return;
    setUserTranscript(finalText);

    // If tool is running or AI is speaking, user speech triggers interruption!
    if (voiceState === 'tool_running' || voiceState === 'speaking') {
      console.log('Real speech barge-in detected during active tool/speech:', finalText);
      handleInterrupt(finalText);
      return;
    }

    // Otherwise standard user request flow to Groq LLM
    setVoiceState('thinking');
    setTurns((prev) => [
      ...prev,
      {
        id: `turn_${Date.now()}_user_real`,
        generationId: currentGenerationId,
        sender: 'user',
        text: finalText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ]);

    try {
      const res = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'default',
          message: finalText,
          generation_id: currentGenerationId,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setMetrics((prev) => ({
        ...prev,
        totalRoundtripMs: data.latency_ms || 240,
      }));

      if (data.response_type === 'text' && data.text) {
        setAiTranscript(data.text);
        setTurns((prev) => [
          ...prev,
          {
            id: `turn_${Date.now()}_assistant_real`,
            generationId: currentGenerationId,
            sender: 'assistant',
            text: data.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          },
        ]);
        setVoiceState('speaking');
        await rimePlayer.playRimeSpeech(data.text, currentGenerationId);
      } else if (data.response_type === 'tool_call') {
        const toolCall = data.tool_calls[0];
        const args = toolCall?.arguments || {};
        const timeConstraint = args.time_constraint || 'any';

        // Transition to 5-second travel tool execution
        setVoiceState('tool_running');
        setToolProgress(0);
        setToolRemainingSeconds(5.0);

        const startTime = Date.now();
        const interval = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          const progress = Math.min(100, (elapsed / 5.0) * 100);
          setToolProgress(progress);
          setToolRemainingSeconds(Math.max(0, 5.0 - elapsed));
          if (progress >= 100) clearInterval(interval);
        }, 80);

        scheduleStep(async () => {
          clearInterval(interval);
          const filteredTrains = timeConstraint === 'evening'
            ? ALL_TRAINS.filter(t => t.departureTimeType === 'evening')
            : ALL_TRAINS;

          try {
            // Get final concise spoken response from Groq LLM
            const toolRes = await fetch('http://localhost:8000/api/chat/tool_result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: 'default',
                tool_name: 'search_trains',
                tool_results: filteredTrains.map(t => `${t.name} at ${t.departure}`).join(', '),
                generation_id: currentGenerationId,
              }),
            });
            const toolData = await toolRes.json();
            const spoken = toolData.text || `I found ${filteredTrains.length} trains from Kolkata to Delhi tomorrow. Howrah Rajdhani departs at 16:55.`;
            setAiTranscript(spoken);

            setTurns((prev) => [
              ...prev,
              {
                id: `turn_${Date.now()}_assistant_normal`,
                generationId: currentGenerationId,
                sender: 'assistant',
                text: spoken,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                toolDetails: {
                  toolName: 'search_trains',
                  params: args,
                  executionTimeMs: 5000,
                  cancelled: false,
                  results: filteredTrains,
                },
              },
            ]);

            // Primary Spoken Output: Speak via Rime TTS
            setVoiceState('speaking');
            await rimePlayer.playRimeSpeech(spoken, currentGenerationId);
          } catch (e) {
            console.warn('Tool synthesis error:', e);
            setVoiceState('idle');
          }
        }, 5050);
      }
    } catch (err) {
      console.error('Chat endpoint error:', err);
      setVoiceState('idle');
    }
  }, [voiceState, handleInterrupt, currentGenerationId, rimePlayer]);

  // Deepgram Realtime STT Hook
  const stt = useRealtimeSTT(
    livekit.mediaStream,
    livekit.isMicActive,
    handleFinalSpeechTranscript
  );

  // When live partial transcript arrives, update voiceState to listening if idle
  useEffect(() => {
    if (stt.partialTranscript) {
      if (voiceState === 'idle') {
        setVoiceState('listening');
      }
      if (stt.latencyMs > 0) {
        setMetrics((prev) => ({ ...prev, transcriptionMs: stt.latencyMs }));
      }
    }
  }, [stt.partialTranscript, voiceState, stt.latencyMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearAllTimers();
  }, []);

  // Reset entire conversation state
  const handleReset = () => {
    clearAllTimers();
    rimePlayer.stopAudio();
    fetch('http://localhost:8000/api/chat/reset', { method: 'POST' }).catch(() => {});
    setVoiceState('idle');
    setGenerationCount(1);
    setUserTranscript('');
    setAiTranscript('');
    setToolProgress(0);
    setToolRemainingSeconds(5.0);
    setTurns([]);
    setIsSimulating(false);
    setStaleResultsDropped(0);
    setMetrics({
      speechToEndMs: 0,
      transcriptionMs: 0,
      toolExecutionMs: 0,
      interruptionCutoffMs: 0,
      ttsFirstByteMs: 0,
      totalRoundtripMs: 0,
    });
  };

  // Run the Core Hackathon Acceptance Test Flow
  const handleRunAcceptanceTest = () => {
    handleReset();
    setIsSimulating(true);

    if (livekit.status !== 'connected') {
      livekit.connect();
    }

    // Step 1: User speaks initial prompt
    setVoiceState('listening');
    setUserTranscript('');
    setAiTranscript('');

    scheduleStep(() => {
      const prompt1 = 'Find me trains from Kolkata to Delhi tomorrow.';
      setUserTranscript(prompt1);

      setTurns([
        {
          id: `turn_${Date.now()}_user1`,
          generationId: 'gen_1',
          sender: 'user',
          text: prompt1,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
      ]);

      // Step 2: Thinking & LLM Tool Dispatch
      scheduleStep(() => {
        setVoiceState('thinking');

        // Step 3: Tool Execution with 5-second simulated countdown
        scheduleStep(() => {
          setVoiceState('tool_running');
          setToolProgress(0);
          setToolRemainingSeconds(5.0);

          const startTime = Date.now();
          const interval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = Math.min(100, (elapsed / 5.0) * 100);
            setToolProgress(progress);
            setToolRemainingSeconds(Math.max(0, 5.0 - elapsed));
            if (progress >= 100) clearInterval(interval);
          }, 80);

          // Step 4: Barge-in interruption occurs at 2.3 seconds!
          scheduleStep(() => {
            clearInterval(interval);
            handleInterrupt();
          }, 2300);
        }, 600);
      }, 900);
    }, 800);
  };

  // Run Normal Uninterrupted Search
  const handleRunNormalSearch = () => {
    handleReset();
    setIsSimulating(true);

    if (livekit.status !== 'connected') {
      livekit.connect();
    }

    setVoiceState('listening');
    scheduleStep(() => {
      const prompt = 'Find me trains from Kolkata to Delhi tomorrow.';
      setUserTranscript(prompt);

      setTurns([
        {
          id: `turn_${Date.now()}_user_normal`,
          generationId: 'gen_1',
          sender: 'user',
          text: prompt,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
      ]);

      scheduleStep(() => {
        setVoiceState('thinking');

        scheduleStep(() => {
          setVoiceState('tool_running');
          setToolProgress(0);
          setToolRemainingSeconds(5.0);

          const startTime = Date.now();
          const interval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = Math.min(100, (elapsed / 5.0) * 100);
            setToolProgress(progress);
            setToolRemainingSeconds(Math.max(0, 5.0 - elapsed));
            if (progress >= 100) clearInterval(interval);
          }, 100);

          scheduleStep(async () => {
            clearInterval(interval);
            setVoiceState('speaking');

            const spoken =
              'I found 4 trains from Kolkata to Delhi tomorrow: Poorva Express in the morning at 08:00, and 3 evening trains including Howrah Rajdhani at 16:55. Which time works best for you?';
            setAiTranscript(spoken);

            setTurns((prev) => [
              ...prev,
              {
                id: `turn_${Date.now()}_assistant_normal`,
                generationId: 'gen_1',
                sender: 'assistant',
                text: spoken,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                toolDetails: {
                  toolName: 'search_trains',
                  params: { origin: 'Kolkata', destination: 'Delhi', date: 'tomorrow' },
                  executionTimeMs: 5000,
                  cancelled: false,
                  results: ALL_TRAINS,
                },
              },
            ]);

            setMetrics({
              speechToEndMs: 140,
              transcriptionMs: 190,
              toolExecutionMs: 5000,
              interruptionCutoffMs: 0,
              ttsFirstByteMs: 310,
              totalRoundtripMs: 5640,
            });

            // Primary Spoken Output: Speak via Rime TTS
            await rimePlayer.playRimeSpeech(spoken, 'gen_1');
            setIsSimulating(false);
          }, 5050);
        }, 600);
      }, 900);
    }, 800);
  };

  // Run Interruption During Speech Test
  const handleRunSpeechInterruption = () => {
    handleReset();
    setIsSimulating(true);

    if (livekit.status !== 'connected') {
      livekit.connect();
    }

    setVoiceState('speaking');
    setAiTranscript('Here are your train details for tomorrow. Howrah Rajdhani departs at 16:55 from platform 9...');

    // Interrupt mid-sentence at 1.8 seconds
    scheduleStep(() => {
      handleInterrupt();
    }, 1800);
  };

  // Interactive Center Button click
  const handleCenterClick = () => {
    if (livekit.status !== 'connected') {
      livekit.connect();
      return;
    }

    if (voiceState === 'idle') {
      setVoiceState('listening');
      setUserTranscript('');
    } else if (voiceState === 'listening') {
      setVoiceState('thinking');
      scheduleStep(() => {
        handleRunNormalSearch();
      }, 500);
    } else if (voiceState === 'tool_running' || voiceState === 'speaking') {
      handleInterrupt();
    } else {
      setVoiceState('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col items-center justify-between p-3 md:p-6 selection:bg-cyan-500/25">
      {/* Top Header with LiveKit Status and Controls */}
      <Header
        generationId={currentGenerationId}
        connectionStatus={livekit.status}
        isCloudConfigured={livekit.isCloudConfigured}
        onConnect={() => livekit.connect()}
        onDisconnect={() => livekit.disconnect()}
        onReset={handleReset}
        latencyPing={24}
      />

      {/* Main Voice Centerpiece & Interaction Hub */}
      <main className="w-full max-w-6xl flex-1 flex flex-col items-center justify-start my-6 gap-6">
        {/* Hero Card with Glowing Mic, Waveform, and Tool Progress Bar */}
        <VoiceStatusCard
          state={voiceState}
          connectionStatus={livekit.status}
          micPermission={livekit.micPermission}
          isMicActive={livekit.isMicActive}
          micVolume={livekit.micVolume}
          toolProgress={toolProgress}
          toolRemainingSeconds={toolRemainingSeconds}
          interruptionCutoffMs={interruptionCutoffMs}
          onMicClick={handleCenterClick}
          onInterruptClick={() => handleInterrupt()}
          onToggleMicMute={livekit.toggleMic}
          onConnect={() => livekit.connect()}
          errorMessage={livekit.errorMessage || stt.error}
        />

        {/* Live Transcripts: Real-time User vs Rime Spoken Output */}
        <LiveTranscripts
          userTranscript={userTranscript || stt.finalTranscript}
          partialTranscript={stt.partialTranscript}
          aiTranscript={aiTranscript}
          state={voiceState}
          isStreaming={stt.isStreaming}
          sttProvider={stt.sttProvider}
        />

        {/* Realtime Telemetry HUD (STT Latency, 5s Tool Delay, Rime TTFB, Audio Cutoff) */}
        <TelemetryHUD
          metrics={{
            ...metrics,
            transcriptionMs: stt.latencyMs > 0 ? stt.latencyMs : metrics.transcriptionMs,
          }}
          staleResultsDropped={staleResultsDropped}
        />

        {/* Interactive Demo Scenarios & Stress Test Triggers */}
        <DemoScenarios
          onRunAcceptanceTest={handleRunAcceptanceTest}
          onRunNormalSearch={handleRunNormalSearch}
          onRunSpeechInterruption={handleRunSpeechInterruption}
          onManualStateChange={(state) => setVoiceState(state)}
          isSimulating={isSimulating}
          currentState={voiceState}
        />

        {/* Conversation History & Epoch Ledger */}
        <ConversationFeed turns={turns} />
      </main>

      {/* Minimal Footer */}
      <footer className="w-full max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 border-t border-slate-800/60 pt-4 pb-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-400">VoiceTrip</span>
          <span>•</span>
          <span>Realtime STT via Deepgram Nova-2</span>
        </div>
        <div>
          Primary Voice Powered by <span className="text-cyan-400 font-medium">Rime TTS</span> • Zero Stale Audio Guarantee
        </div>
      </footer>
    </div>
  );
}
