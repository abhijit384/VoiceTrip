import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Square,
  Play,
  RotateCcw,
  Volume2,
  User,
  Bot,
  Terminal,
  Compass,
  Loader2,
  Clock,
  Layers,
  Radio,
  Lightbulb,
  AlertCircle,
  MessageSquarePlus,
} from 'lucide-react';
import { useAuthoritativeRecorder } from './hooks/useAuthoritativeRecorder';
import { useRimeAudioPlayer } from './hooks/useRimeAudioPlayer';
import { unlockAudioContext } from './utils/audioContext';
import { getApiBase } from './config';
import type { ConversationTurn } from './types/voice';
import { TravelResultCards } from './components/TravelResultCards';
import { DemoWelcomeModal } from './components/DemoWelcomeModal';

export type PipelineState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'searching'
  | 'synthesizing'
  | 'speaking';

interface DevAuditState {
  sessionId: string;
  turnId: number;
  generationId: string;
  previousContext: any;
  userTranscript: string;
  requestType: 'NEW' | 'FOLLOW_UP' | string;
  mergedContext: any;
  toolSelected: string;
  toolArguments: any;
  toolResults: any;
  finalResponse: string;
}

export default function App() {
  const [userName, setUserName] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('voicetrip_user_name') || 'Sudipta';
    }
    return 'Sudipta';
  });
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return !localStorage.getItem('voicetrip_demo_started');
    }
    return false;
  });

  const [pipelineState, setPipelineState] = useState<PipelineState>('idle');
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiTranscript, setAiTranscript] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [showDevMode, setShowDevMode] = useState<boolean>(false);
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  const [lastToolResults, setLastToolResults] = useState<any | null>(null);
  const [canonicalContext, setCanonicalContext] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Developer Mode Status & Structured Audit Telemetry
  const [sttStatus, setSttStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [geminiStatus, setGeminiStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [toolStatus, setToolStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [devAudit, setDevAudit] = useState<DevAuditState>({
    sessionId: 'default',
    turnId: 1,
    generationId: 'gen_1',
    previousContext: null,
    userTranscript: '',
    requestType: 'NEW',
    mergedContext: null,
    toolSelected: 'None',
    toolArguments: null,
    toolResults: null,
    finalResponse: '',
  });

  const currentGenerationId = `gen_${generationCount}`;
  const activeGenerationRef = useRef<string>(currentGenerationId);
  activeGenerationRef.current = currentGenerationId;

  // Authoritative Microphone Recorder Hook reference for interruption
  const recorderRef = useRef<ReturnType<typeof useAuthoritativeRecorder> | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Rime TTS Audio Player Hook
  const rimePlayer = useRimeAudioPlayer(() => {
    console.log('[RIME] Audio playback finished.');
    setPipelineState('idle');
    setStatusMessage('Ready');
    if (recorderRef.current) {
      recorderRef.current.stopInterruptionMonitoring();
    }
  });

  // Barge-in Speech Interruption Handler: Triggered when genuine user speech (>600ms) occurs during AI speech
  const handleBargeInInterruption = useCallback(() => {
    if (rimePlayer.isPlaying || pipelineState === 'speaking') {
      console.log('[BARGE_IN] USER_SPEECH_DETECTED during AI speech. Halting Rime playback immediately...');
      rimePlayer.stopAudio('user_speech_interruption');

      const nextCount = generationCount + 1;
      const nextGen = `gen_${nextCount}`;
      setGenerationCount(nextCount);
      activeGenerationRef.current = nextGen;

      // CRITICAL: Set to 'idle', NOT 'recording' — mic activation must be fully manual
      setPipelineState('idle');
      setStatusMessage('AI interrupted — tap Start Mic to speak');
    }
  }, [rimePlayer, pipelineState, generationCount]);

  // Authoritative Microphone Recorder Hook
  const recorder = useAuthoritativeRecorder(handleBargeInInterruption);
  recorderRef.current = recorder;

  useEffect(() => {
    document.title = 'VoiceTrip | Your AI Voice Travel Assistant';
  }, []);

  // Auto-scroll chat history when new messages arrive
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [turns]);

  const handleDemoSignup = (name: string, email: string) => {
    setUserName(name);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('voicetrip_user_name', name);
      localStorage.setItem('voicetrip_user_email', email);
      localStorage.setItem('voicetrip_demo_started', 'true');
    }
    setShowWelcomeModal(false);
  };

  // Process finalized user speech through Gemini -> Tool -> Rime TTS (Sequential Pipeline)
  const processTurn = useCallback(
    async (finalText: string, targetGen: string) => {
      const cleanText = finalText.trim();
      if (!cleanText) {
        setPipelineState('idle');
        setStatusMessage('Ready');
        return;
      }

      setErrorMessage(null);
      setUserTranscript(cleanText);
      setPipelineState('thinking');
      setStatusMessage('Thinking...');
      setGeminiStatus('PENDING');

      // Record User message in history
      setTurns((prev) => [
        ...prev,
        {
          id: `turn_${Date.now()}_user_${targetGen}`,
          generationId: targetGen,
          sender: 'user',
          text: cleanText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      try {
        console.log(`[LLM] Calling Gemini 3.6 Flash with prompt: "${cleanText}" (gen: ${targetGen})`);
        const res = await fetch(`${getApiBase()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: 'default',
            message: cleanText,
            generation_id: targetGen,
          }),
        });

        if (!res.ok) {
          setGeminiStatus('FAILED');
          throw new Error(`Chat API HTTP ${res.status}`);
        }
        setGeminiStatus('SUCCESS');
        const data = await res.json();

        // Stale generation barrier check
        if (activeGenerationRef.current !== targetGen) {
          console.warn(`[BARRIER] Stale LLM response dropped for superseded gen ${targetGen}`);
          return;
        }

        const ctx = data.canonical_context;
        if (ctx) {
          setCanonicalContext(ctx);
        }

        // Case A: Direct Text Response
        if (data.response_type === 'text' && data.text) {
          const spoken = data.text;
          setAiTranscript(spoken);
          setLastToolName(null);
          setLastToolResults(null);
          setToolStatus('IDLE');

          setDevAudit({
            sessionId: data.session_id || 'default',
            turnId: generationCount,
            generationId: targetGen,
            previousContext: ctx?.previous_summary || null,
            userTranscript: cleanText,
            requestType: ctx?.request_type || 'NEW',
            mergedContext: ctx,
            toolSelected: 'None (Conversational/Direct Text)',
            toolArguments: null,
            toolResults: null,
            finalResponse: spoken,
          });

          setTurns((prev) => [
            ...prev,
            {
              id: `turn_${Date.now()}_assistant_${targetGen}`,
              generationId: targetGen,
              sender: 'assistant',
              text: spoken,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);

          setPipelineState('synthesizing');
          setStatusMessage('Preparing voice...');

          setPipelineState('speaking');
          setStatusMessage('AI Speaking...');

          await rimePlayer.playRimeSpeech(spoken, targetGen);

          // Engage background audio monitoring for genuine speech barge-in
          // (starts AFTER playback begins, with internal 800ms delay to prevent echo)
          recorder.startInterruptionMonitoring();
          return;
        }

        // Case B: Tool Call Required (Trains, Flights, Hotels, Routes, Destination Info)
        if (data.response_type === 'tool_call' && data.tool_calls?.length > 0) {
          const toolCall = data.tool_calls[0];
          const toolName = toolCall?.name || 'search_trains';
          const args = toolCall?.arguments || {};

          setPipelineState('searching');
          setToolStatus('PENDING');
          setStatusMessage(
            toolName === 'search_flights'
              ? 'Searching flights...'
              : toolName === 'search_hotels'
              ? 'Searching hotels...'
              : toolName === 'search_trains'
              ? 'Searching trains...'
              : 'Searching travel options...'
          );

          let endpoint = `${getApiBase()}/api/tools/search_trains`;
          if (toolName === 'search_flights') endpoint = `${getApiBase()}/api/tools/search_flights`;
          else if (toolName === 'search_hotels') endpoint = `${getApiBase()}/api/tools/search_hotels`;
          else if (toolName === 'get_route_options') endpoint = `${getApiBase()}/api/tools/get_route_options`;
          else if (toolName === 'get_destination_info') endpoint = `${getApiBase()}/api/tools/get_destination_info`;

          const toolRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...args,
              generation_id: targetGen,
              session_id: 'default',
            }),
          });

          if (!toolRes.ok) {
            setToolStatus('FAILED');
            throw new Error(`Tool HTTP ${toolRes.status}`);
          }
          setToolStatus('SUCCESS');
          const toolData = await toolRes.json();

          if (activeGenerationRef.current !== targetGen) return;

          setLastToolName(toolName);
          setLastToolResults(toolData);

          setPipelineState('synthesizing');
          setStatusMessage('Preparing voice...');

          const summaryRes = await fetch(`${getApiBase()}/api/chat/tool_result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: 'default',
              tool_name: toolName,
              tool_results: toolData,
              generation_id: targetGen,
            }),
          });

          const summaryData = await summaryRes.json();
          if (activeGenerationRef.current !== targetGen) return;

          const spokenText = summaryData.text || 'Here are the travel options found for your journey.';
          setAiTranscript(spokenText);

          setDevAudit({
            sessionId: data.session_id || 'default',
            turnId: generationCount,
            generationId: targetGen,
            previousContext: ctx?.previous_summary || null,
            userTranscript: cleanText,
            requestType: ctx?.request_type || 'NEW',
            mergedContext: ctx,
            toolSelected: toolName,
            toolArguments: args,
            toolResults: toolData,
            finalResponse: spokenText,
          });

          setTurns((prev) => [
            ...prev,
            {
              id: `turn_${Date.now()}_assistant_tool_${targetGen}`,
              generationId: targetGen,
              sender: 'assistant',
              text: spokenText,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              toolDetails: {
                toolName,
                params: args,
                executionTimeMs: 120,
                cancelled: false,
                results: toolData.trains || toolData.flights || toolData.hotels || [],
                rawResult: toolData,
              },
            },
          ]);

          setPipelineState('speaking');
          setStatusMessage('AI Speaking...');

          await rimePlayer.playRimeSpeech(spokenText, targetGen);

          // Engage background audio monitoring for genuine speech barge-in
          // (starts AFTER playback begins, with internal 800ms delay to prevent echo)
          recorder.startInterruptionMonitoring();
          return;
        }

        setPipelineState('idle');
        setStatusMessage('Ready');
      } catch (err: unknown) {
        console.error('[PROCESS_TURN] Pipeline error:', err);
        setErrorMessage('Something went wrong while finding your travel options. Please try again.');
        setPipelineState('idle');
        setStatusMessage('Ready');
      }
    },
    [recorder, rimePlayer, generationCount]
  );

  // Manual Microphone Button Click Handler: Strict Start / Stop & Send
  const handleToggleMic = async () => {
    await unlockAudioContext().catch(() => {});
    setErrorMessage(null);

    // If currently recording: User clicks STOP & SEND
    if (recorder.isRecording || pipelineState === 'recording') {
      console.log('[MIC] User clicked Stop & Send. Finalizing audio recording...');
      rimePlayer.stopAudio('stop_mic_clicked');
      setPipelineState('transcribing');
      setStatusMessage('Transcribing...');
      setSttStatus('PENDING');

      try {
        const result = await recorder.stopRecordingAndTranscribe();
        console.log(`[MIC] STT Result received: "${result.text}" (raw: "${result.rawText}")`);

        if (!result.text || result.text.trim().length === 0) {
          console.log('[MIC] No speech detected in recorded audio.');
          setUserTranscript('(No speech detected. Please speak while microphone is recording.)');
          setSttStatus('FAILED');
          setPipelineState('idle');
          setStatusMessage('Ready');
          return;
        }

        setSttStatus('SUCCESS');
        setUserTranscript(result.text);

        const nextCount = generationCount + 1;
        const nextGen = `gen_${nextCount}`;
        setGenerationCount(nextCount);
        activeGenerationRef.current = nextGen;

        // Run sequential pipeline: Gemini -> Tool -> Rime
        await processTurn(result.text, nextGen);
      } catch (err: unknown) {
        const e = err as Error;
        console.error('[MIC] Stop/Transcribe error:', e);
        setSttStatus('FAILED');
        setErrorMessage(`Transcription notice: ${e.message}`);
        setPipelineState('idle');
        setStatusMessage('Ready');
      }
      return;
    }

    // Otherwise: User clicks START MIC
    console.log('[MIC] User clicked Start Mic. Starting authoritative recording...');
    rimePlayer.stopAudio('start_recording');
    setUserTranscript('');
    setPipelineState('recording');
    setStatusMessage('Recording...');
    setSttStatus('IDLE');
    setGeminiStatus('IDLE');
    setToolStatus('IDLE');

    try {
      await recorder.startRecording();
    } catch (startErr: unknown) {
      const e = startErr as Error;
      console.error('[MIC] Failed to start microphone capture:', e);
      setErrorMessage(`Microphone error: ${e.message}`);
      setPipelineState('idle');
      setStatusMessage('Ready');
    }
  };

  // Manual Interrupt AI Button Click Handler
  const handleInterruptAI = () => {
    console.log('[INTERRUPT_AI] User clicked Interrupt AI button');
    rimePlayer.stopAudio('user_interrupt_button');
    recorder.stopInterruptionMonitoring();
    const nextCount = generationCount + 1;
    const nextGen = `gen_${nextCount}`;
    setGenerationCount(nextCount);
    activeGenerationRef.current = nextGen;
    rimePlayer.setActiveGeneration(nextGen);
    setPipelineState('idle');
    setStatusMessage('AI interrupted');
  };

  // Test Rime Voice with proper pipeline state tracking
  const handleTestRime = async () => {
    setErrorMessage(null);
    setPipelineState('speaking');
    setStatusMessage('Testing Rime voice...');
    await rimePlayer.testRimeVoice();
  };

  // Reset entire conversation
  const handleReset = () => {
    rimePlayer.stopAudio('reset');
    recorder.cancelRecording();
    fetch(`${getApiBase()}/api/chat/reset`, { method: 'POST' }).catch(() => {});
    setPipelineState('idle');
    setStatusMessage('Ready');
    setGenerationCount(1);
    activeGenerationRef.current = 'gen_1';
    setUserTranscript('');
    setAiTranscript('');
    setLastToolName(null);
    setLastToolResults(null);
    setCanonicalContext(null);
    setTurns([]);
    setErrorMessage(null);
    setSttStatus('IDLE');
    setGeminiStatus('IDLE');
    setToolStatus('IDLE');
    setDevAudit({
      sessionId: 'default',
      turnId: 1,
      generationId: 'gen_1',
      previousContext: null,
      userTranscript: '',
      requestType: 'NEW',
      mergedContext: null,
      toolSelected: 'None',
      toolArguments: null,
      toolResults: null,
      finalResponse: '',
    });
  };

  const handleSuggestionClick = async (suggestion: string) => {
    if (isBusy || recorder.isRecording) return;
    const nextCount = generationCount + 1;
    const nextGen = `gen_${nextCount}`;
    setGenerationCount(nextCount);
    activeGenerationRef.current = nextGen;
    await processTurn(suggestion, nextGen);
  };

  const isBusy = pipelineState !== 'idle' && pipelineState !== 'recording';
  const isAiSpeakingOrGenerating =
    rimePlayer.isPlaying ||
    rimePlayer.telemetry.rimeRequest === 'STARTED' ||
    pipelineState === 'speaking' ||
    pipelineState === 'synthesizing' ||
    pipelineState === 'searching' ||
    pipelineState === 'thinking';

  // Live progressive speech display during recording (Requirement 7 & 8)
  const displaySpeechText = recorder.isRecording
    ? (recorder.interimTranscript || userTranscript || '')
    : userTranscript;

  return (
    <div className="min-h-screen bg-[#060a12] text-slate-100 flex flex-col items-center justify-between p-4 md:p-8 font-sans selection:bg-cyan-500/30 relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-cyan-500/[0.04] blur-[120px] animate-ambient-drift" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[500px] h-[500px] rounded-full bg-purple-500/[0.04] blur-[120px] animate-ambient-drift-reverse" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-teal-500/[0.03] blur-[100px]" />
      </div>
      {/* DEMO WELCOME / SIGNUP MODAL */}
      {showWelcomeModal && (
        <DemoWelcomeModal
          initialName={userName}
          onContinue={handleDemoSignup}
        />
      )}

      {/* Top Header */}
      <header className="relative z-10 w-full max-w-4xl flex items-center justify-between border-b border-slate-800/60 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-teal-400 p-0.5 shadow-md shadow-cyan-500/20">
            <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center text-cyan-400">
              <Compass className="w-5 h-5" />
            </div>
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              VoiceTrip
            </h1>
            <p className="text-xs text-slate-400">
              Your AI Voice Travel Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Demo User Pill */}
          <button
            onClick={() => setShowWelcomeModal(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 transition"
            title="Switch demo profile"
          >
            <User className="w-3.5 h-3.5 text-cyan-400" />
            <span>{userName}</span>
          </button>

          {/* Developer Mode Toggle */}
          <button
            onClick={() => setShowDevMode(!showDevMode)}
            id="dev-mode-toggle"
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 ${
              showDevMode
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 shadow-sm shadow-cyan-950/50'
                : 'bg-slate-900/90 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Developer Mode</span>
          </button>

          {/* Reset Conversation */}
          <button
            onClick={handleReset}
            id="reset-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition"
            title="Start a new conversation"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span className="hidden sm:inline text-xs font-medium">New Chat</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 w-full max-w-4xl flex-1 flex flex-col gap-6">
        {/* Welcome Greeting Banner (Requirement 2) */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950/90 border border-slate-800 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
              <span>Hi, {userName} 👋</span>
              <span className="text-slate-400 font-normal text-sm">Where would you like to go?</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tap the microphone and speak naturally to explore trains, flights, hotels, and custom itineraries.
            </p>
          </div>

          {/* Speech State Indicator Pill (Requirement 9) */}
          <div className="flex items-center gap-2 self-start sm:self-center px-3 py-1.5 rounded-full bg-slate-950/80 border border-slate-800 text-xs shadow-inner">
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                recorder.isRecording
                  ? 'bg-red-500 animate-ping'
                  : pipelineState === 'speaking'
                  ? 'bg-purple-400 animate-pulse'
                  : isBusy
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
              }`}
            />
            <span className="font-medium text-slate-200" id="pipeline-status-text">
              {recorder.isRecording
                ? 'Recording'
                : pipelineState === 'speaking'
                ? 'AI Speaking'
                : isBusy
                ? statusMessage
                : 'Ready'}
            </span>
          </div>
        </div>

        {/* SECTION 1: CENTRAL MICROPHONE EXPERIENCE (Requirements 4, 5, 6, 10) */}
        <div className="relative p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/95 border border-slate-700/40 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8),0_0_80px_-30px_rgba(6,182,212,0.15)] backdrop-blur-2xl flex flex-col items-center justify-center gap-6 overflow-hidden">
          {/* Subtle Ambient Glow */}
          <div
            className={`absolute w-80 h-80 rounded-full blur-[100px] pointer-events-none transition-all duration-700 ${
              recorder.isRecording
                ? 'bg-red-500/20 scale-125'
                : pipelineState === 'speaking'
                ? 'bg-purple-500/20 scale-110'
                : isBusy
                ? 'bg-amber-500/15 scale-105'
                : 'bg-cyan-500/10'
            }`}
          />

          {/* Helper Message Banner (Requirement 6) */}
          <div
            className={`transition-all duration-300 flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium ${
              recorder.isRecording
                ? 'opacity-100 translate-y-0 bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'opacity-0 -translate-y-2 pointer-events-none h-0 p-0 overflow-hidden border-0'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span>💡 Click Stop to send message</span>
          </div>

          {/* Central Microphone Button & Controls Row */}
          <div className="relative flex flex-col items-center gap-5">
            {/* Animated Orb Ring around Mic Button */}
            <div className={`absolute w-52 h-52 sm:w-56 sm:h-56 rounded-full transition-all duration-500 ${
              recorder.isRecording
                ? 'orb-ring-recording'
                : pipelineState === 'speaking'
                ? 'orb-ring-speaking'
                : isBusy
                ? 'orb-ring-busy'
                : 'orb-ring-idle'
            }`} />
            <button
              onClick={handleToggleMic}
              disabled={isBusy}
              id="mic-main-btn"
              className={`relative z-10 w-44 h-44 sm:w-48 sm:h-48 rounded-full font-bold text-base flex flex-col items-center justify-center gap-2 shadow-2xl transition-all duration-300 transform active:scale-95 group ${
                recorder.isRecording
                  ? 'bg-gradient-to-b from-red-500 to-rose-600 text-white animate-recording-pulse border-4 border-red-300/40 shadow-[0_0_50px_-5px_rgba(239,68,68,0.5)]'
                  : isBusy
                  ? 'bg-slate-800/90 text-slate-400 cursor-not-allowed border-2 border-slate-700'
                  : 'bg-gradient-to-tr from-cyan-500 via-teal-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 shadow-[0_0_60px_-10px_rgba(6,182,212,0.4)] hover:shadow-[0_0_80px_-10px_rgba(6,182,212,0.6)] border-4 border-cyan-400/30'
              }`}
            >
              {recorder.isRecording ? (
                <>
                  <div className="p-3.5 rounded-full bg-red-700/80 shadow-inner">
                    <Square className="w-8 h-8 fill-current text-white" />
                  </div>
                  <span className="text-sm font-extrabold tracking-wider uppercase">
                    STOP &amp; SEND
                  </span>
                  <span className="text-[11px] font-medium text-red-100 opacity-90">
                    Click to send message
                  </span>
                </>
              ) : isBusy ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                  <span className="text-sm font-bold tracking-wider uppercase text-slate-200">
                    {statusMessage}
                  </span>
                  <span className="text-[10px] text-slate-400">Processing request...</span>
                </>
              ) : (
                <>
                  <div className="p-3.5 rounded-full bg-slate-950/30 group-hover:scale-110 transition duration-300">
                    <Mic className="w-8 h-8 text-slate-950" />
                  </div>
                  <span className="text-base font-extrabold tracking-wider uppercase text-slate-950">
                    START MIC
                  </span>
                  <span className="text-[11px] font-medium text-slate-900 opacity-80">
                    Tap to start speaking
                  </span>
                </>
              )}
            </button>

            {/* Action Buttons Row: Interrupt AI + Test Rime Voice beside Mic Controls */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              {/* Interrupt AI Button - Moved to Microphone Control Area */}
              <button
                onClick={handleInterruptAI}
                disabled={!isAiSpeakingOrGenerating}
                id="interrupt-ai-btn"
                className={`px-4 py-2.5 rounded-xl text-xs font-bold border flex items-center gap-2 transition duration-200 shadow-sm ${
                  isAiSpeakingOrGenerating
                    ? 'bg-red-600 hover:bg-red-500 text-white border-red-400 shadow-lg shadow-red-950/60 animate-pulse ring-2 ring-red-400/30 cursor-pointer'
                    : 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                }`}
                title={isAiSpeakingOrGenerating ? 'Interrupt AI immediately' : 'AI is not speaking'}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Interrupt AI</span>
              </button>

              {/* Test Rime Button Shortcut */}
              <button
                onClick={handleTestRime}
                disabled={recorder.isRecording || isBusy}
                id="test-rime-btn"
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-purple-950/40 hover:bg-purple-900/50 text-purple-300 border border-purple-800/40 transition flex items-center gap-2 shadow-sm"
                title="Test Rime TTS Voice directly"
              >
                <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                <span>TEST RIME VOICE</span>
              </button>
            </div>
          </div>

          {/* Under-Microphone Device Info & Live Meter (Requirement 5) */}
          <div className="w-full max-w-xl flex flex-col gap-3 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
              <span className="text-slate-400 flex items-center gap-1.5">
                Using microphone:{' '}
                <strong className="text-slate-200 truncate max-w-[240px]" id="using-mic-label">
                  {recorder.activeDeviceLabel}
                </strong>
              </span>
              <span
                id="recording-status-badge"
                className={`font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded text-[10px] self-start sm:self-auto ${
                  recorder.isRecording
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                Recording: {recorder.isRecording ? 'ON' : 'OFF'}
              </span>
            </div>

            {/* Real Hardware Microphone Volume Meter */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-500 w-16">Mic Level:</span>
              <div className="flex-1 h-2.5 rounded-full bg-slate-950 overflow-hidden p-0.5 border border-slate-800/80">
                <div
                  id="mic-volume-bar"
                  className={`h-full rounded-full transition-all duration-75 ${
                    recorder.micVolume > 50
                      ? 'bg-gradient-to-r from-teal-400 via-amber-400 to-red-500'
                      : recorder.micVolume > 15
                      ? 'bg-gradient-to-r from-cyan-400 to-emerald-400'
                      : 'bg-emerald-500/70'
                  }`}
                  style={{ width: `${recorder.micVolume}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-slate-400 w-10 text-right" id="mic-volume-value">
                {recorder.micVolume}%
              </span>
            </div>

            {/* Microphone Device Dropdown Switcher */}
            <div className="flex items-center gap-2">
              <select
                id="mic-device-select"
                value={recorder.selectedDeviceId}
                onChange={(e) => recorder.selectDevice(e.target.value)}
                disabled={recorder.isRecording}
                className="w-full text-xs bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 focus:outline-none focus:border-cyan-500 transition"
              >
                {recorder.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Error Notice if any (Requirement 25) */}
        {errorMessage && (
          <div className="p-4 rounded-2xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-center justify-between gap-3 animate-slide-up">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="px-2.5 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 text-xs text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* SECTION 2: LIVE TRANSCRIPTION & AI RESPONSE CARDS (Requirements 7, 8, 12, 13) */}
        <div className="grid grid-cols-1 gap-5">
          {/* User Speech & Live Transcription Card */}
          <div className="p-5 rounded-2xl glass-card shadow-xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                {recorder.isRecording ? 'Live Transcription' : 'Your Speech'}
              </span>

              {recorder.isRecording ? (
                <span className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-500/40 animate-pulse" id="live-transcription-badge">
                  <Radio className="w-3 h-3 text-red-400" />
                  🔴 LIVE
                </span>
              ) : userTranscript ? (
                <span className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700" id="final-transcription-badge">
                  FINAL
                </span>
              ) : null}
            </div>

            <p className="text-sm text-slate-100 leading-relaxed min-h-[30px]" id="user-speech-text">
              {recorder.isRecording ? (
                recorder.interimTranscript ? (
                  <span className="text-cyan-200 font-medium inline-flex items-center flex-wrap gap-1" id="live-transcript-text">
                    <span className="live-word">{recorder.interimTranscript}</span>
                    <span className="live-cursor" />
                  </span>
                ) : (
                  <span className="text-slate-500 italic inline-flex items-center gap-1">
                    <span>Listening... speak your travel request</span>
                    <span className="live-cursor" />
                  </span>
                )
              ) : userTranscript ? (
                <span className="text-slate-100" id="final-transcript-text">
                  {userTranscript}
                </span>
              ) : (
                <span className="text-slate-500 italic">
                  Tap <strong className="text-slate-400 font-medium">Start Mic</strong>, speak your travel plan, then click <strong className="text-slate-400 font-medium">Stop &amp; Send</strong>.
                </span>
              )}
            </p>

            {/* Quick Suggestion Chips on Empty State (Requirement 24) */}
            {!displaySpeechText && turns.length === 0 && (
              <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500 font-medium">Try asking:</span>
                {[
                  'Find hotels near Goa',
                  'Trains from NJP to Howrah tomorrow evening',
                  'Flights from Delhi to Mumbai tomorrow',
                  'Best places to visit in Kerala',
                ].map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSuggestionClick(s)}
                    disabled={isBusy || recorder.isRecording}
                    className="px-3 py-1 rounded-lg text-xs bg-slate-950/80 hover:bg-slate-800 text-slate-300 border border-slate-800/80 hover:border-cyan-500/40 transition flex items-center gap-1"
                  >
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Response Card & Rime Voice Controls (Requirements 12 & 13) */}
          <div className="p-5 sm:p-6 rounded-2xl glass-card border-purple-900/30 shadow-xl flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-400 flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                AI Response
              </span>

              {/* Rime Voice Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 mr-1">
                  <span className="text-[11px] text-purple-300 font-medium flex items-center gap-1">
                    <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                    AI Voice:
                  </span>

                  {/* Equalizer bars active ONLY during Rime playback */}
                  {rimePlayer.isPlaying && (
                    <div className="flex items-center gap-0.5 h-4 px-1">
                      <span className="voice-bar" />
                      <span className="voice-bar" />
                      <span className="voice-bar" />
                      <span className="voice-bar" />
                      <span className="voice-bar" />
                    </div>
                  )}

                  <span
                    id="ai-voice-status-indicator"
                    className={`px-2.5 py-0.5 rounded-lg text-[10px] font-medium tracking-wide ${
                      rimePlayer.isPlaying
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse'
                        : rimePlayer.autoplayBlocked
                        ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                        : rimePlayer.hasAudio
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-950 text-slate-500 border border-slate-800'
                    }`}
                  >
                    {rimePlayer.isPlaying
                      ? '🔊 AI is speaking...'
                      : rimePlayer.autoplayBlocked
                      ? '⚠️ Click Play Voice'
                      : rimePlayer.hasAudio
                      ? '🔊 Voice Ready'
                      : '🔇 Standby'}
                  </span>
                </div>

                {/* Play Voice Button */}
                <button
                  onClick={rimePlayer.playCachedAudio}
                  disabled={!aiTranscript && !rimePlayer.hasAudio}
                  id="play-voice-btn"
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition ${
                    rimePlayer.isPlaying
                      ? 'bg-purple-950/40 text-purple-400 border-purple-800/40'
                      : !aiTranscript && !rimePlayer.hasAudio
                      ? 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed'
                      : 'bg-purple-900/40 hover:bg-purple-800/50 text-purple-200 border-purple-700/60 shadow-sm'
                  }`}
                  title="Play generated Rime audio"
                >
                  <Play className="w-3.5 h-3.5 fill-current text-purple-400" />
                  <span>{rimePlayer.isPlaying ? 'Playing...' : 'Play Voice'}</span>
                </button>

                {/* Stop Voice Button */}
                <button
                  onClick={() => rimePlayer.stopAudio('user_click')}
                  disabled={!rimePlayer.isPlaying}
                  id="stop-voice-btn"
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1 transition ${
                    rimePlayer.isPlaying
                      ? 'bg-red-950/50 text-red-300 border-red-800/60 hover:bg-red-900/60'
                      : 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed'
                  }`}
                  title="Stop audio playback"
                >
                  <Square className="w-3 h-3 fill-current text-red-400" />
                  <span>Stop Voice</span>
                </button>
              </div>
            </div>

            {/* AI Response Text */}
            <p className="text-sm text-slate-100 leading-relaxed min-h-[36px]" id="ai-response-text">
              {aiTranscript || (
                <span className="text-slate-500 italic">
                  AI travel recommendations and Rime voice will appear here.
                </span>
              )}
            </p>

            {/* SECTION 3: TRAVEL RESULTS CARDS (Requirements 14, 15, 16) */}
            {lastToolResults && (
              <TravelResultCards
                toolName={lastToolName}
                toolResults={lastToolResults}
                canonicalContext={canonicalContext}
              />
            )}
          </div>
        </div>

        {/* SECTION 4: CONVERSATION HISTORY (Requirement 17) */}
        {turns.length > 0 && (
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-col gap-3.5 shadow-lg">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Chat History
            </h3>
            <div ref={chatScrollRef} className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
              {turns.map((t) => (
                <div
                  key={t.id}
                  className={`p-4 rounded-2xl text-xs flex flex-col gap-1.5 shadow-sm transition ${
                    t.sender === 'user'
                      ? 'bg-cyan-950/30 border border-cyan-800/40 text-cyan-100 self-end max-w-[85%]'
                      : 'bg-slate-950/80 border border-purple-900/30 text-slate-200 self-start max-w-[85%]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 gap-4">
                    <span className="font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                      {t.sender === 'user' ? (
                        <>
                          <User className="w-3 h-3 text-cyan-400" />
                          <span>You</span>
                        </>
                      ) : (
                        <>
                          <Bot className="w-3 h-3 text-purple-400" />
                          <span>VoiceTrip</span>
                        </>
                      )}
                    </span>
                    <span>{t.timestamp}</span>
                  </div>
                  <p className="leading-relaxed text-[13px]">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 5: DEVELOPER MODE AUDIT & TELEMETRY (Requirement 26) */}
        {showDevMode && (
          <div className="p-6 rounded-3xl bg-slate-950 border border-cyan-800/60 shadow-2xl flex flex-col gap-4 text-xs font-mono animate-slide-up" id="dev-mode-panel">
            <div className="flex items-center justify-between pb-3 border-b border-cyan-900/50 text-cyan-400">
              <span className="font-bold flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                DEVELOPER MODE — CONVERSATION &amp; STATE TELEMETRY
              </span>
              <span className="text-[10px] text-slate-400">10-Field Audit Trail</span>
            </div>

            {/* 10 Canonical Audit Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">1. CURRENT SESSION ID:</span>
                <span className="font-semibold text-slate-200" id="dev-session-id">{devAudit.sessionId}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">2. CURRENT TURN / GENERATION:</span>
                <span className="font-semibold text-slate-200" id="dev-generation-id">Turn {devAudit.turnId} • {devAudit.generationId}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">3. PREVIOUS CANONICAL CONTEXT:</span>
                <span className="font-semibold text-cyan-300" id="dev-prev-context">
                  {devAudit.previousContext || 'None (Initial Request)'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">4. NEW USER TRANSCRIPT:</span>
                <span className="font-semibold text-slate-100" id="dev-user-transcript">{devAudit.userTranscript || '(None)'}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">5. REQUEST TYPE:</span>
                <span
                  id="dev-request-type"
                  className={`font-bold px-2 py-0.5 rounded w-fit text-[11px] ${
                    devAudit.requestType === 'FOLLOW_UP'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  {devAudit.requestType}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">6. TOOL SELECTED:</span>
                <span className="font-semibold text-purple-300" id="dev-tool-selected">{devAudit.toolSelected}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">7. MERGED CANONICAL CONTEXT:</span>
                <pre className="text-slate-300 overflow-x-auto max-h-28 whitespace-pre-wrap text-[11px]" id="dev-merged-context">
                  {JSON.stringify(devAudit.mergedContext, null, 2)}
                </pre>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">8. TOOL ARGUMENTS PASSED:</span>
                <pre className="text-slate-300 overflow-x-auto max-h-24 whitespace-pre-wrap text-[11px]" id="dev-tool-arguments">
                  {JSON.stringify(devAudit.toolArguments, null, 2)}
                </pre>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">9. TOOL RESULTS:</span>
                <pre className="text-slate-300 overflow-x-auto max-h-36 whitespace-pre-wrap text-[11px]" id="dev-tool-results">
                  {JSON.stringify(devAudit.toolResults, null, 2)}
                </pre>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">10. FINAL AI RESPONSE (RIME TTS):</span>
                <span className="font-semibold text-emerald-300" id="dev-final-response">{devAudit.finalResponse || '(None)'}</span>
              </div>
            </div>

            {/* Audio Pipeline Diagnostics Grid */}
            <div className="pt-3 border-t border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                Pipeline Diagnostics
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-slate-300 text-[11px]">
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">STT STATUS</span>
                  <span id="dev-stt-status" className={sttStatus === 'SUCCESS' ? 'text-emerald-400 font-bold' : sttStatus === 'FAILED' ? 'text-red-400' : 'text-slate-300'}>
                    {sttStatus}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">GEMINI INTENT</span>
                  <span id="dev-gemini-status" className={geminiStatus === 'SUCCESS' ? 'text-emerald-400 font-bold' : geminiStatus === 'FAILED' ? 'text-red-400' : 'text-slate-300'}>
                    {geminiStatus}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">TOOL STATUS</span>
                  <span id="dev-tool-status" className={toolStatus === 'SUCCESS' ? 'text-emerald-400 font-bold' : toolStatus === 'FAILED' ? 'text-red-400' : 'text-slate-300'}>
                    {toolStatus}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">RIME HTTP</span>
                  <span id="dev-rime-request" className={rimePlayer.telemetry.rimeRequest === 'SUCCESS' ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                    {rimePlayer.telemetry.rimeRequest}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">RIME BYTES</span>
                  <span>{rimePlayer.telemetry.responseSize} B</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">AUDIO DURATION</span>
                  <span>{rimePlayer.telemetry.audioDuration > 0 ? `${rimePlayer.telemetry.audioDuration}s` : 'Unknown'}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">PLAY STATUS</span>
                  <span className={rimePlayer.isPlaying ? 'text-purple-400 animate-pulse' : 'text-slate-300'}>
                    {rimePlayer.isPlaying ? 'PLAYING' : rimePlayer.telemetry.play}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-4xl pt-6 mt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <span>VoiceTrip • Powered by Deepgram Nova-2 + Gemini + Rime Mist</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Voice: Rime Amber</span>
          <span>Interruption: Active</span>
        </div>
      </footer>
    </div>
  );
}
