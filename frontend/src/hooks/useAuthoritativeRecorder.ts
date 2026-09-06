import { useState, useRef, useEffect, useCallback } from 'react';
import { getApiBase, getWsBase } from '../config';
import { getSharedAudioContext, unlockAudioContext } from '../utils/audioContext';

// Helper to convert Float32 audio buffer to 16-bit PCM for realtime Deepgram streaming
function convertFloat32ToInt16PCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.tanh(input[i] * 2.5);
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export interface MicrophoneOption {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface RecorderDiagnostics {
  streamActive: boolean;
  trackReadyState: string;
  trackEnabled: boolean;
  trackMuted: boolean;
  selectedDeviceId: string;
  actualDeviceLabel: string;
  sampleRate: number;
  channelCount: number;
  recorderMime: string;
  recordedBytes: number;
  lastError: string | null;
}

export interface STTResult {
  success: boolean;
  text: string;
  rawText: string;
  confidence: number;
  durationSeconds: number;
  audioBytes: number;
  latencyMs: number;
}

// Find best supported audio MIME type for MediaRecorder
export function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidateTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac',
    'audio/wav',
  ];

  for (const type of candidateTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export function useAuthoritativeRecorder(onBargeInSpeechDetected?: () => void) {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [isMonitoringForInterruption, setIsMonitoringForInterruption] = useState<boolean>(false);
  const [micVolume, setMicVolume] = useState<number>(0); // 0 to 100%
  const [devices, setDevices] = useState<MicrophoneOption[]>([
    { deviceId: 'system_default', label: 'Default - System / OS Microphone' },
  ]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('voicetrip_mic_device_id') || 'system_default';
    }
    return 'system_default';
  });
  const [activeDeviceLabel, setActiveDeviceLabel] = useState<string>('None (Mic Inactive)');
  const [recorderMime, setRecorderMime] = useState<string>(() => getSupportedAudioMimeType());
  const [recordedBytes, setRecordedBytes] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const [diagnostics, setDiagnostics] = useState<RecorderDiagnostics>({
    streamActive: false,
    trackReadyState: 'inactive',
    trackEnabled: false,
    trackMuted: false,
    selectedDeviceId: 'system_default',
    actualDeviceLabel: 'None',
    sampleRate: 48000,
    channelCount: 1,
    recorderMime: getSupportedAudioMimeType(),
    recordedBytes: 0,
    lastError: null,
  });

  // Audio Graph Refs
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const stopPromiseResolverRef = useRef<((blob: Blob) => void) | null>(null);
  const webSpeechRecRef = useRef<any>(null);

  // Interruption / Barge-in detection refs (~800ms sustained speech threshold)
  const onBargeInRef = useRef(onBargeInSpeechDetected);
  onBargeInRef.current = onBargeInSpeechDetected;
  const isMonitoringRef = useRef<boolean>(false);
  const consecutiveSpeechFramesRef = useRef<number>(0);
  const hasTriggeredInterruptionRef = useRef<boolean>(false);
  const monitoringStartTimeRef = useRef<number>(0);

  // Enumerate microphones
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');

      const formatted: MicrophoneOption[] = [
        { deviceId: 'system_default', label: 'Default - System / OS Microphone' },
        ...audioInputs.map((d, idx) => ({
          deviceId: d.deviceId || `device_${idx}`,
          label: d.label || `Microphone ${idx + 1} (${d.deviceId.slice(0, 8)})`,
          groupId: d.groupId,
        })),
      ];

      setDevices(formatted);
    } catch (err) {
      console.warn('[RECORDER] enumerateDevices failed:', err);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  // Clean up recording tracks & audio graph
  const stopStreamAndMeter = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {}
      processorNodeRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }

    setMicVolume(0);
    consecutiveSpeechFramesRef.current = 0;
    hasTriggeredInterruptionRef.current = false;
    isMonitoringRef.current = false;
    setIsMonitoringForInterruption(false);
  }, []);

  // Internal helper to acquire stream with AEC/NS/AGC
  const acquireStream = useCallback(async (): Promise<MediaStream> => {
    const baseConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    let constraints: MediaStreamConstraints = {
      audio: baseConstraints,
    };

    if (selectedDeviceId && selectedDeviceId !== 'system_default') {
      constraints = {
        audio: {
          ...baseConstraints,
          deviceId: { exact: selectedDeviceId },
        },
      };
    }

    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('[RECORDER] Exact device constraint failed, using default audio:', err);
      return await navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
    }
  }, [selectedDeviceId]);

  // Attach AnalyserNode to stream for real-time audio volume and barge-in detection
  const setupAudioMeterAndVAD = useCallback(
    (stream: MediaStream) => {
      try {
        const audioCtx = getSharedAudioContext();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }

        if (sourceNodeRef.current) {
          try {
            sourceNodeRef.current.disconnect();
          } catch {}
        }

        const source = audioCtx.createMediaStreamSource(stream);
        sourceNodeRef.current = source;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        analyserRef.current = analyser;

        source.connect(analyser);

        // Create ScriptProcessor for streaming audio chunks to Deepgram STT websocket
        try {
          const processor = audioCtx.createScriptProcessor(2048, 1, 1);
          processorNodeRef.current = processor;

          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm = convertFloat32ToInt16PCM(inputData);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(pcm);
            }
          };

          source.connect(processor);
          processor.connect(audioCtx.destination);
        } catch (procErr) {
          console.debug('[RECORDER] ScriptProcessor setup notice:', procErr);
        }

        const timeDomainData = new Uint8Array(analyser.frequencyBinCount);
        const freqData = new Uint8Array(analyser.frequencyBinCount);

        const updateMeter = () => {
          if (!analyserRef.current || !streamRef.current) return;

          analyserRef.current.getByteTimeDomainData(timeDomainData);
          analyserRef.current.getByteFrequencyData(freqData);

          // Time domain RMS calculation
          let sumSquares = 0;
          for (let i = 0; i < timeDomainData.length; i++) {
            const norm = (timeDomainData[i] - 128) / 128;
            sumSquares += norm * norm;
          }
          const rms = Math.sqrt(sumSquares / timeDomainData.length);

          // Frequency domain peak
          let freqSum = 0;
          for (let i = 0; i < freqData.length; i++) {
            freqSum += freqData[i];
          }
          const freqAvg = freqSum / freqData.length / 255;

          // Combined responsive level (0 to 100%)
          const combined = Math.max(rms * 2.8, freqAvg * 1.5);
          const level = Math.min(100, Math.round(combined * 100));

          setMicVolume(level);

          // Interruption / Barge-in Detection
          // Requires sustained speech >800ms AND monitoring must have been active for >1000ms
          // (to prevent echo detection from the AI's own audio)
          const monitoringAge = Date.now() - monitoringStartTimeRef.current;
          if (isMonitoringRef.current && level >= 20 && monitoringAge > 1000) {
            consecutiveSpeechFramesRef.current += 1;
            // 36 frames @ 60fps ~= 600ms sustained speech (above echo threshold)
            if (consecutiveSpeechFramesRef.current >= 36 && !hasTriggeredInterruptionRef.current) {
              hasTriggeredInterruptionRef.current = true;
              console.log('[RECORDER] USER_SPEECH_DETECTED during AI speech (>600ms sustained, >1s after monitoring start). Triggering barge-in interruption...');
              if (onBargeInRef.current) {
                onBargeInRef.current();
              }
            }
          } else {
            // Decay frame counter so single clicks or taps don't accumulate
            if (consecutiveSpeechFramesRef.current < 36) {
              consecutiveSpeechFramesRef.current = Math.max(0, consecutiveSpeechFramesRef.current - 3);
            }
          }

          animFrameRef.current = requestAnimationFrame(updateMeter);
        };

        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
        }
        updateMeter();
      } catch (e) {
        console.warn('[RECORDER] Audio meter setup warning:', e);
      }
    },
    []
  );

  // START RECORDING (Full Turn Capture)
  const startRecording = useCallback(async () => {
    setLastError(null);
    stopStreamAndMeter();
    audioChunksRef.current = [];
    hasTriggeredInterruptionRef.current = false;
    consecutiveSpeechFramesRef.current = 0;
    isMonitoringRef.current = false;
    setIsMonitoringForInterruption(false);

    // Ensure AudioContext is unlocked
    await unlockAudioContext().catch(() => {});

    const stream = await acquireStream();
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      const err = 'No audio tracks found in captured MediaStream.';
      console.error('[RECORDER] ' + err);
      setLastError(err);
      throw new Error(err);
    }

    const primaryTrack = audioTracks[0];
    const trackSettings = primaryTrack.getSettings ? primaryTrack.getSettings() : {};
    const label = primaryTrack.label || 'Microphone';

    console.log(
      `[RECORDER] Stream acquired: track="${label}" state="${primaryTrack.readyState}" enabled=${primaryTrack.enabled} sampleRate=${trackSettings.sampleRate || 48000}`
    );

    streamRef.current = stream;
    setActiveDeviceLabel(label);

    setupAudioMeterAndVAD(stream);

    // Connect WebSocket to /api/ws/stt for realtime Deepgram streaming interim transcripts
    try {
      const audioCtx = getSharedAudioContext();
      const rate = audioCtx.sampleRate || 48000;
      const ws = new WebSocket(`${getWsBase()}/api/ws/stt?sample_rate=${rate}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript') {
            const text = (data.text || data.raw_text || '').trim();
            if (text) {
              setInterimTranscript(text);
            }
          }
        } catch {}
      };
      ws.onerror = () => {};
    } catch (e) {
      console.debug('[RECORDER] STT WS connect notice:', e);
    }

    // Set up MediaRecorder with supported MIME type
    const mime = getSupportedAudioMimeType();
    setRecorderMime(mime);

    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (recErr) {
      console.warn('[RECORDER] MediaRecorder initialization with mime failed, using browser default:', recErr);
      recorder = new MediaRecorder(stream);
    }

    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
        const currentTotal = audioChunksRef.current.reduce((acc, c) => acc + c.size, 0);
        setRecordedBytes(currentTotal);
      }
    };

    recorder.onstop = () => {
      const finalMime = recorder.mimeType || mime || 'audio/webm';
      const finalBlob = new Blob(audioChunksRef.current, { type: finalMime });
      console.log(
        `[RECORDER] MediaRecorder stopped. Assembled Blob: size=${finalBlob.size} bytes, type="${finalBlob.type}" (chunks=${audioChunksRef.current.length})`
      );

      setRecordedBytes(finalBlob.size);

      if (stopPromiseResolverRef.current) {
        stopPromiseResolverRef.current(finalBlob);
        stopPromiseResolverRef.current = null;
      }
    };

    recorder.onerror = (err) => {
      console.error('[RECORDER] MediaRecorder runtime error:', err);
      setLastError('MediaRecorder encountered an error.');
    };

    // Request chunks every 250ms for smooth accumulation
    recorder.start(250);
    setIsRecording(true);
    setInterimTranscript('');

    // Optional progressive client-side live speech recognition during active recording
    try {
      const win = typeof window !== 'undefined' ? (window as any) : {};
      const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (SpeechRec) {
        if (webSpeechRecRef.current) {
          try { webSpeechRecRef.current.stop(); } catch {}
        }
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        rec.onresult = (e: any) => {
          let text = '';
          for (let i = 0; i < e.results.length; ++i) {
            text += e.results[i][0].transcript;
          }
          if (text.trim()) {
            setInterimTranscript(text.trim());
          }
        };
        rec.onerror = () => {};
        rec.onend = () => {};
        rec.start();
        webSpeechRecRef.current = rec;
      }
    } catch (e) {
      console.debug('[RECORDER] Web Speech interim notice:', e);
    }

    setDiagnostics({
      streamActive: true,
      trackReadyState: primaryTrack.readyState,
      trackEnabled: primaryTrack.enabled,
      trackMuted: primaryTrack.muted,
      selectedDeviceId,
      actualDeviceLabel: label,
      sampleRate: trackSettings.sampleRate || 48000,
      channelCount: trackSettings.channelCount || 1,
      recorderMime: recorder.mimeType || mime,
      recordedBytes: 0,
      lastError: null,
    });

    console.log(`[RECORDER] Recording STARTED. MIME: ${recorder.mimeType || mime}. Stream will remain ON until user clicks STOP.`);
    refreshDevices();
  }, [acquireStream, setupAudioMeterAndVAD, stopStreamAndMeter, selectedDeviceId, refreshDevices]);

  // ENABLE INTERRUPTION MONITORING (Active during AI Speech)
  // CRITICAL: This must NOT start MediaRecorder or set isRecording=true.
  // It only sets up the audio analyser for barge-in level detection.
  const startInterruptionMonitoring = useCallback(async () => {
    console.log('[RECORDER] Engaging background audio monitoring for barge-in during AI speech (NO recording)...');
    hasTriggeredInterruptionRef.current = false;
    consecutiveSpeechFramesRef.current = 0;
    monitoringStartTimeRef.current = Date.now();

    // Small delay before enabling monitoring to let AI audio settle
    await new Promise(resolve => setTimeout(resolve, 800));

    isMonitoringRef.current = true;
    setIsMonitoringForInterruption(true);

    // If stream already exists and is active, just enable monitoring flag — don't start recording
    if (streamRef.current && streamRef.current.active) {
      return;
    }

    // Otherwise acquire a monitoring-only stream (just analyser, no MediaRecorder)
    try {
      const stream = await acquireStream();
      streamRef.current = stream;
      setupAudioMeterAndVAD(stream);
      // NOTE: No MediaRecorder started, no isRecording set to true
    } catch (err) {
      console.warn('[RECORDER] Could not start interruption monitoring stream:', err);
    }
  }, [acquireStream, setupAudioMeterAndVAD]);

  // STOP INTERRUPTION MONITORING
  const stopInterruptionMonitoring = useCallback(() => {
    isMonitoringRef.current = false;
    setIsMonitoringForInterruption(false);
  }, []);

  // STOP RECORDING AND SEND TO STT
  const stopRecordingAndTranscribe = useCallback(async (): Promise<STTResult> => {
    console.log('[RECORDER] User clicked Stop Mic. Finalizing audio capture...');
    setIsRecording(false);
    isMonitoringRef.current = false;
    setIsMonitoringForInterruption(false);
    setInterimTranscript(''); // Clear interim transcript to prevent stale display

    if (webSpeechRecRef.current) {
      try { webSpeechRecRef.current.stop(); } catch {}
      webSpeechRecRef.current = null;
    }

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      stopStreamAndMeter();
      throw new Error('MediaRecorder is not active.');
    }

    // Wait for MediaRecorder to flush and trigger onstop
    const blobPromise = new Promise<Blob>((resolve) => {
      stopPromiseResolverRef.current = resolve;
    });

    try {
      mediaRecorderRef.current.stop();
    } catch (e) {
      console.warn('[RECORDER] mediaRecorder.stop() exception:', e);
    }

    const finalBlob = await blobPromise;

    // Stop microphone hardware tracks and level meter
    stopStreamAndMeter();

    console.log(`[RECORDER] Final audio blob ready: ${finalBlob.size} bytes (${finalBlob.type})`);

    // Verify audio bytes > 0
    if (!finalBlob || finalBlob.size === 0) {
      const msg = 'Microphone recording failed: 0 audio bytes captured. Please verify microphone permissions.';
      console.error(`[RECORDER] ${msg}`);
      setLastError(msg);
      throw new Error(msg);
    }

    // Send complete recording directly to Deepgram STT endpoint
    const tStart = Date.now();
    console.log(`[STT] Sending ${finalBlob.size} bytes to /api/stt/transcribe (MIME: ${finalBlob.type})...`);

    try {
      const response = await fetch(`${getApiBase()}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': finalBlob.type || 'audio/webm',
        },
        body: finalBlob,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`STT API HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const latency = Date.now() - tStart;

      console.log(
        `[STT] STT response received in ${latency}ms: raw="${data.raw_text}" -> transcript="${data.text}" (confidence: ${data.confidence})`
      );

      return {
        success: true,
        text: data.text || '',
        rawText: data.raw_text || '',
        confidence: data.confidence || 0,
        durationSeconds: data.duration_seconds || 0,
        audioBytes: finalBlob.size,
        latencyMs: latency,
      };
    } catch (sttErr: unknown) {
      const err = sttErr as Error;
      console.error('[STT] Transcription request failed:', err);
      setLastError(`Transcription error: ${err.message}`);
      throw err;
    }
  }, [stopStreamAndMeter]);

  // Cancel recording without transcribing
  const cancelRecording = useCallback(() => {
    console.log('[RECORDER] Cancelling recording...');
    setIsRecording(false);
    isMonitoringRef.current = false;
    setIsMonitoringForInterruption(false);
    setInterimTranscript('');
    if (webSpeechRecRef.current) {
      try { webSpeechRecRef.current.stop(); } catch {}
      webSpeechRecRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    stopStreamAndMeter();
  }, [stopStreamAndMeter]);

  // Switch microphone device selection
  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('voicetrip_mic_device_id', deviceId);
    }
    console.log(`[RECORDER] Selected microphone device: "${deviceId}"`);
  }, []);

  return {
    isRecording,
    interimTranscript,
    isMonitoringForInterruption,
    micVolume,
    devices,
    selectedDeviceId,
    activeDeviceLabel,
    recorderMime,
    recordedBytes,
    diagnostics,
    lastError,
    startRecording,
    startInterruptionMonitoring,
    stopInterruptionMonitoring,
    stopRecordingAndTranscribe,
    cancelRecording,
    selectDevice,
    refreshDevices,
  };
}
