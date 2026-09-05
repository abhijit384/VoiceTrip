import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, LocalAudioTrack, RoomEvent } from 'livekit-client';
import { getWsBase, getApiBase } from '../config';
import type { PipelineInitState } from '../types/voice';

export type LiveKitConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type MicPermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

export type AudioInputType = 'system_default' | 'communications_default' | 'physical';

export interface AppAudioInputOption {
  id: string; // 'system_default' | 'communications_default' | raw deviceId
  type: AudioInputType;
  label: string;
  rawDeviceId: string;
  groupId?: string;
}

export interface DeviceDiagnostics {
  selectedDeviceId: string;
  selectedDeviceLabel: string;
  actualDeviceId: string;
  actualLabel: string;
  sampleRate: number;
  channelCount: number;
  readyState: string;
  enabled: boolean;
  muted: boolean;
  usedExactConstraint: boolean;
  audioDetected: boolean;
  sttStatus: 'WORKING' | 'NOT WORKING' | 'IDLE' | 'CONNECTING';
  warningMessage?: string | null;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

interface LiveKitSessionState {
  status: LiveKitConnectionStatus;
  micPermission: MicPermissionStatus;
  isMicActive: boolean;
  micVolume: number; // 0 to 100 (60fps realtime RMS + frequency audio level)
  rawTranscript: string;
  partialTranscript: string;
  finalTranscript: string;
  isStreaming: boolean;
  isSpeechActive: boolean;
  vadState: 'SPEECH_DETECTED' | 'SILENCE_NOISE_FLOOR';
  sttProvider: 'deepgram' | 'web_speech' | 'idle';
  pipelineState: PipelineInitState;
  latencyMs: number;
  errorMessage: string | null;
  roomName: string | null;
  participantId: string | null;
  isCloudConfigured: boolean;
  mediaStream: MediaStream | null;
  audioTrackPublished: boolean;
  trackCount: number;
  activeDeviceLabel: string;
  diagnostics: DeviceDiagnostics | null;
  // Test microphone state
  isTestingMic: boolean;
  testMicVolume: number;
  testMicError: string | null;
  latestCorrections: Array<{ from: string; to: string; rule: string; description?: string }>;
  latestEntities: Record<string, string | null>;
  sttModel: string;
  sttEndpoint: string;
  turnEvent: string;
  turnConfidence: number;
  eotThreshold: number;
  eagerEotThreshold: number;
  eotTimeoutMs: number;
}

// Convert Float32 audio samples directly to pristine 16-bit linear PCM
function convertFloat32ToInt16PCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Authoritative getUserMedia helper that strictly distinguishes:
// 1. System Default (no deviceId constraint, uses browser/OS default capture)
// 2. Windows Communications Default ({ ideal: "communications" })
// 3. Physical Hardware Devices ({ exact: deviceId } with { ideal: deviceId } fallback)
async function acquireAuthoritativeMicrophoneStream(
  selectedId: string
): Promise<{ stream: MediaStream; usedExact: boolean }> {
  const baseConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  // Case 1: System Default -> explicitly DO NOT pass deviceId constraint
  if (selectedId === 'system_default' || !selectedId) {
    console.log('[MIC] Requesting OS / Browser System Default microphone (unconstrained capture with AEC/NS/AGC)');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: baseConstraints,
    });
    return { stream, usedExact: false };
  }

  // Case 2: Windows Communications Default
  if (selectedId === 'communications_default' || selectedId === 'communications') {
    console.log('[MIC] Requesting Windows Communications Default endpoint');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { ideal: 'communications' },
        },
      });
      return { stream, usedExact: false };
    } catch {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: 'communications',
        },
      });
      return { stream, usedExact: false };
    }
  }

  // Case 3: Physical Hardware Device with actual deviceId
  console.log(`[MIC] Requesting physical microphone with deviceId: "${selectedId}"`);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...baseConstraints,
        deviceId: { exact: selectedId },
      },
    });
    return { stream, usedExact: true };
  } catch (err: unknown) {
    const error = err as Error;
    console.warn(`[MIC] Exact constraint failed on physical device "${selectedId}" (${error.name}: ${error.message}). Falling back to ideal constraint.`);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...baseConstraints,
        deviceId: { ideal: selectedId },
      },
    });
    return { stream, usedExact: false };
  }
}

export function useLiveKitSession(
  onFinalTranscript?: (text: string) => void,
  onSpeechStart?: () => void,
  currentGenerationId: string = 'gen_1'
) {
  const [state, setState] = useState<LiveKitSessionState>({
    status: 'disconnected',
    micPermission: 'prompt',
    isMicActive: false,
    micVolume: 0,
    rawTranscript: '',
    partialTranscript: '',
    finalTranscript: '',
    isStreaming: false,
    isSpeechActive: false,
    vadState: 'SILENCE_NOISE_FLOOR',
    sttProvider: 'idle',
    pipelineState: 'INITIALIZING',
    latencyMs: 0,
    errorMessage: null,
    roomName: null,
    participantId: null,
    isCloudConfigured: false,
    mediaStream: null,
    audioTrackPublished: false,
    trackCount: 0,
    activeDeviceLabel: 'None (Mic Inactive)',
    diagnostics: null,
    isTestingMic: false,
    testMicVolume: 0,
    testMicError: null,
    latestCorrections: [],
    latestEntities: {},
    sttModel: 'flux-general-en',
    sttEndpoint: '/v2/listen',
    turnEvent: 'None',
    turnConfidence: 0.0,
    eotThreshold: 0.7,
    eagerEotThreshold: 0.6,
    eotTimeoutMs: 1200,
  });

  const [audioOptions, setAudioOptions] = useState<AppAudioInputOption[]>([
    { id: 'system_default', type: 'system_default', label: 'System Default', rawDeviceId: '' },
  ]);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('voicetrip_mic_device_id') || 'system_default';
    }
    return 'system_default';
  });

  const selectedDeviceIdRef = useRef<string>(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;
  const audioOptionsRef = useRef<AppAudioInputOption[]>(audioOptions);
  audioOptionsRef.current = audioOptions;

  // Audio Graph Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const zeroAudioLoggedRef = useRef<boolean>(false);
  const micStartTimeRef = useRef<number>(0);
  const maxObservedVolumeRef = useRef<number>(0);

  // Dedicated In-App Microphone Test Refs
  const testStreamRef = useRef<MediaStream | null>(null);
  const testAudioCtxRef = useRef<AudioContext | null>(null);
  const testAnimFrameRef = useRef<number | null>(null);

  // LiveKit / WebSocket Refs
  const roomRef = useRef<Room | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Turn Buffers & Barge-In Refs
  const currentGenRef = useRef<string>(currentGenerationId);
  currentGenRef.current = currentGenerationId;
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;
  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const speechDetectedRef = useRef<boolean>(false);
  const accumulatedTurnTextRef = useRef<string>('');
  const accumulatedRawTextRef = useRef<string>('');
  const lastInterimRef = useRef<string>('');
  const silenceTimerRef = useRef<number | null>(null);
  const isSTTReadyRef = useRef<boolean>(false);
  const firstAudioSentLogged = useRef<boolean>(false);
  const noiseFloorRef = useRef<number>(0.003);
  const consecutiveSpeechFramesRef = useRef<number>(0);

  // Helper to finalize a continuous turn automatically
  const finalizeTurn = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const fullUtterance = (
      accumulatedTurnTextRef.current +
      (lastInterimRef.current ? ` ${lastInterimRef.current}` : '')
    ).trim();
    const finalRaw = (
      accumulatedRawTextRef.current || fullUtterance
    ).trim();

    // Validation Gate: Ensure turn contains real speech tokens
    const cleaned = fullUtterance.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const noiseWords = new Set(['uh', 'um', 'ah', 'er', 'mm', 'hmm', 'huh', 'the', 'a', 'an']);

    const isMeaningful =
      words.length >= 2 ||
      (words.length === 1 && !noiseWords.has(words[0].toLowerCase()) && words[0].length >= 2);

    if (isMeaningful && cleaned.length >= 2) {
      const tFinal = Date.now() / 1000;
      console.log(`[STT] turn_finalized_auto=${tFinal.toFixed(3)} text="${fullUtterance}" raw="${finalRaw}" gen=${currentGenRef.current}`);

      setState((prev) => ({
        ...prev,
        partialTranscript: '',
        finalTranscript: fullUtterance,
        rawTranscript: finalRaw,
        isSpeechActive: false,
        turnEvent: 'TurnComplete',
      }));

      if (onFinalTranscriptRef.current) {
        onFinalTranscriptRef.current(fullUtterance);
      }
    } else if (fullUtterance.length > 0) {
      console.log(`[STT-GATE] Filtered non-speech noise / transient fragment: "${fullUtterance}"`);
      setState((prev) => ({
        ...prev,
        partialTranscript: '',
        isSpeechActive: false,
        turnEvent: 'NoiseFiltered',
      }));
    }

    accumulatedTurnTextRef.current = '';
    accumulatedRawTextRef.current = '';
    lastInterimRef.current = '';
    speechDetectedRef.current = false;
    consecutiveSpeechFramesRef.current = 0;
  }, []);

  // Enumerate hardware devices with robust deviceId extraction & full metadata logging
  const refreshDevices = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const rawInputs = devices.filter((d) => d.kind === 'audioinput');

        console.log(`[MIC ENUMERATION METADATA] Found ${rawInputs.length} raw audio inputs:`);
        rawInputs.forEach((d, idx) => {
          console.log(`Input #${idx + 1}:`, {
            label: d.label || '(unlabeled)',
            deviceId: d.deviceId,
            groupId: d.groupId,
            kind: d.kind,
          });
        });

        setAvailableDevices(rawInputs);

        // Build Application-Level Choices:
        // 1. System Default
        // 2. Windows Communications Default (if exposed)
        // 3. Physical audioinput devices
        const options: AppAudioInputOption[] = [
          {
            id: 'system_default',
            type: 'system_default',
            label: 'System Default',
            rawDeviceId: '',
          },
        ];

        const hasComm = rawInputs.some(
          (d) => d.deviceId === 'communications' || d.label.toLowerCase().includes('communications')
        );
        if (hasComm) {
          options.push({
            id: 'communications_default',
            type: 'communications_default',
            label: 'Windows Communications Default',
            rawDeviceId: 'communications',
          });
        }

        // Add physical devices (excluding raw 'default' or 'communications' strings to avoid confusing duplicates)
        rawInputs.forEach((d) => {
          if (d.deviceId !== 'default' && d.deviceId !== 'communications') {
            options.push({
              id: d.deviceId,
              type: 'physical',
              label: d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`,
              rawDeviceId: d.deviceId,
              groupId: d.groupId,
            });
          }
        });

        setAudioOptions(options);

        // Validate or restore selected device
        setSelectedDeviceId((current) => {
          if (!current) {
            const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('voicetrip_mic_device_id') : null;
            if (saved && options.some((o) => o.id === saved)) {
              return saved;
            }
            return 'system_default';
          }
          const exists = options.some((o) => o.id === current);
          if (!exists && options.length > 0) {
            console.warn(`[MIC] Selected device "${current}" is no longer available. Falling back to System Default.`);
            return 'system_default';
          }
          return current;
        });
      }
    } catch (e) {
      console.warn('enumerateDevices error:', e);
    }
  }, []);

  // Cleanly teardown main audio graph and WebSocket
  const cleanupAudioPipeline = useCallback(() => {
    console.log(`[SESSION] cleanupAudioPipeline=${(Date.now() / 1000).toFixed(3)}`);

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    (window as any).__voiceTripProcessor = null;

    if (silentGainRef.current) {
      try { silentGainRef.current.disconnect(); } catch {}
      silentGainRef.current = null;
    }

    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }

    if (boostGainRef.current) {
      try { boostGainRef.current.disconnect(); } catch {}
      boostGainRef.current = null;
    }

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== 'closed') {
          audioCtxRef.current.close();
        }
      } catch {}
      audioCtxRef.current = null;
    }

    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    isSTTReadyRef.current = false;

    if (audioTrackRef.current) {
      try { audioTrackRef.current.stop(); } catch {}
      audioTrackRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
        console.log(`[SESSION] stopped_track=${t.label} (deviceId=${t.getSettings ? t.getSettings().deviceId : 'n/a'})`);
      });
      streamRef.current = null;
    }

    if (roomRef.current) {
      try { roomRef.current.disconnect(); } catch {}
      roomRef.current = null;
    }

    accumulatedTurnTextRef.current = '';
    lastInterimRef.current = '';
    speechDetectedRef.current = false;
    zeroAudioLoggedRef.current = false;
    maxObservedVolumeRef.current = 0;
  }, []);

  // Stop dedicated in-app mic test
  const stopMicrophoneTest = useCallback(() => {
    if (testAnimFrameRef.current) {
      cancelAnimationFrame(testAnimFrameRef.current);
      testAnimFrameRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      testStreamRef.current = null;
    }
    if (testAudioCtxRef.current) {
      try {
        if (testAudioCtxRef.current.state !== 'closed') {
          testAudioCtxRef.current.close();
        }
      } catch {}
      testAudioCtxRef.current = null;
    }
    setState((prev) => ({ ...prev, isTestingMic: false, testMicVolume: 0, testMicError: null }));
  }, []);

  // Start dedicated in-app mic test for the selected device
  const startMicrophoneTest = useCallback(async (deviceIdToTest?: string) => {
    stopMicrophoneTest();
    const devId = deviceIdToTest || selectedDeviceIdRef.current;
    console.log(`[MIC TEST] Starting test on device: "${devId}"`);

    setState((prev) => ({ ...prev, isTestingMic: true, testMicVolume: 0, testMicError: null }));

    try {
      const { stream } = await acquireAuthoritativeMicrophoneStream(devId);
      testStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      testAudioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;

      const boost = audioCtx.createGain();
      boost.gain.value = 4.0;
      source.connect(boost);
      boost.connect(analyser);

      const silent = audioCtx.createGain();
      silent.gain.value = 0.00001;
      analyser.connect(silent);
      silent.connect(audioCtx.destination);

      const timeData = new Float32Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const checkAudio = () => {
        if (!testStreamRef.current) return;
        analyser.getFloatTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);

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
        const normalized = Math.min(1, Math.max(rms * 5, freqLevel * 2));
        const volume = Math.round(normalized * 100);

        setState((prev) => (prev.testMicVolume === volume ? prev : { ...prev, testMicVolume: volume }));
        testAnimFrameRef.current = requestAnimationFrame(checkAudio);
      };

      testAnimFrameRef.current = requestAnimationFrame(checkAudio);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[MIC TEST] Test failed:', error);
      setState((prev) => ({
        ...prev,
        isTestingMic: false,
        testMicError: `Microphone test error: ${error.message || error.name}`,
      }));
    }
  }, [stopMicrophoneTest]);

  // Disconnect session and release microphone cleanly
  const disconnect = useCallback(() => {
    console.log(`[SESSION] user_disconnect=${(Date.now() / 1000).toFixed(3)}`);
    cleanupAudioPipeline();

    setState((prev) => ({
      ...prev,
      status: 'disconnected',
      isMicActive: false,
      micVolume: 0,
      isStreaming: false,
      isSpeechActive: false,
      partialTranscript: '',
      rawTranscript: '',
      pipelineState: 'INITIALIZING',
      mediaStream: null,
      audioTrackPublished: false,
      trackCount: 0,
      activeDeviceLabel: 'None (Mic Inactive)',
      diagnostics: null,
      errorMessage: null,
    }));
  }, [cleanupAudioPipeline]);

  // Connect to Realtime Audio Pipeline with dynamic device selection
  const connect = useCallback(
    async (roomName: string = 'voicetrip-room', targetDeviceId?: string) => {
      const deviceToUse = targetDeviceId !== undefined ? targetDeviceId : selectedDeviceIdRef.current;
      console.log(`[SESSION] start_connect room="${roomName}" targetDevice="${deviceToUse}"`);
      cleanupAudioPipeline();

      setState((prev) => ({
        ...prev,
        status: 'connecting',
        pipelineState: 'INITIALIZING',
        errorMessage: null,
      }));

      // ==============================================================================
      // STEP 1: TOKEN REQUEST FROM BACKEND
      // ==============================================================================
      const tokenUrl = `${getApiBase()}/api/livekit/token`;
      console.log(`[LIVEKIT] Requesting participant token from: ${tokenUrl}`);

      let serverUrl = '';
      let participantToken = '';
      let isConfigured = false;
      let identity = '';

      try {
        const tokenRes = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_name: roomName, participant_name: 'Traveler' }),
        });

        console.log(`[LIVEKIT] Token endpoint HTTP status: ${tokenRes.status}`);

        if (!tokenRes.ok) {
          const errData = await tokenRes.json().catch(() => ({}));
          const errMsg = errData.detail?.message || errData.detail || `HTTP ${tokenRes.status}`;
          throw new Error(`Token endpoint failed: ${errMsg}`);
        }

        const data = await tokenRes.json();
        serverUrl = data.server_url || data.url || '';
        participantToken = data.participant_token || data.token || '';
        isConfigured = Boolean(data.is_livekit_configured);
        identity = data.participant_identity || '';

        console.log('[LIVEKIT TOKEN RESULT]', {
          serverUrlConfigured: Boolean(serverUrl && !serverUrl.includes('placeholder') && !serverUrl.includes('your-livekit-project')),
          tokenReceived: Boolean(participantToken),
          participantIdentity: identity,
          isConfigured,
        });
      } catch (tokenErr: unknown) {
        const err = tokenErr as Error;
        console.error('[LIVEKIT] Token Request Error:', err);
        const failMessage = `LiveKit connection failed: Backend token endpoint unreachable (${err.message}). Verify backend is running at ${getApiBase()}.`;
        setState((prev) => ({
          ...prev,
          status: 'error',
          isCloudConfigured: false,
          errorMessage: failMessage,
        }));
        // DO NOT silently fall back to local audio mode!
        return;
      }

      // ==============================================================================
      // STEP 2: VERIFY LIVEKIT CLOUD URL
      // ==============================================================================
      const isPlaceholderUrl =
        !serverUrl ||
        serverUrl.includes('your-livekit-project') ||
        serverUrl.includes('placeholder') ||
        serverUrl.includes('local-mock');

      if (isPlaceholderUrl) {
        console.error('[LIVEKIT CONNECT] Connect: FAILURE');
        console.error('Error type: PlaceholderConfigError');
        console.error(`Error message: LIVEKIT_URL is placeholder "${serverUrl}"`);

        const failMessage = `LiveKit connection failed: LIVEKIT_URL is not configured with your LiveKit Cloud websocket URL (found placeholder '${serverUrl}'). Please set your real LiveKit Cloud URL (wss://<project>.livekit.cloud) in .env.`;

        setState((prev) => ({
          ...prev,
          status: 'error',
          isCloudConfigured: false,
          errorMessage: failMessage,
        }));
        // DO NOT silently fall back to local audio mode!
        return;
      }

      // ==============================================================================
      // STEP 3: CONNECT TO LIVEKIT ROOM
      // ==============================================================================
      console.log('LiveKit URL: configured');
      console.log('Token: received');

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      room
        .on(RoomEvent.Connected, () => {
          console.log('[LIVEKIT] Connect: SUCCESS');
          console.log('Room connected: YES');
          setState((prev) => ({
            ...prev,
            status: 'connected',
            isCloudConfigured: true,
            roomName,
            participantId: identity,
            errorMessage: null,
          }));
        })
        .on(RoomEvent.Reconnecting, () => {
          console.log('[LIVEKIT] Room reconnecting...');
          setState((prev) => ({ ...prev, status: 'reconnecting' }));
        })
        .on(RoomEvent.Reconnected, () => {
          console.log('[LIVEKIT] Room reconnected');
          setState((prev) => ({ ...prev, status: 'connected' }));
        })
        .on(RoomEvent.Disconnected, (reason) => {
          console.log('[LIVEKIT] Room disconnected:', reason);
          setState((prev) => ({
            ...prev,
            status: 'disconnected',
            audioTrackPublished: false,
          }));
        });

      try {
        await room.connect(serverUrl, participantToken);
      } catch (connErr: unknown) {
        const err = connErr as Error;
        console.error('[LIVEKIT] Connect: FAILURE');
        console.error(`Error type: ${err.name || 'RoomConnectionError'}`);
        console.error(`Error message: ${err.message || String(err)}`);

        const failMessage = `LiveKit connection failed: Could not connect to LiveKit Cloud at ${serverUrl} (${err.message}).`;
        setState((prev) => ({
          ...prev,
          status: 'error',
          isCloudConfigured: false,
          errorMessage: failMessage,
        }));
        // DO NOT silently fall back to local audio mode!
        return;
      }

      // ==============================================================================
      // STEP 4: ACQUIRE AUTHORITATIVE MICROPHONE & PUBLISH TRACK TO LIVEKIT ROOM
      // ==============================================================================
      // Check browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          micPermission: 'unsupported',
          errorMessage: 'Your browser does not support microphone audio capture.',
        }));
        return;
      }

      let stream: MediaStream;
      let usedExactConstraint = false;

      try {
        const tMicReq = Date.now() / 1000;
        console.log(`[SESSION] acquireAuthoritativeMicrophoneStream call=${tMicReq.toFixed(3)} device="${deviceToUse}"`);
        const result = await acquireAuthoritativeMicrophoneStream(deviceToUse);
        stream = result.stream;
        usedExactConstraint = result.usedExact;
        streamRef.current = stream;

        const tracks = stream.getAudioTracks();
        if (tracks.length === 0) {
          throw new Error('No audio tracks found in captured MediaStream.');
        }

        const firstTrack = tracks[0];
        const initialSettings = firstTrack.getSettings ? firstTrack.getSettings() : ({} as MediaTrackSettings);
        console.log('[MIC TRACK ACQUIRED]', {
          label: firstTrack.label,
          readyState: firstTrack.readyState,
          enabled: firstTrack.enabled,
          muted: firstTrack.muted,
          deviceId: initialSettings.deviceId,
          groupId: initialSettings.groupId,
          selectedDevice: deviceToUse,
          usedExactConstraint,
        });

        // Wrap in LiveKit LocalAudioTrack
        const localTrack = new LocalAudioTrack(firstTrack, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        audioTrackRef.current = localTrack;

        // Publish track to LiveKit Room
        const publication = await room.localParticipant.publishTrack(localTrack);
        console.log('Mic track published: YES', {
          trackSid: publication?.trackSid,
          trackName: publication?.trackName,
        });

        // Device selection via LiveKit switchActiveDevice if physical device requested
        if (deviceToUse && deviceToUse !== 'system_default' && deviceToUse !== 'communications_default') {
          try {
            await room.switchActiveDevice('audioinput', deviceToUse);
            console.log(`[LIVEKIT] Switched active audioinput device to: "${deviceToUse}"`);
          } catch (devErr) {
            console.warn('[LIVEKIT] switchActiveDevice notice:', devErr);
          }
        }

        const deviceLabel = firstTrack.label || 'Microphone';
        const matchedOption = audioOptionsRef.current.find((o) => o.id === deviceToUse);

        firstTrack.onended = () => {
          console.warn('[SESSION] Microphone track ended unexpectedly');
          disconnect();
        };

        firstTrack.onmute = () => {
          console.warn('[SESSION] Microphone hardware muted by OS or physical switch');
        };

        firstTrack.onunmute = () => {
          console.log('[SESSION] Microphone hardware unmuted');
        };

        const diagnostics: DeviceDiagnostics = {
          selectedDeviceId: deviceToUse,
          selectedDeviceLabel: matchedOption?.label || deviceLabel,
          actualDeviceId: initialSettings.deviceId || '',
          actualLabel: firstTrack.label || deviceLabel,
          sampleRate: initialSettings.sampleRate || 48000,
          channelCount: initialSettings.channelCount || 1,
          readyState: firstTrack.readyState,
          enabled: firstTrack.enabled,
          muted: firstTrack.muted,
          usedExactConstraint,
          audioDetected: false,
          sttStatus: 'CONNECTING',
          warningMessage: null,
          echoCancellation: typeof initialSettings.echoCancellation === 'boolean' ? initialSettings.echoCancellation : true,
          noiseSuppression: typeof initialSettings.noiseSuppression === 'boolean' ? initialSettings.noiseSuppression : true,
          autoGainControl: typeof initialSettings.autoGainControl === 'boolean' ? initialSettings.autoGainControl : true,
        };

        setState((prev) => ({
          ...prev,
          micPermission: 'granted',
          isMicActive: true,
          mediaStream: stream,
          audioTrackPublished: true,
          trackCount: tracks.length,
          activeDeviceLabel: deviceLabel,
          diagnostics,
          status: 'connected',
          pipelineState: 'MIC_READY',
        }));

        refreshDevices();
      } catch (err: unknown) {
        const error = err as Error;
        console.error('[SESSION] Microphone capture / publish error:', error);
        let errorMsg = `Microphone error: ${error.message || error.name}`;

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          errorMsg = 'Microphone access denied. Please click the lock icon in the URL bar to allow microphone access.';
        } else if (error.name === 'OverconstrainedError') {
          errorMsg = 'Selected microphone cannot satisfy audio constraints. Falling back to default device...';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          errorMsg = 'Selected microphone hardware was not found. Please select another audio device.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          errorMsg = 'Selected microphone is currently locked or in use by another application.';
        }

        setState((prev) => ({
          ...prev,
          status: 'error',
          micPermission: error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' ? 'denied' : 'prompt',
          errorMessage: errorMsg,
        }));
        return;
      }

      // Step 3: Initialize Dedicated AudioContext (Single Authoritative Audio Graph)
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        console.log(`[SESSION] AudioContext_created state=${audioCtx.state} sampleRate=${audioCtx.sampleRate}Hz`);

        if (audioCtx.state === 'suspended') {
          console.log('[SESSION] AudioContext suspended; calling resume()...');
          await audioCtx.resume();
          console.log(`[SESSION] AudioContext resumed! state=${audioCtx.state}`);
        }

        // Step 4: Build High-Performance Audio Graph from the selected stream
        const source = audioCtx.createMediaStreamSource(stream);
        sourceNodeRef.current = source;

        // AnalyserNode for 60 FPS Volume Meter and Speech Band VAD
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        analyserRef.current = analyser;

        const boostGain = audioCtx.createGain();
        boostGain.gain.value = 1.0;
        boostGainRef.current = boostGain;

        source.connect(boostGain);
        boostGain.connect(analyser);

        // Silent pull gain to destination to ensure Chrome engine keeps audio clock running
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0.00001;
        silentGainRef.current = silentGain;
        analyser.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        // 60 FPS Realtime Render Loop with Multi-stage Speech Band VAD
        const timeData = new Float32Array(analyser.fftSize);
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        let lastRenderTime = 0;
        micStartTimeRef.current = Date.now();
        zeroAudioLoggedRef.current = false;
        maxObservedVolumeRef.current = 0;

        const renderAudio = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getFloatTimeDomainData(timeData);
          analyserRef.current.getByteFrequencyData(freqData);

          // Calculate time-domain RMS
          let sumSquares = 0;
          for (let i = 0; i < timeData.length; i++) {
            sumSquares += timeData[i] * timeData[i];
          }
          const rms = Math.sqrt(sumSquares / timeData.length);

          // Calculate speech band energy (300Hz - 3400Hz: bins 6 to 72 at 1024 FFT / 48kHz) vs total energy
          let speechBandSum = 0;
          let totalFreqSum = 0;
          for (let i = 0; i < freqData.length; i++) {
            const val = freqData[i];
            totalFreqSum += val;
            if (i >= 6 && i <= 72) {
              speechBandSum += val;
            }
          }
          const freqLevel = (totalFreqSum / freqData.length) / 255;
          const speechRatio = totalFreqSum > 0 ? speechBandSum / totalFreqSum : 0;

          // Adaptive Quiescent Noise Floor Tracking (EMA)
          if (rms < noiseFloorRef.current * 1.8) {
            noiseFloorRef.current = Math.max(0.002, Math.min(0.05, 0.97 * noiseFloorRef.current + 0.03 * rms));
          }

          // Real Human Speech Activity Detection:
          // Must exceed adaptive noise floor by 2.6x AND fall into human speech frequency envelope (speechRatio > 0.40)
          const isVoicedFrame = rms > Math.max(0.012, noiseFloorRef.current * 2.6) && speechRatio > 0.40;

          // Transient rejection filter: require persistence across multiple frames (>= 70ms) to ignore keyboard taps/clicks
          if (isVoicedFrame) {
            consecutiveSpeechFramesRef.current = Math.min(30, consecutiveSpeechFramesRef.current + 1);
          } else {
            consecutiveSpeechFramesRef.current = Math.max(0, consecutiveSpeechFramesRef.current - 1);
          }

          const isRealSpeechActive = consecutiveSpeechFramesRef.current >= 4;

          // Combined responsive level (0 to 100)
          const normalized = Math.min(1, Math.max(rms * 4, freqLevel * 1.5));
          const volume = Math.round(normalized * 100);
          if (volume > maxObservedVolumeRef.current) {
            maxObservedVolumeRef.current = volume;
          }

          // Step 6 Check: If device is live but returns zero audio after 2 seconds, log: DEVICE DETECTED BUT NO AUDIO
          const elapsed = Date.now() - micStartTimeRef.current;
          if (elapsed > 2000 && maxObservedVolumeRef.current === 0 && !zeroAudioLoggedRef.current) {
            zeroAudioLoggedRef.current = true;
            const currentTrack = streamRef.current?.getAudioTracks()[0];
            console.warn(`[MIC] DEVICE DETECTED BUT NO AUDIO: track="${currentTrack?.label}", deviceId="${currentTrack?.getSettings()?.deviceId}"`);
            setState((prev) => ({
              ...prev,
              diagnostics: prev.diagnostics
                ? {
                    ...prev.diagnostics,
                    audioDetected: false,
                    warningMessage: 'DEVICE DETECTED BUT NO AUDIO (Hardware stream is live, but zero audio amplitude detected. Check Windows mic volume.)',
                  }
                : null,
            }));
          } else if (volume > 2 && zeroAudioLoggedRef.current) {
            zeroAudioLoggedRef.current = false;
            setState((prev) => ({
              ...prev,
              diagnostics: prev.diagnostics
                ? {
                    ...prev.diagnostics,
                    audioDetected: true,
                    warningMessage: null,
                  }
                : null,
            }));
          }

          // Sustained VAD detection for hands-free barge-in (requires >= 12 voiced frames / ~300ms to prevent false triggers)
          if (isRealSpeechActive) {
            if (!speechDetectedRef.current && consecutiveSpeechFramesRef.current >= 12) {
              speechDetectedRef.current = true;
              console.log(`[VAD] real_speech_activity_detected=${(Date.now() / 1000).toFixed(3)} rms=${rms.toFixed(5)} speechRatio=${speechRatio.toFixed(2)} noiseFloor=${noiseFloorRef.current.toFixed(5)}`);
              if (onSpeechStartRef.current) {
                onSpeechStartRef.current();
              }
            }
          } else if (consecutiveSpeechFramesRef.current === 0) {
            speechDetectedRef.current = false;
          }

          const now = Date.now();
          if (now - lastRenderTime > 25) {
            lastRenderTime = now;
            setState((prev) => ({
              ...prev,
              micVolume: volume,
              vadState: isRealSpeechActive ? 'SPEECH_DETECTED' : 'SILENCE_NOISE_FLOOR',
            }));
          }

          animFrameRef.current = requestAnimationFrame(renderAudio);
        };

        renderAudio();

        // Step 5: Full-Duplex ScriptProcessor to Stream 16-bit PCM to Deepgram
        firstAudioSentLogged.current = false;
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        (window as any).__voiceTripProcessor = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const outputData = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < outputData.length; i++) {
            outputData[i] = 0;
          }

          const pcmBuffer = convertFloat32ToInt16PCM(inputData);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && isSTTReadyRef.current) {
            if (!firstAudioSentLogged.current) {
              firstAudioSentLogged.current = true;
              console.log(`[STT] AUDIO FRAME SENT: bytes=${pcmBuffer.byteLength} rate=${audioCtx.sampleRate}Hz`);
            }
            try {
              wsRef.current.send(pcmBuffer);
            } catch (sendErr) {
              console.warn('[STT] Failed to send PCM frame:', sendErr);
            }
          }
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);

        // Step 6: Connect WebSocket to Deepgram STT Hub with auto-reconnect
        const connectSTTWebSocket = () => {
          if (!streamRef.current || !streamRef.current.active) return;
          const wsUrl = `${getWsBase()}/api/ws/stt?sample_rate=${audioCtx.sampleRate}`;
          console.log(`[STT] DEEPGRAM CONNECTING: ${wsUrl}`);
          setState((prev) => ({ ...prev, pipelineState: 'STT_CONNECTING' }));

          try {
            if (wsRef.current) {
              try { wsRef.current.close(); } catch {}
            }
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
              console.log(`[STT] DEEPGRAM CONNECTED=${(Date.now() / 1000).toFixed(3)}`);
              setState((prev) => ({
                ...prev,
                isStreaming: true,
                pipelineState: 'STT_READY',
                diagnostics: prev.diagnostics ? { ...prev.diagnostics, sttStatus: 'WORKING' } : null,
              }));
            };

            ws.onmessage = (event) => {
              try {
                const data = JSON.parse(event.data);

                if (data.type === 'stt_ready') {
                  console.log(`[STT] stt_ready provider=${data.provider} model=${data.model} endpoint=${data.endpoint} eot=${data.eot_threshold} timeout=${data.eot_timeout_ms}ms`);
                  isSTTReadyRef.current = true;
                  setState((prev) => ({
                    ...prev,
                    isCloudConfigured: data.deepgram_configured,
                    sttProvider: data.deepgram_configured ? 'deepgram' : 'web_speech',
                    sttModel: data.model || 'flux-general-en',
                    sttEndpoint: data.endpoint || '/v2/listen',
                    eotThreshold: data.eot_threshold || 0.7,
                    eagerEotThreshold: data.eager_eot_threshold || 0.6,
                    eotTimeoutMs: data.eot_timeout_ms || 1200,
                    pipelineState: 'VOICE_READY',
                    diagnostics: prev.diagnostics ? { ...prev.diagnostics, sttStatus: 'WORKING' } : null,
                  }));
                  return;
                }

                if (data.type === 'transcript') {
                  const text = (data.text || '').trim();
                  const rawText = (data.raw_text || data.text || '').trim();
                  const isFinal = Boolean(data.is_final);
                  const isSpeechFinal = Boolean(data.speech_final) || data.turn_event === 'EndOfTurn';
                  const turnEvent = data.turn_event || (isSpeechFinal ? 'EndOfTurn' : (isFinal ? 'ChunkFinal' : 'Interim'));
                  const turnConfidence = data.confidence !== undefined ? data.confidence : 0.95;
                  const corrections = data.corrections || [];
                  const entities = data.entities || (data.intent ? {
                    origin: data.intent.origin,
                    destination: data.intent.destination,
                    date: data.intent.travel_date,
                    time_constraint: data.intent.time_constraint,
                  } : {});

                  if (text.length === 0 && !isSpeechFinal) return;

                  if (text.length > 0) {
                    // Trigger barge-in immediately when user speech begins
                    if (!speechDetectedRef.current) {
                      speechDetectedRef.current = true;
                      if (onSpeechStartRef.current) {
                        onSpeechStartRef.current();
                      }
                    }
                  }

                  if (isFinal) {
                    accumulatedTurnTextRef.current = (accumulatedTurnTextRef.current + ' ' + text).trim();
                    accumulatedRawTextRef.current = (accumulatedRawTextRef.current + ' ' + rawText).trim();
                    lastInterimRef.current = '';

                    setState((prev) => ({
                      ...prev,
                      rawTranscript: accumulatedRawTextRef.current,
                      partialTranscript: accumulatedTurnTextRef.current,
                      latestCorrections: corrections.length > 0 ? corrections : prev.latestCorrections,
                      latestEntities: entities && Object.keys(entities).length > 0 ? entities : prev.latestEntities,
                      isSpeechActive: true,
                      turnEvent,
                      turnConfidence,
                    }));

                    // If Deepgram Flux signaled EndOfTurn / speech_final, finalize immediately!
                    if (isSpeechFinal) {
                      if (silenceTimerRef.current) {
                        clearTimeout(silenceTimerRef.current);
                        silenceTimerRef.current = null;
                      }
                      finalizeTurn();
                      return;
                    }

                    if (silenceTimerRef.current) {
                      clearTimeout(silenceTimerRef.current);
                    }
                    silenceTimerRef.current = window.setTimeout(() => {
                      finalizeTurn();
                    }, 800);
                  } else {
                    lastInterimRef.current = text;
                    const combined = (accumulatedTurnTextRef.current + ' ' + text).trim();
                    const rawCombined = (accumulatedRawTextRef.current + ' ' + rawText).trim();
                    setState((prev) => ({
                      ...prev,
                      rawTranscript: rawCombined,
                      partialTranscript: combined,
                      latestCorrections: corrections.length > 0 ? corrections : prev.latestCorrections,
                      latestEntities: entities && Object.keys(entities).length > 0 ? entities : prev.latestEntities,
                      isSpeechActive: true,
                      turnEvent,
                      turnConfidence,
                    }));

                    if (isSpeechFinal) {
                      if (silenceTimerRef.current) {
                        clearTimeout(silenceTimerRef.current);
                        silenceTimerRef.current = null;
                      }
                      finalizeTurn();
                    } else {
                      if (silenceTimerRef.current) {
                        clearTimeout(silenceTimerRef.current);
                      }
                      silenceTimerRef.current = window.setTimeout(() => {
                        finalizeTurn();
                      }, 950);
                    }
                  }
                } else if (data.type === 'error') {
                  console.warn('[STT] Backend error:', data.message);
                }
              } catch (e) {
                console.warn('[STT] Failed to parse WebSocket JSON message:', e);
              }
            };

            ws.onerror = (err) => {
              console.warn('[STT] WebSocket error:', err);
              setState((prev) => ({
                ...prev,
                diagnostics: prev.diagnostics ? { ...prev.diagnostics, sttStatus: 'NOT WORKING' } : null,
              }));
            };

            ws.onclose = () => {
              console.log('[STT] WebSocket closed. Checking if auto-reconnection is needed...');
              isSTTReadyRef.current = false;
              if (streamRef.current && streamRef.current.active) {
                console.log('[STT] Stream active: reconnecting WebSocket in 300ms...');
                setTimeout(() => {
                  if (streamRef.current && streamRef.current.active && audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
                    connectSTTWebSocket();
                  }
                }, 300);
              }
            };
          } catch (wsErr) {
            console.warn('[STT] WebSocket initiation error:', wsErr);
          }
        };

        connectSTTWebSocket();
      } catch (audioCtxErr) {
        console.error('[SESSION] Failed to build Web Audio pipeline:', audioCtxErr);
      }
    },
    [cleanupAudioPipeline, finalizeTurn, refreshDevices]
  );

  // Hot Device Switching: switch device without reloading page or killing active conversation! (Step 9)
  const switchDevice = useCallback(
    async (newDeviceId: string) => {
      console.log(`[MIC SWITCH] Requesting switch to device: "${newDeviceId}"`);
      setSelectedDeviceId(newDeviceId);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('voicetrip_mic_device_id', newDeviceId);
      }

      // If mic is currently active, perform hot-swap of the audio track!
      if (state.isMicActive && audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try {
          console.log(`[MIC SWITCH] Hot-swapping capture stream while MIC is ON...`);
          // 1. Acquire new stream first
          const { stream: newStream, usedExact } = await acquireAuthoritativeMicrophoneStream(newDeviceId);
          const tracks = newStream.getAudioTracks();
          if (tracks.length === 0) throw new Error('New stream has zero audio tracks');
          const newTrack = tracks[0];

          // 2. Stop old stream tracks cleanly
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => {
              try { t.stop(); } catch {}
              console.log(`[MIC SWITCH] Stopped old track: ${t.label}`);
            });
          }
          streamRef.current = newStream;

          // 3. Re-route audio graph
          if (sourceNodeRef.current) {
            try { sourceNodeRef.current.disconnect(); } catch {}
          }
          const newSource = audioCtxRef.current.createMediaStreamSource(newStream);
          sourceNodeRef.current = newSource;

          if (boostGainRef.current) {
            newSource.connect(boostGainRef.current);
          }
          if (processorRef.current) {
            newSource.connect(processorRef.current);
          }

          // 4. LiveKit room active device switch if room is connected (Step 3)
          if (roomRef.current && roomRef.current.state === 'connected') {
            try {
              const lkId = newDeviceId === 'system_default' ? 'default' : (newDeviceId === 'communications_default' ? 'communications' : newDeviceId);
              await roomRef.current.switchActiveDevice('audioinput', lkId);
              console.log(`[LIVEKIT] room.switchActiveDevice succeeded for: ${lkId}`);
            } catch (lkErr) {
              console.warn('[LIVEKIT] room.switchActiveDevice notice:', lkErr);
            }
          }

          // 5. Inspect and update track diagnostics
          const settings = newTrack.getSettings ? newTrack.getSettings() : ({} as MediaTrackSettings);
          const matchedOption = audioOptionsRef.current.find((o) => o.id === newDeviceId);

          console.log('[MIC SWITCH VERIFIED TRACK]', {
            selectedOption: matchedOption?.label || newDeviceId,
            actualLabel: newTrack.label,
            actualDeviceId: settings.deviceId,
            groupId: settings.groupId,
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
            readyState: newTrack.readyState,
            enabled: newTrack.enabled,
            muted: newTrack.muted,
            usedExactConstraint: usedExact,
          });

          micStartTimeRef.current = Date.now();
          zeroAudioLoggedRef.current = false;
          maxObservedVolumeRef.current = 0;

          const diagnostics: DeviceDiagnostics = {
            selectedDeviceId: newDeviceId,
            selectedDeviceLabel: matchedOption?.label || newTrack.label,
            actualDeviceId: settings.deviceId || '',
            actualLabel: newTrack.label || '',
            sampleRate: settings.sampleRate || audioCtxRef.current.sampleRate,
            channelCount: settings.channelCount || 1,
            readyState: newTrack.readyState,
            enabled: newTrack.enabled,
            muted: newTrack.muted,
            usedExactConstraint: usedExact,
            audioDetected: false,
            sttStatus: isSTTReadyRef.current ? 'WORKING' : 'CONNECTING',
            warningMessage: null,
            echoCancellation: typeof settings.echoCancellation === 'boolean' ? settings.echoCancellation : true,
            noiseSuppression: typeof settings.noiseSuppression === 'boolean' ? settings.noiseSuppression : true,
            autoGainControl: typeof settings.autoGainControl === 'boolean' ? settings.autoGainControl : true,
          };

          setState((prev) => ({
            ...prev,
            mediaStream: newStream,
            activeDeviceLabel: newTrack.label || 'Microphone',
            diagnostics,
          }));

          console.log(`[MIC SWITCH SUCCESS] Authoritative stream swapped to: "${newTrack.label}" (deviceId: ${settings.deviceId})`);
        } catch (err: unknown) {
          const e = err as Error;
          console.error('[MIC SWITCH ERROR] Failed to switch device:', e);
          setState((prev) => ({
            ...prev,
            errorMessage: `Failed to switch to selected microphone: ${e.message}`,
          }));
        }
      }
    },
    [state.isMicActive]
  );

  // Explicit manual stop: cleans up microphone immediately and returns complete accumulated user transcript
  const stopRecordingAndGetTranscript = useCallback(async (): Promise<string> => {
    // 100ms micro-pause to allow any final in-flight WebSocket STT packets to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    const fullUtterance = (
      accumulatedTurnTextRef.current +
      (lastInterimRef.current ? ` ${lastInterimRef.current}` : '')
    ).trim();
    const finalRaw = (
      accumulatedRawTextRef.current || fullUtterance
    ).trim();

    console.log(`[MANUAL_MIC] Recording stopped manually. Finalized transcript: "${fullUtterance}" (raw: "${finalRaw}")`);

    // Clean up tracks and audio pipeline immediately
    cleanupAudioPipeline();
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch {}
      roomRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      status: 'disconnected',
      isMicActive: false,
      isStreaming: false,
      partialTranscript: '',
      finalTranscript: fullUtterance,
      rawTranscript: finalRaw,
      isSpeechActive: false,
      turnEvent: 'ManualStop',
    }));

    accumulatedTurnTextRef.current = '';
    accumulatedRawTextRef.current = '';
    lastInterimRef.current = '';
    speechDetectedRef.current = false;
    consecutiveSpeechFramesRef.current = 0;

    return fullUtterance;
  }, [cleanupAudioPipeline]);

  // Toggle microphone active/muted
  const toggleMic = useCallback(() => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextEnabled = !audioTracks[0].enabled;
        audioTracks.forEach((track) => {
          track.enabled = nextEnabled;
        });
        setState((prev) => ({
          ...prev,
          isMicActive: nextEnabled,
          diagnostics: prev.diagnostics
            ? { ...prev.diagnostics, enabled: nextEnabled }
            : null,
        }));
      }
    }
  }, []);

  // Set up devicechange listener for automatic detection of plugged/unplugged microphones (Step 8)
  useEffect(() => {
    refreshDevices();

    const handleDeviceChange = async () => {
      console.log('[MIC DEVICECHANGE] Audio devices changed in OS/browser. Refreshing device list...');
      await refreshDevices();

      // Check if selected physical device disappeared
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const rawInputs = devices.filter((d) => d.kind === 'audioinput');
        const currentSelectedId = selectedDeviceIdRef.current;

        if (
          currentSelectedId !== 'system_default' &&
          currentSelectedId !== 'communications_default'
        ) {
          const stillExists = rawInputs.some((d) => d.deviceId === currentSelectedId);
          if (!stillExists) {
            console.warn(`[MIC DEVICECHANGE] Selected device "${currentSelectedId}" disconnected! Falling back to System Default.`);
            await switchDevice('system_default');
          }
        }
      }
    };

    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
      cleanupAudioPipeline();
      stopMicrophoneTest();
    };
  }, [refreshDevices, cleanupAudioPipeline, stopMicrophoneTest, switchDevice]);

  return {
    status: state.status,
    micPermission: state.micPermission,
    isMicActive: state.isMicActive,
    micVolume: state.micVolume,
    speechAudioLevel: state.micVolume,
    rawTranscript: state.rawTranscript,
    partialTranscript: state.partialTranscript,
    finalTranscript: state.finalTranscript,
    latestCorrections: state.latestCorrections,
    latestEntities: state.latestEntities,
    isStreaming: state.isStreaming,
    isSpeechActive: state.isSpeechActive,
    vadState: state.vadState,
    turnEvent: state.turnEvent,
    turnConfidence: state.turnConfidence,
    eotThreshold: state.eotThreshold,
    eagerEotThreshold: state.eagerEotThreshold,
    eotTimeoutMs: state.eotTimeoutMs,
    sttProvider: state.sttProvider,
    pipelineState: state.pipelineState,
    latencyMs: state.latencyMs,
    errorMessage: state.errorMessage,
    error: state.errorMessage,
    mediaStream: state.mediaStream,
    audioTrackPublished: state.audioTrackPublished,
    trackCount: state.trackCount,
    activeDeviceLabel: state.activeDeviceLabel,
    roomName: state.roomName,
    participantId: state.participantId,
    isCloudConfigured: state.isCloudConfigured,
    isDeepgramConfigured: state.isCloudConfigured,
    sttModel: state.sttModel,
    sttEndpoint: state.sttEndpoint,
    diagnostics: state.diagnostics,
    // Test microphone functionality
    isTestingMic: state.isTestingMic,
    testMicVolume: state.testMicVolume,
    testMicError: state.testMicError,
    startMicrophoneTest,
    stopMicrophoneTest,
    // Structured Audio Device Options
    audioOptions,
    availableDevices,
    selectedDeviceId,
    switchDevice,
    connect,
    disconnect,
    stopRecordingAndGetTranscript,
    toggleMic,
    stopAudioStreaming: disconnect,
    finalizeTurn,
  };
}
