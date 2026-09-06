import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Square,
  Volume2,
  User,
  Terminal,
  Compass,
  Loader2,
  Clock,
  Lightbulb,
  AlertCircle,
  MessageSquarePlus,
  History,
  Send,
} from 'lucide-react';
import { useAuthoritativeRecorder } from './hooks/useAuthoritativeRecorder';
import { useRimeAudioPlayer } from './hooks/useRimeAudioPlayer';
import { unlockAudioContext } from './utils/audioContext';
import { getApiBase } from './config';
import type { ConversationTurn, ChatSession } from './types/voice';
import { DemoWelcomeModal } from './components/DemoWelcomeModal';
import { ChatMessageBubble } from './components/ChatMessageBubble';
import { ChatHistorySidebar } from './components/ChatHistorySidebar';

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

const STORAGE_KEY_SESSIONS = 'voicetrip_sessions_v4';

// Helper to generate meaningful conversation titles from user query & context
function generateSessionTitle(query: string, ctx?: any): string {
  if (ctx && ctx.intent) {
    if (ctx.intent === 'flight_search' && ctx.origin && ctx.destination) {
      return `Flights ${ctx.origin} → ${ctx.destination}`;
    }
    if (ctx.intent === 'train_search' && ctx.origin && ctx.destination) {
      return `Trains ${ctx.origin} → ${ctx.destination}`;
    }
    if (ctx.intent === 'hotel_search' && ctx.destination) {
      return `Hotels in ${ctx.destination}`;
    }
    if (ctx.intent === 'route_search' && ctx.destination) {
      return `Route to ${ctx.destination}`;
    }
  }

  const clean = query.trim();
  if (clean.length <= 30) {
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return clean.slice(0, 28) + '...';
}

function createNewSessionObj(): ChatSession {
  const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    id,
    title: 'New Travel Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
    canonicalContext: null,
    lastToolName: null,
    lastToolResults: null,
  };
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

  // Multi-Chat Sessions State
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn('[STORAGE] Failed to parse sessions:', e);
      }
    }
    return [createNewSessionObj()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return sessions[0]?.id || `session_${Date.now()}`;
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [textInput, setTextInput] = useState<string>('');

  // Find active session
  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || createNewSessionObj();

  // Active Session Shortcut State
  const turns = activeSession.turns || [];
  const canonicalContext = activeSession.canonicalContext || null;
  const lastToolName = activeSession.lastToolName || null;

  const [pipelineState, setPipelineState] = useState<PipelineState>('idle');
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiTranscript, setAiTranscript] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [showDevMode, setShowDevMode] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Developer Mode Status & Structured Audit Telemetry
  const [sttStatus, setSttStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [geminiStatus, setGeminiStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [toolStatus, setToolStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [devAudit, setDevAudit] = useState<DevAuditState>({
    sessionId: activeSessionId,
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

  const activeSessionIdRef = useRef<string>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Persist sessions to LocalStorage on change
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
      } catch (e) {
        console.warn('[STORAGE] Failed to save sessions:', e);
      }
    }
  }, [sessions]);

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

  // Barge-in Speech Interruption Handler
  const handleBargeInInterruption = useCallback(() => {
    if (rimePlayer.isPlaying || pipelineState === 'speaking') {
      console.log('[BARGE_IN] USER_SPEECH_DETECTED during AI speech. Halting Rime playback immediately...');
      rimePlayer.stopAudio('user_speech_interruption');

      const nextCount = generationCount + 1;
      const nextGen = `gen_${nextCount}`;
      setGenerationCount(nextCount);
      activeGenerationRef.current = nextGen;

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

  // Auto-scroll chat history when new messages or loading updates occur
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [turns, pipelineState]);

  const handleDemoSignup = (name: string, email: string) => {
    setUserName(name);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('voicetrip_user_name', name);
      localStorage.setItem('voicetrip_user_email', email);
      localStorage.setItem('voicetrip_demo_started', 'true');
    }
    setShowWelcomeModal(false);
  };

  // Helper to update active session state immutably
  const updateActiveSession = useCallback(
    (updater: (prevSession: ChatSession) => ChatSession) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionIdRef.current ? updater(s) : s))
      );
    },
    []
  );

  // Start a fresh, clean conversation (+ New Chat)
  const handleNewChat = useCallback(() => {
    console.log('[CHAT] User clicked + New Chat. Creating fresh conversation...');
    rimePlayer.stopAudio('new_chat');
    recorder.cancelRecording();

    const newSess = createNewSessionObj();
    setSessions((prev) => [newSess, ...prev]);
    setActiveSessionId(newSess.id);
    activeSessionIdRef.current = newSess.id;

    const nextCount = generationCount + 1;
    const nextGen = `gen_${nextCount}`;
    setGenerationCount(nextCount);
    activeGenerationRef.current = nextGen;

    setPipelineState('idle');
    setStatusMessage('Ready');
    setUserTranscript('');
    setAiTranscript('');
    setErrorMessage(null);
    setSttStatus('IDLE');
    setGeminiStatus('IDLE');
    setToolStatus('IDLE');

    // Notify backend session store
    fetch(`${getApiBase()}/api/chat/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: newSess.id }),
    }).catch(() => {});
  }, [generationCount, recorder, rimePlayer]);

  // Switch between existing conversations
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionId) return;
      console.log(`[CHAT] Switching active chat to session: ${sessionId}`);
      rimePlayer.stopAudio('switch_chat');
      recorder.cancelRecording();

      setActiveSessionId(sessionId);
      activeSessionIdRef.current = sessionId;

      const nextCount = generationCount + 1;
      const nextGen = `gen_${nextCount}`;
      setGenerationCount(nextCount);
      activeGenerationRef.current = nextGen;

      setPipelineState('idle');
      setStatusMessage('Ready');
      setUserTranscript('');
      setAiTranscript('');
      setErrorMessage(null);
    },
    [activeSessionId, generationCount, recorder, rimePlayer]
  );

  // Delete a conversation from history
  const handleDeleteSession = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== sessionId);
        if (filtered.length === 0) {
          const fresh = createNewSessionObj();
          setActiveSessionId(fresh.id);
          activeSessionIdRef.current = fresh.id;
          return [fresh];
        }
        if (sessionId === activeSessionIdRef.current) {
          setActiveSessionId(filtered[0].id);
          activeSessionIdRef.current = filtered[0].id;
        }
        return filtered;
      });
    },
    []
  );

  // Unified Process Turn Handler for Voice & Text (ChatGPT-style)
  const processTurn = useCallback(
    async (finalText: string, targetGen: string, targetSession: string) => {
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

      const userTurnId = `turn_${Date.now()}_user_${targetGen}`;
      const assistantTurnId = `turn_${Date.now()}_assistant_${targetGen}`;

      const userTurn: ConversationTurn = {
        id: userTurnId,
        generationId: targetGen,
        sender: 'user',
        text: cleanText,
        rawTranscript: cleanText,
        correctedTranscript: cleanText,
        wasCorrected: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      // ChatGPT-style: Immediately create User bubble & Assistant loading indicator
      const loadingAssistantTurn: ConversationTurn = {
        id: assistantTurnId,
        generationId: targetGen,
        sender: 'assistant',
        text: '',
        isLoading: true,
        loadingStatus: 'Thinking...',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      updateActiveSession((sess) => {
        const isFirstQuery = sess.turns.length === 0;
        const newTitle = isFirstQuery ? generateSessionTitle(cleanText) : sess.title;
        return {
          ...sess,
          title: newTitle,
          updatedAt: Date.now(),
          turns: [...sess.turns, userTurn, loadingAssistantTurn],
        };
      });

      try {
        console.log(`[LLM] Calling /api/chat with prompt: "${cleanText}" (session: ${targetSession}, gen: ${targetGen})`);
        const res = await fetch(`${getApiBase()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: targetSession,
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

        // Stale Barrier Check: prevent old/superseded generation responses from leaking
        if (activeGenerationRef.current !== targetGen || activeSessionIdRef.current !== targetSession) {
          console.warn(`[BARRIER] Stale LLM response dropped for gen ${targetGen} (active: ${activeGenerationRef.current})`);
          return;
        }

        const rawSpeech = data.raw_transcript || cleanText;
        const correctedSpeech = data.corrected_transcript || cleanText;
        const wasCorr = Boolean(data.was_corrected);

        const ctx = data.canonical_context;

        // Update user turn if autocorrected
        updateActiveSession((sess) => {
          const updatedTurns = sess.turns.map((t) => {
            if (t.id === userTurnId) {
              return {
                ...t,
                text: correctedSpeech,
                rawTranscript: rawSpeech,
                correctedTranscript: correctedSpeech,
                wasCorrected: wasCorr,
                corrections: data.corrections || [],
              };
            }
            return t;
          });
          const updatedTitle = sess.turns.length <= 2 ? generateSessionTitle(correctedSpeech, ctx) : sess.title;
          return {
            ...sess,
            title: updatedTitle,
            canonicalContext: ctx || sess.canonicalContext,
            turns: updatedTurns,
          };
        });

        // Case A: Direct Text / Conversational Response
        if (data.response_type === 'text' && data.text) {
          const spoken = data.text;
          setAiTranscript(spoken);
          setToolStatus('IDLE');

          setDevAudit({
            sessionId: targetSession,
            turnId: generationCount,
            generationId: targetGen,
            previousContext: ctx?.previous_summary || null,
            userTranscript: correctedSpeech,
            requestType: ctx?.request_type || 'NEW',
            mergedContext: ctx,
            toolSelected: 'None (Conversational/Direct Text)',
            toolArguments: null,
            toolResults: null,
            finalResponse: spoken,
          });

          // Replace loading turn with real text response
          updateActiveSession((sess) => ({
            ...sess,
            lastToolName: null,
            lastToolResults: null,
            turns: sess.turns.map((t) =>
              t.id === assistantTurnId
                ? {
                    ...t,
                    isLoading: false,
                    text: spoken,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  }
                : t
            ),
          }));

          setPipelineState('speaking');
          setStatusMessage('AI Speaking...');

          await rimePlayer.playRimeSpeech(spoken, targetGen);
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

          const searchingLabel =
            toolName === 'search_flights'
              ? 'Searching flight options...'
              : toolName === 'search_hotels'
              ? 'Searching hotel options...'
              : toolName === 'search_trains'
              ? 'Searching train schedules...'
              : 'Finding travel options...';

          setStatusMessage(searchingLabel);

          // Update loading bubble label to reflect active search tool
          updateActiveSession((sess) => ({
            ...sess,
            turns: sess.turns.map((t) =>
              t.id === assistantTurnId ? { ...t, loadingStatus: searchingLabel } : t
            ),
          }));

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
              session_id: targetSession,
            }),
          });

          if (!toolRes.ok) {
            setToolStatus('FAILED');
            throw new Error(`Tool HTTP ${toolRes.status}`);
          }
          setToolStatus('SUCCESS');
          const toolData = await toolRes.json();

          // Barrier Check
          if (activeGenerationRef.current !== targetGen || activeSessionIdRef.current !== targetSession) return;

          const initialSpoken =
            toolName === 'search_trains'
              ? `Found ${toolData.trains?.length || 0} trains between ${args.origin || toolData.origin || 'origin'} and ${args.destination || toolData.destination || 'destination'}.`
              : toolName === 'search_flights'
              ? `Found ${toolData.flights?.length || 0} flight options for your journey.`
              : toolName === 'search_hotels'
              ? `Found accommodation options in ${args.destination || toolData.destination || 'your destination'}.`
              : `Found travel options for your request.`;

          setAiTranscript(initialSpoken);

          // FAST PATH: Immediately attach result cards and replace loading state in the assistant chat bubble!
          updateActiveSession((sess) => ({
            ...sess,
            lastToolName: toolName,
            lastToolResults: toolData,
            turns: sess.turns.map((t) =>
              t.id === assistantTurnId
                ? {
                    ...t,
                    isLoading: false,
                    text: initialSpoken,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    toolDetails: {
                      toolName,
                      params: args,
                      executionTimeMs: toolData.execution_time_ms || 120,
                      cancelled: false,
                      results: toolData.trains || toolData.flights || toolData.hotels || toolData.routes || [],
                      rawResult: toolData,
                    },
                  }
                : t
            ),
          }));

          setPipelineState('speaking');
          setStatusMessage('AI Speaking...');

          // UNBLOCKED PARALLEL VOICE SYNTHESIS: Generate polished spoken summary & stream Rime TTS
          (async () => {
            try {
              const summaryRes = await fetch(`${getApiBase()}/api/chat/tool_result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  session_id: targetSession,
                  tool_name: toolName,
                  tool_results: toolData,
                  generation_id: targetGen,
                }),
              });

              if (!summaryRes.ok) return;
              const summaryData = await summaryRes.json();
              if (activeGenerationRef.current !== targetGen || activeSessionIdRef.current !== targetSession) return;

              const spokenText = summaryData.text || initialSpoken;
              setAiTranscript(spokenText);

              // Update assistant message with final polished spoken summary
              updateActiveSession((sess) => ({
                ...sess,
                turns: sess.turns.map((t) => (t.id === assistantTurnId ? { ...t, text: spokenText } : t)),
              }));

              setDevAudit({
                sessionId: targetSession,
                turnId: generationCount,
                generationId: targetGen,
                previousContext: ctx?.previous_summary || null,
                userTranscript: correctedSpeech,
                requestType: ctx?.request_type || 'NEW',
                mergedContext: ctx,
                toolSelected: toolName,
                toolArguments: args,
                toolResults: toolData,
                finalResponse: spokenText,
              });

              // Play Rime speech output
              await rimePlayer.playRimeSpeech(spokenText, targetGen);
              recorder.startInterruptionMonitoring();
            } catch (sumErr) {
              console.error('[SUMMARY] Voice synthesis error:', sumErr);
            }
          })();

          return;
        }

        setPipelineState('idle');
        setStatusMessage('Ready');
      } catch (err: unknown) {
        console.error('[PROCESS_TURN] Pipeline error:', err);
        setErrorMessage('Something went wrong while finding your travel options. Please try again.');

        // Clean up loading state if error occurred
        updateActiveSession((sess) => ({
          ...sess,
          turns: sess.turns.map((t) =>
            t.id === assistantTurnId
              ? {
                  ...t,
                  isLoading: false,
                  text: 'I encountered an issue finding options. Please try again or rephrase your request.',
                }
              : t
          ),
        }));

        setPipelineState('idle');
        setStatusMessage('Ready');
      }
    },
    [generationCount, recorder, rimePlayer, updateActiveSession]
  );

  // Manual Microphone Button Handler (Strict Start / Stop & Send)
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

        await processTurn(result.text, nextGen, activeSessionIdRef.current);
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

  // Text Input Submission Handler (for typed messages)
  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!textInput.trim() || isBusy || recorder.isRecording) return;

    const query = textInput.trim();
    setTextInput('');

    const nextCount = generationCount + 1;
    const nextGen = `gen_${nextCount}`;
    setGenerationCount(nextCount);
    activeGenerationRef.current = nextGen;

    await processTurn(query, nextGen, activeSessionIdRef.current);
  };

  // Suggestion Chip Click Handler
  const handleSuggestionClick = async (suggestion: string) => {
    if (isBusy || recorder.isRecording) return;
    const nextCount = generationCount + 1;
    const nextGen = `gen_${nextCount}`;
    setGenerationCount(nextCount);
    activeGenerationRef.current = nextGen;
    await processTurn(suggestion, nextGen, activeSessionIdRef.current);
  };

  // Manual Interrupt AI Button Click Handler
  const handleInterruptAI = async () => {
    console.log('[INTERRUPT_AI] User clicked Interrupt AI button. Stopping audio and starting mic...');
    rimePlayer.stopAudio('user_interrupt_button');
    recorder.stopInterruptionMonitoring();
    const nextCount = generationCount + 1;
    const nextGen = `gen_${nextCount}`;
    setGenerationCount(nextCount);
    activeGenerationRef.current = nextGen;
    rimePlayer.setActiveGeneration(nextGen);

    // Automatically turn microphone ON and begin listening for user request
    setUserTranscript('');
    setPipelineState('recording');
    setStatusMessage('Listening...');
    setSttStatus('IDLE');
    setGeminiStatus('IDLE');
    setToolStatus('IDLE');

    try {
      await recorder.startRecording();
    } catch (startErr: unknown) {
      const e = startErr as Error;
      console.error('[MIC] Failed to auto-start microphone on interrupt:', e);
      setErrorMessage(`Microphone error: ${e.message}`);
      setPipelineState('idle');
      setStatusMessage('Ready');
    }
  };

  // Test Rime Voice Shortcut
  const handleTestRime = async () => {
    setErrorMessage(null);
    setPipelineState('speaking');
    setStatusMessage('Testing Rime voice...');
    await rimePlayer.testRimeVoice();
  };

  const isBusy = pipelineState !== 'idle' && pipelineState !== 'recording';
  const isAiSpeakingOrGenerating =
    rimePlayer.isPlaying ||
    rimePlayer.telemetry.rimeRequest === 'STARTED' ||
    pipelineState === 'speaking' ||
    pipelineState === 'synthesizing' ||
    pipelineState === 'searching' ||
    pipelineState === 'thinking';

  return (
    <div className="min-h-screen bg-[#060a12] text-slate-100 flex flex-col items-center justify-between p-3 sm:p-6 md:p-8 font-sans selection:bg-cyan-500/30 relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-cyan-500/[0.04] blur-[120px] animate-ambient-drift" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[500px] h-[500px] rounded-full bg-purple-500/[0.04] blur-[120px] animate-ambient-drift-reverse" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-teal-500/[0.03] blur-[100px]" />
      </div>

      {/* DEMO WELCOME / SIGNUP MODAL */}
      {showWelcomeModal && (
        <DemoWelcomeModal initialName={userName} onContinue={handleDemoSignup} />
      )}

      {/* CHAT HISTORY SIDEBAR / DRAWER */}
      <ChatHistorySidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
      />

      {/* Top Header */}
      <header className="relative z-10 w-full max-w-4xl flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          {/* History Sidebar Drawer Toggle */}
          <button
            onClick={() => setIsSidebarOpen(true)}
            id="chat-history-drawer-btn"
            className="p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-800 transition flex items-center gap-1.5 shadow-sm"
            title="Open Chat History"
          >
            <History className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline text-xs font-semibold">History</span>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded-full font-mono">
              {sessions.length}
            </span>
          </button>

          {/* Logo & App Name */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-cyan-500 to-teal-400 p-0.5 shadow-md shadow-cyan-500/20">
              <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center text-cyan-400">
                <Compass className="w-5 h-5" />
              </div>
            </div>
            <div>
              <h1 className="text-base sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                VoiceTrip
              </h1>
              <p className="text-[11px] text-slate-400 truncate max-w-[140px] sm:max-w-[220px]">
                {activeSession.title}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* + New Chat Button on Top Bar */}
          <button
            onClick={handleNewChat}
            id="top-new-chat-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-950/40 transition transform active:scale-95"
            title="Start a fresh conversation"
          >
            <MessageSquarePlus className="w-4 h-4 text-slate-950" />
            <span>+ New Chat</span>
          </button>

          {/* Developer Mode Toggle */}
          <button
            onClick={() => setShowDevMode(!showDevMode)}
            id="dev-mode-toggle"
            className={`hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-medium border transition items-center gap-1.5 ${
              showDevMode
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 shadow-sm shadow-cyan-950/50'
                : 'bg-slate-900/90 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Dev Mode</span>
          </button>

          {/* Demo User Pill */}
          <button
            onClick={() => setShowWelcomeModal(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 transition"
            title="Switch demo profile"
          >
            <User className="w-3.5 h-3.5 text-cyan-400" />
            <span>{userName}</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 w-full max-w-4xl flex-1 flex flex-col gap-5">
        {/* SECTION 1: CENTRAL MICROPHONE EXPERIENCE */}
        <div className="relative p-5 sm:p-7 rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/95 border border-slate-700/40 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8),0_0_80px_-30px_rgba(6,182,212,0.15)] backdrop-blur-2xl flex flex-col items-center justify-center gap-5 overflow-hidden">
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

          {/* Helper Message Banner */}
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
          <div className="relative flex flex-col items-center gap-4">
            {/* Animated Orb Ring around Mic Button */}
            <div
              className={`absolute w-44 h-44 sm:w-52 sm:h-52 rounded-full transition-all duration-500 ${
                recorder.isRecording
                  ? 'orb-ring-recording'
                  : pipelineState === 'speaking'
                  ? 'orb-ring-speaking'
                  : isBusy
                  ? 'orb-ring-busy'
                  : 'orb-ring-idle'
              }`}
            />
            <button
              onClick={handleToggleMic}
              disabled={isBusy}
              id="mic-main-btn"
              className={`relative z-10 w-36 h-36 sm:w-44 sm:h-44 rounded-full font-bold text-base flex flex-col items-center justify-center gap-1.5 shadow-2xl transition-all duration-300 transform active:scale-95 group ${
                recorder.isRecording
                  ? 'bg-gradient-to-b from-red-500 to-rose-600 text-white animate-recording-pulse border-4 border-red-300/40 shadow-[0_0_50px_-5px_rgba(239,68,68,0.5)]'
                  : isBusy
                  ? 'bg-slate-800/90 text-slate-400 cursor-not-allowed border-2 border-slate-700'
                  : 'bg-gradient-to-tr from-cyan-500 via-teal-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 shadow-[0_0_60px_-10px_rgba(6,182,212,0.4)] hover:shadow-[0_0_80px_-10px_rgba(6,182,212,0.6)] border-4 border-cyan-400/30'
              }`}
            >
              {recorder.isRecording ? (
                <>
                  <div className="p-3 rounded-full bg-red-700/80 shadow-inner">
                    <Square className="w-7 h-7 fill-current text-white" />
                  </div>
                  <span className="text-xs sm:text-sm font-extrabold tracking-wider uppercase">
                    STOP &amp; SEND
                  </span>
                  <span className="text-[10px] font-medium text-red-100 opacity-90">
                    Click to send
                  </span>
                </>
              ) : isBusy ? (
                <>
                  <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                  <span className="text-xs sm:text-sm font-bold tracking-wider uppercase text-slate-200">
                    {statusMessage}
                  </span>
                  <span className="text-[10px] text-slate-400">Processing...</span>
                </>
              ) : (
                <>
                  <div className="p-3 rounded-full bg-slate-950/30 group-hover:scale-110 transition duration-300">
                    <Mic className="w-7 h-7 text-slate-950" />
                  </div>
                  <span className="text-sm sm:text-base font-extrabold tracking-wider uppercase text-slate-950">
                    START MIC
                  </span>
                  <span className="text-[10px] font-medium text-slate-900 opacity-80">
                    Tap to speak
                  </span>
                </>
              )}
            </button>

            {/* Action Buttons Row: Interrupt AI + Test Rime Voice */}
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                onClick={handleInterruptAI}
                disabled={!isAiSpeakingOrGenerating}
                id="interrupt-ai-btn"
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition duration-200 shadow-sm ${
                  isAiSpeakingOrGenerating
                    ? 'bg-red-600 hover:bg-red-500 text-white border-red-400 shadow-lg shadow-red-950/60 animate-pulse ring-2 ring-red-400/30 cursor-pointer'
                    : 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                }`}
                title={isAiSpeakingOrGenerating ? 'Interrupt AI immediately' : 'AI is not speaking'}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Interrupt AI</span>
              </button>

              <button
                onClick={handleTestRime}
                disabled={recorder.isRecording || isBusy}
                id="test-rime-btn"
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-purple-950/40 hover:bg-purple-900/50 text-purple-300 border border-purple-800/40 transition flex items-center gap-1.5 shadow-sm"
                title="Test Rime TTS Voice directly"
              >
                <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                <span>Test Rime</span>
              </button>
            </div>
          </div>

          {/* Under-Microphone Device Info & Live Meter */}
          <div className="w-full max-w-xl flex flex-col gap-2.5 pt-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1.5">
              <span className="text-slate-400 flex items-center gap-1.5">
                Microphone:{' '}
                <strong className="text-slate-200 truncate max-w-[220px]" id="using-mic-label">
                  {recorder.activeDeviceLabel}
                </strong>
              </span>
              <span
                id="recording-status-badge"
                className={`font-semibold uppercase tracking-wider px-2 py-0.5 rounded text-[10px] self-start sm:self-auto ${
                  recorder.isRecording
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                Recording: {recorder.isRecording ? 'ON' : 'OFF'}
              </span>
            </div>

            {/* Hardware Volume Meter */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-500 w-16">Mic Level:</span>
              <div className="flex-1 h-2 rounded-full bg-slate-950 overflow-hidden p-0.5 border border-slate-800/80">
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
          </div>
        </div>

        {/* Error Notice */}
        {errorMessage && (
          <div className="p-3.5 rounded-2xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-center justify-between gap-3 animate-slide-up">
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

        {/* SECTION 2: CHATGPT-STYLE CONVERSATION THREAD */}
        <div className="p-4 sm:p-6 rounded-3xl glass-card border-slate-800/80 shadow-2xl flex flex-col gap-4 min-h-[380px]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                {activeSession.title || 'Conversation'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {rimePlayer.isPlaying && (
                <span className="flex items-center gap-1 text-[11px] text-purple-300 bg-purple-950/60 border border-purple-800/50 px-2.5 py-0.5 rounded-full animate-pulse font-medium">
                  <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                  AI Speaking...
                </span>
              )}
              <span className="text-[11px] text-slate-500 font-mono">
                {turns.filter((t) => !t.isLoading).length} turns
              </span>
            </div>
          </div>

          {/* Messages Stream */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto space-y-4 max-h-[520px] pr-1.5 scroll-smooth"
            id="chat-messages-container"
          >
            {turns.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-cyan-950/40 border border-cyan-800/40 flex items-center justify-center text-cyan-400">
                  <Compass className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Start your journey with VoiceTrip</h3>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    Tap the microphone or pick a prompt below to search trains, flights, hotels, and custom travel plans.
                  </p>
                </div>

                {/* Suggestion Chips */}
                <div className="pt-3 flex flex-wrap items-center justify-center gap-2 max-w-lg">
                  {[
                    'Flights from Kolkata to Mumbai',
                    'Find hotels in Delhi',
                    'Trains from NJP to Howrah tomorrow',
                    'What is Python?',
                  ].map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSuggestionClick(s)}
                      disabled={isBusy || recorder.isRecording}
                      className="px-3 py-1.5 rounded-xl text-xs bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-cyan-500/40 transition shadow-sm flex items-center gap-1.5 transform active:scale-95"
                    >
                      <span>{s}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t) => (
                <ChatMessageBubble
                  key={t.id}
                  turn={t}
                  onPlayVoice={(spoken) => rimePlayer.playRimeSpeech(spoken, currentGenerationId)}
                  isPlayingVoice={rimePlayer.isPlaying}
                />
              ))
            )}
          </div>

          {/* Quick Typed Input Form for Chat */}
          <form
            onSubmit={handleSendText}
            className="pt-3 border-t border-slate-800/80 flex items-center gap-2"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                recorder.isRecording
                  ? 'Listening to microphone...'
                  : 'Type a message or travel destination...'
              }
              disabled={recorder.isRecording || isBusy}
              className="flex-1 bg-slate-950/90 border border-slate-800 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition shadow-inner"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || isBusy || recorder.isRecording}
              className={`p-2.5 rounded-2xl transition flex items-center justify-center ${
                textInput.trim() && !isBusy && !recorder.isRecording
                  ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-slate-950 shadow-md shadow-cyan-950/50 hover:from-cyan-400 hover:to-teal-400 cursor-pointer'
                  : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'
              }`}
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* SECTION 3: DEVELOPER MODE AUDIT & TELEMETRY */}
        {showDevMode && (
          <div
            className="p-6 rounded-3xl bg-slate-950 border border-cyan-800/60 shadow-2xl flex flex-col gap-4 text-xs font-mono animate-slide-up"
            id="dev-mode-panel"
          >
            <div className="flex items-center justify-between pb-3 border-b border-cyan-900/50 text-cyan-400">
              <span className="font-bold flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                DEVELOPER MODE — CONVERSATION &amp; STATE TELEMETRY
              </span>
              <span className="text-[10px] text-slate-400">Multi-Turn Session State</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">1. ACTIVE SESSION ID:</span>
                <span className="font-semibold text-slate-200 truncate" id="dev-session-id">
                  {activeSessionId}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">2. CURRENT GENERATION:</span>
                <span className="font-semibold text-slate-200" id="dev-generation-id">
                  Turn {turns.length} • {currentGenerationId}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">3. PIPELINE STAGE AUDIT:</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-slate-400">STT: <b className="text-cyan-400">{sttStatus}</b></span>
                  <span className="text-slate-400">Gemini: <b className="text-blue-400">{geminiStatus}</b></span>
                  <span className="text-slate-400">Tool: <b className="text-purple-400">{toolStatus}</b></span>
                  {userTranscript && <span className="text-slate-500 truncate max-w-xs">User: {userTranscript}</span>}
                  {aiTranscript && <span className="text-slate-500 truncate max-w-xs">AI: {aiTranscript}</span>}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">4. CANONICAL CONTEXT:</span>
                <pre className="text-slate-300 overflow-x-auto max-h-28 whitespace-pre-wrap text-[11px]" id="dev-merged-context">
                  {JSON.stringify(canonicalContext || devAudit.mergedContext, null, 2)}
                </pre>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">5. LAST TOOL EXECUTED:</span>
                <span className="font-semibold text-purple-300" id="dev-tool-selected">
                  {lastToolName || devAudit.toolSelected || 'None'}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-4xl pt-4 mt-4 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <span>VoiceTrip • Powered by Deepgram Nova-2 + Gemini + Rime Mist</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Voice: Rime Amber</span>
          <span>Interruption: Active</span>
          <span>Manual Mic: Strict</span>
        </div>
      </footer>
    </div>
  );
}
