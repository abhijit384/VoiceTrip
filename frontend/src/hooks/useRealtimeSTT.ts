import { useState, useEffect, useRef, useCallback } from 'react';
import type { PipelineInitState } from '../types/voice';
import { getSharedAudioContext } from '../utils/audioContext';
import { getWsBase } from '../config';

// Chrome Web Speech API types
interface WindowWithSpeech extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export interface STTState {
  isStreaming: boolean;
  partialTranscript: string;
  finalTranscript: string;
  sttProvider: 'deepgram' | 'web_speech' | 'idle';
  isDeepgramConfigured: boolean;
  latencyMs: number;
  error: string | null;
  pipelineState: PipelineInitState;
  isSpeechActive: boolean;
  speechAudioLevel: number; // 0 to 100 live speech volume
}

export function useRealtimeSTT(
  mediaStream: MediaStream | null,
  isMicActive: boolean,
  onFinalTranscript?: (text: string) => void,
  onSpeechStart?: () => void,
  currentGenerationId: string = 'gen_1'
) {
  const [state, setState] = useState<STTState>({
    isStreaming: false,
    partialTranscript: '',
    finalTranscript: '',
    sttProvider: 'idle',
    isDeepgramConfigured: false,
    latencyMs: 0,
    error: null,
    pipelineState: 'INITIALIZING',
    isSpeechActive: false,
    speechAudioLevel: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const webSpeechRecRef = useRef<any>(null);

  const speechStartTimeRef = useRef<number>(0);
  const speechDetectedRef = useRef<boolean>(false);
  const lastSpeechTimestampRef = useRef<number>(0);
  const silenceCheckTimerRef = useRef<number | null>(null);
  const accumulatedTurnTextRef = useRef<string>('');
  const lastInterimRef = useRef<string>('');
  const currentGenRef = useRef<string>(currentGenerationId);
  currentGenRef.current = currentGenerationId;

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const isDeepgramConfiguredRef = useRef<boolean>(false);
  const isSTTReadyRef = useRef<boolean>(false);
  const firstAudioFrameSentLogged = useRef<boolean>(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isMicActiveRef = useRef<boolean>(isMicActive);
  isMicActiveRef.current = isMicActive;
  const mediaStreamRef = useRef<MediaStream | null>(mediaStream);
  mediaStreamRef.current = mediaStream;

  // Helper to trigger turn finalization automatically
  const finalizeTurn = useCallback(() => {
    if (silenceCheckTimerRef.current) {
      clearTimeout(silenceCheckTimerRef.current);
      silenceCheckTimerRef.current = null;
    }

    const fullUtterance = (
      accumulatedTurnTextRef.current +
      (lastInterimRef.current ? ` ${lastInterimRef.current}` : '')
    ).trim();

    if (fullUtterance.length > 0) {
      const tFinal = Date.now() / 1000;
      console.log(`[STT] turn_finalized_auto=${tFinal.toFixed(3)} text="${fullUtterance}" gen=${currentGenRef.current}`);

      setState((prev) => ({
        ...prev,
        partialTranscript: '',
        finalTranscript: fullUtterance,
        isSpeechActive: false,
      }));

      // Submit turn automatically to conversation logic
      if (onFinalTranscriptRef.current) {
        onFinalTranscriptRef.current(fullUtterance);
      }
    }

    // Reset turn buffers for next continuous turn
    accumulatedTurnTextRef.current = '';
    lastInterimRef.current = '';
    speechDetectedRef.current = false;
  }, []);

  // Connect to backend WebSocket hub with native audio sample rate linear16 PCM
  const connectWebSocket = useCallback((customRate?: number) => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const audioCtx = getSharedAudioContext();
      const sampleRate = customRate || audioCtx.sampleRate || 48000;
      const tConnecting = Date.now() / 1000;
      console.log(`[STT] deepgram_connecting=${tConnecting.toFixed(3)} rate=${sampleRate}Hz`);
      setState((prev) => ({ ...prev, pipelineState: 'STT_CONNECTING' }));

      const wsUrl = `${getWsBase()}/api/ws/stt?sample_rate=${sampleRate}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const tOpen = Date.now() / 1000;
        console.log(`[STT] deepgram_websocket_opened=${tOpen.toFixed(3)}`);
        setState((prev) => ({ ...prev, error: null, pipelineState: 'STT_READY' }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'stt_ready') {
            const tReady = Date.now() / 1000;
            console.log(`[STT] stt_ready=${tReady.toFixed(3)} provider=${data.provider} configured=${data.deepgram_configured}`);
            isSTTReadyRef.current = true;
            isDeepgramConfiguredRef.current = data.deepgram_configured;

            setState((prev) => ({
              ...prev,
              isDeepgramConfigured: data.deepgram_configured,
              sttProvider: data.deepgram_configured ? 'deepgram' : 'web_speech',
              pipelineState: 'VOICE_READY',
            }));
          } else if (data.type === 'transcript') {
            const text = (data.text || '').trim();
            const isChunkFinal = data.is_final;
            const isSpeechFinal = data.speech_final;
            const latency = speechStartTimeRef.current > 0 ? Date.now() - speechStartTimeRef.current : 120;

            if (text) {
              lastSpeechTimestampRef.current = Date.now();

              // Trigger barge-in immediately when user speech starts
              if (!speechDetectedRef.current) {
                speechDetectedRef.current = true;
                console.log(`[STT] speech_start_detected=${(Date.now() / 1000).toFixed(3)} text="${text}"`);
                if (onSpeechStartRef.current) {
                  onSpeechStartRef.current();
                }
              }

              if (isChunkFinal) {
                accumulatedTurnTextRef.current = accumulatedTurnTextRef.current
                  ? `${accumulatedTurnTextRef.current} ${text}`
                  : text;
                lastInterimRef.current = '';
              } else {
                lastInterimRef.current = text;
              }

              const displayInterim = lastInterimRef.current;
              const fullDisplay = accumulatedTurnTextRef.current
                ? (displayInterim ? `${accumulatedTurnTextRef.current} ${displayInterim}` : accumulatedTurnTextRef.current)
                : displayInterim;

              setState((prev) => ({
                ...prev,
                partialTranscript: displayInterim,
                finalTranscript: fullDisplay,
                latencyMs: latency,
                isSpeechActive: true,
              }));
            }

            // If Deepgram endpointing signals speech_final or UtteranceEnd, finalize immediately
            if (isSpeechFinal) {
              if (text && !isChunkFinal) {
                accumulatedTurnTextRef.current = accumulatedTurnTextRef.current
                  ? `${accumulatedTurnTextRef.current} ${text}`
                  : text;
                lastInterimRef.current = '';
              }
              finalizeTurn();
              return;
            }

            if (text) {
              // Reset VAD silence countdown: if 1200ms pass with no further speech, auto-finalize turn
              if (silenceCheckTimerRef.current) clearTimeout(silenceCheckTimerRef.current);
              silenceCheckTimerRef.current = window.setTimeout(() => {
                finalizeTurn();
              }, 1200);
            }
          } else if (data.type === 'stt_error') {
            console.warn('[STT] Deepgram error received:', data.error);
          }
        } catch (err) {
          console.warn('Error parsing STT message:', err);
        }
      };

      ws.onerror = () => {
        console.warn('[STT] WebSocket error; check backend connection');
      };

      ws.onclose = () => {
        console.log('[STT] STT WebSocket closed');
        wsRef.current = null;
        isSTTReadyRef.current = false;

        // Auto-reconnect if mic is still active
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectWebSocket();
        }, 1500);
      };
    } catch (e) {
      console.warn('Could not establish STT WebSocket:', e);
    }
  }, [finalizeTurn]);

  // Convert Float32 audio samples directly to pristine 16-bit linear PCM
  const convertFloat32ToInt16PCM = (input: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      // 2.5x gain with hyperbolic tangent soft-limiter: boosts quiet speech without digital clipping
      const s = Math.tanh(input[i] * 2.5);
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  };

  // Start continuous full-duplex audio capture & streaming
  const startAudioStreaming = useCallback(async () => {
    const stream = mediaStreamRef.current;
    if (!stream) return;

    if (stream.getAudioTracks().length === 0 || !stream.getAudioTracks()[0].enabled) {
      setState((prev) => ({ ...prev, error: 'Microphone track is not active.' }));
      return;
    }

    speechStartTimeRef.current = Date.now();
    speechDetectedRef.current = false;
    accumulatedTurnTextRef.current = '';
    lastInterimRef.current = '';
    firstAudioFrameSentLogged.current = false;

    console.log(`[STT] user_speech_session_active=${(Date.now() / 1000).toFixed(3)} gen=${currentGenRef.current}`);
    setState((prev) => ({ ...prev, isStreaming: true, partialTranscript: '', error: null }));

    try {
      // 1. Get or create shared AudioContext
      const audioCtx = getSharedAudioContext();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Connect WebSocket if not open
      connectWebSocket(audioCtx.sampleRate);

      // Clean up previous nodes if any
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (processorNodeRef.current) {
        try { processorNodeRef.current.disconnect(); } catch {}
        processorNodeRef.current = null;
      }
      (window as any).__voiceTripProcessor = null;
      if (analyserRef.current) {
        try { analyserRef.current.disconnect(); } catch {}
        analyserRef.current = null;
      }
      if (boostGainRef.current) {
        try { boostGainRef.current.disconnect(); } catch {}
        boostGainRef.current = null;
      }
      if (silentGainRef.current) {
        try { silentGainRef.current.disconnect(); } catch {}
        silentGainRef.current = null;
      }
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.disconnect(); } catch {}
        sourceNodeRef.current = null;
      }

      // Create primary source node from active microphone stream
      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // 2. High-sensitivity AnalyserNode (exactly matching MicTestPage)
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      analyserRef.current = analyser;

      const boostGain = audioCtx.createGain();
      boostGain.gain.value = 4.0;
      boostGainRef.current = boostGain;

      source.connect(boostGain);
      boostGain.connect(analyser);

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0.00001;
      silentGainRef.current = silentGain;
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      // 60 FPS Realtime Render Loop for instant volume meter animation
      const timeData = new Float32Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      let lastRenderTime = 0;

      const renderVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(timeData);
        analyserRef.current.getByteFrequencyData(freqData);

        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
          sumSquares += timeData[i] * timeData[i];
        }
        const rms = Math.sqrt(sumSquares / timeData.length);

        let freqSum = 0;
        for (let i = 0; i < freqData.length; i++) {
          freqSum += freqData[i];
        }
        const freqLevel = (freqSum / freqData.length) / 255;

        // Combined responsive level (0 to 100) exactly matching MicTestPage
        const normalized = Math.min(1, Math.max(rms * 5, freqLevel * 2));
        const volume = Math.round(normalized * 100);

        if (rms > 0.002) {
          lastSpeechTimestampRef.current = Date.now();
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            console.log(`[STT] voice_activity_detected=${(Date.now() / 1000).toFixed(3)} rms=${rms.toFixed(5)}`);
            if (onSpeechStartRef.current) {
              onSpeechStartRef.current();
            }
          }
        }

        const now = Date.now();
        if (now - lastRenderTime > 25) {
          lastRenderTime = now;
          setState((prev) => (prev.speechAudioLevel === volume ? prev : { ...prev, speechAudioLevel: volume }));
        }

        animFrameRef.current = requestAnimationFrame(renderVolume);
      };

      renderVolume();

      // 3. ScriptProcessor for streaming audio chunks to Deepgram
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorNodeRef.current = processor;
      (window as any).__voiceTripProcessor = processor; // Pin in global scope so V8 never garbage-collects it!

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const outputData = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < outputData.length; i++) {
          outputData[i] = 0;
        }

        // Convert directly to 16-bit PCM at native sample rate with soft-limiting
        const pcmBuffer = convertFloat32ToInt16PCM(inputData);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && isSTTReadyRef.current) {
          if (!firstAudioFrameSentLogged.current) {
            firstAudioFrameSentLogged.current = true;
            console.log(`[STT] first_audio_frame_sent_to_stt=${(Date.now() / 1000).toFixed(3)} bytes=${pcmBuffer.byteLength} rate=${audioCtx.sampleRate}Hz`);
          }
          wsRef.current.send(pcmBuffer);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      console.log(`[STT] Full-duplex audio pipeline active at native ${audioCtx.sampleRate}Hz -> Deepgram STT`);
    } catch (err) {
      console.error('[STT] Failed to initialize Web Audio streamer:', err);
    }

    // 4. Dual Fallback Engine: Web Speech API only if Deepgram is NOT configured
    const win = window as WindowWithSpeech;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!isDeepgramConfiguredRef.current && SpeechRec && !webSpeechRecRef.current) {
      try {
        const recognition = new SpeechRec();
        webSpeechRecRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let interimText = '';
          let finalText = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalText += transcript;
            } else {
              interimText += transcript;
            }
          }

          const activeText = (finalText || interimText).trim();
          if (activeText) {
            if (!speechDetectedRef.current) {
              speechDetectedRef.current = true;
              if (onSpeechStartRef.current) onSpeechStartRef.current();
            }

            setState((prev) => ({
              ...prev,
              partialTranscript: interimText,
              finalTranscript: finalText || prev.finalTranscript,
              isSpeechActive: true,
              sttProvider: 'web_speech',
            }));

            if (finalText.trim().length > 0) {
              const fullTurn = finalText.trim();
              console.log(`[STT] web_speech_turn_finalized="${fullTurn}"`);
              speechDetectedRef.current = false;
              if (silenceCheckTimerRef.current) clearTimeout(silenceCheckTimerRef.current);
              if (onFinalTranscriptRef.current) {
                onFinalTranscriptRef.current(fullTurn);
              }
            } else if (interimText.trim().length > 0) {
              lastInterimRef.current = interimText.trim();
              if (silenceCheckTimerRef.current) clearTimeout(silenceCheckTimerRef.current);
              silenceCheckTimerRef.current = window.setTimeout(() => {
                finalizeTurn();
              }, 1000);
            }
          }
        };

        recognition.onerror = (e: any) => {
          console.debug('WebSpeech notice:', e.error);
        };

        recognition.onend = () => {
          if (isMicActiveRef.current && !isDeepgramConfiguredRef.current && webSpeechRecRef.current) {
            try {
              recognition.start();
            } catch {}
          }
        };

        recognition.start();
        console.log('[STT] Web Speech API fallback active');
      } catch (e) {
        console.warn('Web Speech API initialization notice:', e);
      }
    }
  }, [connectWebSocket, finalizeTurn]);

  // Stop streaming cleanly without breaking AudioContext
  const stopAudioStreaming = useCallback(() => {
    console.log(`[STT] stopAudioStreaming=${(Date.now() / 1000).toFixed(3)}`);

    if (silenceCheckTimerRef.current) {
      clearTimeout(silenceCheckTimerRef.current);
      silenceCheckTimerRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (processorNodeRef.current) {
      try { processorNodeRef.current.disconnect(); } catch {}
      processorNodeRef.current = null;
    }
    (window as any).__voiceTripProcessor = null;

    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }

    if (boostGainRef.current) {
      try { boostGainRef.current.disconnect(); } catch {}
      boostGainRef.current = null;
    }

    if (silentGainRef.current) {
      try { silentGainRef.current.disconnect(); } catch {}
      silentGainRef.current = null;
    }

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }

    audioContextRef.current = null;

    if (webSpeechRecRef.current) {
      try { webSpeechRecRef.current.stop(); } catch {}
      webSpeechRecRef.current = null;
    }

    accumulatedTurnTextRef.current = '';
    lastInterimRef.current = '';
    speechDetectedRef.current = false;

    setState((prev) => ({
      ...prev,
      isStreaming: false,
      partialTranscript: '',
      isSpeechActive: false,
      speechAudioLevel: 0,
    }));
  }, []);

  // Mount effect: connect WebSocket ONCE on mount
  useEffect(() => {
    connectWebSocket();
    return () => {
      stopAudioStreaming();
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [connectWebSocket, stopAudioStreaming]);

  // Handle active mic transitions only when isMicActive or mediaStream changes
  useEffect(() => {
    if (isMicActive && mediaStream) {
      startAudioStreaming();
    } else {
      stopAudioStreaming();
    }
  }, [isMicActive, mediaStream, startAudioStreaming, stopAudioStreaming]);

  return {
    ...state,
    startAudioStreaming,
    stopAudioStreaming,
    finalizeTurn,
  };
}
