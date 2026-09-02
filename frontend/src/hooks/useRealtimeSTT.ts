import { useState, useEffect, useRef, useCallback } from 'react';

// SpeechRecognition type declarations for browsers
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface STTState {
  isStreaming: boolean;
  partialTranscript: string;
  finalTranscript: string;
  sttProvider: 'deepgram' | 'browser_speech' | 'idle';
  isDeepgramConfigured: boolean;
  latencyMs: number;
  error: string | null;
}

export function useRealtimeSTT(
  mediaStream: MediaStream | null,
  isMicActive: boolean,
  onFinalTranscript?: (text: string) => void
) {
  const [state, setState] = useState<STTState>({
    isStreaming: false,
    partialTranscript: '',
    finalTranscript: '',
    sttProvider: 'idle',
    isDeepgramConfigured: false,
    latencyMs: 0,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechStartTimeRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Connect to backend WebSocket hub
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const wsUrl = 'ws://localhost:8000/api/ws/stt';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('STT WebSocket connected to /api/ws/stt');
        setState((prev) => ({ ...prev, error: null }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'stt_ready') {
            setState((prev) => ({
              ...prev,
              isDeepgramConfigured: data.deepgram_configured,
              sttProvider: data.deepgram_configured ? 'deepgram' : 'browser_speech',
            }));
          } else if (data.type === 'transcript') {
            const text = data.text || '';
            const isFinal = data.is_final || data.speech_final;
            const latency = speechStartTimeRef.current > 0 ? Date.now() - speechStartTimeRef.current : 140;

            setState((prev) => ({
              ...prev,
              partialTranscript: isFinal ? '' : text,
              finalTranscript: isFinal ? text : prev.finalTranscript,
              latencyMs: latency,
            }));

            if (isFinal && text.trim().length > 0 && onFinalTranscript) {
              onFinalTranscript(text.trim());
            }
          } else if (data.type === 'stt_error') {
            setState((prev) => ({ ...prev, error: data.error }));
          }
        } catch (err) {
          console.warn('Error parsing STT message:', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('STT WebSocket error:', err);
        setState((prev) => ({ ...prev, error: 'STT connection interrupted' }));
      };

      ws.onclose = () => {
        console.log('STT WebSocket closed; scheduling reconnect...');
        wsRef.current = null;
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectWebSocket();
        }, 2500);
      };
    } catch (e) {
      console.warn('Could not establish STT WebSocket:', e);
    }
  }, [onFinalTranscript]);

  // Start audio streaming to backend
  const startAudioStreaming = useCallback(() => {
    if (!mediaStream) return;

    speechStartTimeRef.current = Date.now();
    setState((prev) => ({ ...prev, isStreaming: true, partialTranscript: '', error: null }));

    // 1. Stream binary chunks over WebSocket
    try {
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = new MediaRecorder(mediaStream, supportedMime ? { mimeType: supportedMime } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
      };

      recorder.start(150); // 150ms slices for responsive streaming
      console.log('MediaRecorder streaming started with mimeType:', recorder.mimeType);
    } catch (err) {
      console.warn('MediaRecorder streaming setup failed:', err);
    }

    // 2. Parallel Web Speech Recognition (for instant browser real speech & fallback)
    const win = window as WindowWithSpeech;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        speechRecRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }

          const latency = speechStartTimeRef.current > 0 ? Date.now() - speechStartTimeRef.current : 120;

          if (interim) {
            setState((prev) => ({ ...prev, partialTranscript: interim, latencyMs: latency }));
            // Echo to WebSocket hub
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'client_transcript', text: interim, is_final: false }));
            }
          }

          if (final) {
            setState((prev) => ({ ...prev, partialTranscript: '', finalTranscript: final, latencyMs: latency }));
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'client_transcript', text: final, is_final: true }));
            }
            if (onFinalTranscript) {
              onFinalTranscript(final.trim());
            }
          }
        };

        recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
          if (e.error !== 'no-speech') {
            console.warn('SpeechRecognition event notice:', e.error);
          }
        };

        recognition.start();
        console.log('Speech recognition active');
      } catch (speechErr) {
        console.warn('SpeechRecognition initialization error:', speechErr);
      }
    }
  }, [mediaStream, onFinalTranscript]);

  // Stop audio streaming
  const stopAudioStreaming = useCallback(() => {
    setState((prev) => ({ ...prev, isStreaming: false }));

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {}
      speechRecRef.current = null;
    }
  }, []);

  // Initialize WebSocket connection on mount
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      stopAudioStreaming();
    };
  }, [connectWebSocket, stopAudioStreaming]);

  // Start or stop streaming based on mic active status
  useEffect(() => {
    if (isMicActive && mediaStream) {
      startAudioStreaming();
    } else {
      stopAudioStreaming();
    }
  }, [isMicActive, mediaStream, startAudioStreaming, stopAudioStreaming]);

  return {
    isStreaming: state.isStreaming,
    partialTranscript: state.partialTranscript,
    finalTranscript: state.finalTranscript,
    sttProvider: state.sttProvider,
    isDeepgramConfigured: state.isDeepgramConfigured,
    latencyMs: state.latencyMs,
    error: state.error,
    startAudioStreaming,
    stopAudioStreaming,
  };
}
