import { useState, useRef, useCallback, useEffect } from 'react';
import { getApiBase } from '../config';
import { getSharedAudioContext, unlockAudioContext } from '../utils/audioContext';

export interface RimeTelemetry {
  rimeRequest: 'STARTED' | 'SUCCESS' | 'FAILED' | 'IDLE';
  httpStatus: number | null;
  contentType: string;
  contentLength: number | null;
  responseSize: number;
  responseKind: 'BINARY' | 'JSON' | 'OTHER' | 'NONE';
  audioFormat: string;
  blobType: string;
  audioDuration: number;
  audioMuted: boolean;
  audioVolume: number;
  audioReadyState: number;
  audioContextState: string;
  decode: 'SUCCESS' | 'FAILED' | 'PENDING' | 'IDLE';
  play: 'STARTED' | 'PLAYING' | 'ENDED' | 'FAILED' | 'STOPPED' | 'IDLE';
  playError: string | null;
}

export interface RimePlayerState {
  isPlaying: boolean;
  voiceProvider: string;
  speaker: string;
  model: string;
  ttsLatencyMs: number;
  audioBytes: number;
  audioFormat: string;
  error: string | null;
  activeGenerationId: string;
  latestText: string;
  hasAudio: boolean;
  autoplayBlocked: boolean;
  telemetry: RimeTelemetry;
}

export function useRimeAudioPlayer(onPlaybackEnded?: () => void) {
  const [state, setState] = useState<RimePlayerState>({
    isPlaying: false,
    voiceProvider: 'Rime TTS (Amber)',
    speaker: 'amber',
    model: 'mist',
    ttsLatencyMs: 0,
    audioBytes: 0,
    audioFormat: 'audio/mpeg',
    error: null,
    activeGenerationId: 'gen_1',
    latestText: '',
    hasAudio: false,
    autoplayBlocked: false,
    telemetry: {
      rimeRequest: 'IDLE',
      httpStatus: null,
      contentType: 'audio/mpeg',
      contentLength: null,
      responseSize: 0,
      responseKind: 'NONE',
      audioFormat: 'mp3 (24kHz)',
      blobType: 'audio/mpeg',
      audioDuration: 0,
      audioMuted: false,
      audioVolume: 1.0,
      audioReadyState: 0,
      audioContextState: 'uninitialized',
      decode: 'IDLE',
      play: 'IDLE',
      playError: null,
    },
  });

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const latestAudioBlobRef = useRef<Blob | null>(null);
  const latestAudioBufferRef = useRef<ArrayBuffer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationRef = useRef<string>('gen_1');
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  onPlaybackEndedRef.current = onPlaybackEnded;

  // Stop currently playing audio immediately and cancel in-flight TTS
  const stopAudio = useCallback((reason: string = 'normal') => {
    console.log(`[RIME] PLAY: STOPPED reason=${reason} gen=${activeGenerationRef.current}`);

    // Cancel in-flight synthesis request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Stop Web Audio source node if playing
    if (audioSourceNodeRef.current) {
      try {
        audioSourceNodeRef.current.stop();
        audioSourceNodeRef.current.disconnect();
      } catch {}
      audioSourceNodeRef.current = null;
    }

    // Stop HTML Audio element if playing
    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
      } catch {}
      audioElementRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      isPlaying: false,
      telemetry: {
        ...prev.telemetry,
        play: 'STOPPED',
      },
    }));
  }, []);

  // Set active generation for barrier protection
  const setActiveGeneration = useCallback((generationId: string) => {
    activeGenerationRef.current = generationId;
    setState((prev) => ({ ...prev, activeGenerationId: generationId }));
  }, []);

  // Internal helper to play an audio buffer or blob through Web Audio API or Audio Element
  const playAudioData = useCallback(
    async (
      blob: Blob,
      arrayBuf: ArrayBuffer,
      speaker: string,
      model: string,
      ttsTtfb: number,
      genId: string,
      contentType: string
    ) => {
      stopAudio('prepare_playback');

      // Make sure AudioContext is unlocked & running
      await unlockAudioContext().catch(() => {});
      const ctx = getSharedAudioContext();
      const ctxState = ctx ? ctx.state : 'unavailable';

      // Create and persist blob URL
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      const blobUrl = URL.createObjectURL(blob);
      currentBlobUrlRef.current = blobUrl;
      latestAudioBlobRef.current = blob;
      latestAudioBufferRef.current = arrayBuf;

      const audio = new Audio();
      audio.src = blobUrl;
      audio.preload = 'auto';
      audio.muted = false;
      audio.volume = 1.0;
      audioElementRef.current = audio;

      let hasEnded = false;
      const handleEnded = () => {
        if (hasEnded) return;
        hasEnded = true;
        console.log(`[RIME] PLAY: ENDED gen=${genId}`);
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          telemetry: {
            ...prev.telemetry,
            play: 'ENDED',
            audioReadyState: audio.readyState,
            audioDuration: Number(audio.duration?.toFixed(2)) || 0,
          },
        }));
        if (onPlaybackEndedRef.current) {
          onPlaybackEndedRef.current();
        }
      };

      audio.onloadstart = () => {
        console.log(`[RIME] audio.onloadstart: src=${audio.src ? 'present' : 'none'}`);
      };

      audio.oncanplay = () => {
        console.log(`[RIME] audio.oncanplay: readyState=${audio.readyState} duration=${audio.duration}s`);
      };

      audio.onerror = (e) => {
        const err = audio.error ? `${audio.error.code} - ${audio.error.message}` : 'Unknown HTMLAudioElement error';
        console.error(`[RIME] audio.onerror: ${err}`, e);
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          telemetry: {
            ...prev.telemetry,
            play: 'FAILED',
            playError: err,
          },
        }));
      };

      audio.onended = handleEnded;

      audio.onplay = () => {
        console.log(`[RIME] PLAY: STARTED gen=${genId} speaker=${speaker} bytes=${blob.size} format=${contentType} volume=${audio.volume} muted=${audio.muted} readyState=${audio.readyState}`);
        setState((prev) => ({
          ...prev,
          isPlaying: true,
          speaker,
          model,
          ttsLatencyMs: ttsTtfb,
          audioBytes: blob.size,
          audioFormat: contentType,
          hasAudio: true,
          error: null,
          autoplayBlocked: false,
          telemetry: {
            ...prev.telemetry,
            decode: 'SUCCESS',
            play: 'STARTED',
            blobType: blob.type,
            audioDuration: Number(audio.duration?.toFixed(2)) || 0,
            audioMuted: audio.muted,
            audioVolume: audio.volume,
            audioReadyState: audio.readyState,
            audioContextState: ctxState,
            playError: null,
          },
        }));
      };

      console.log(`[RIME] Audio Element Pre-flight: src=${audio.src ? 'exists' : 'missing'} readyState=${audio.readyState} muted=${audio.muted} volume=${audio.volume} AudioContext=${ctxState}`);

      try {
        console.log('[RIME] Attempting primary playback via HTMLAudioElement...');
        await audio.play();
        console.log('[RIME] DECODE: SUCCESS • PLAY: STARTED (Audible speaker output active)');
      } catch (playErr: unknown) {
        const pErr = playErr as Error;
        console.warn(`[RIME] HTMLAudioElement.play() blocked/failed (${pErr.name}: ${pErr.message}). Trying Web Audio decode fallback...`);

        // Fallback: Web Audio API AudioBufferSourceNode
        try {
          if (ctx.state === 'suspended') {
            await ctx.resume();
          }

          const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
          console.log(`[RIME] DECODE: SUCCESS Web Audio buffer: duration=${audioBuffer.duration.toFixed(2)}s rate=${audioBuffer.sampleRate}Hz channels=${audioBuffer.numberOfChannels}`);

          const sourceNode = ctx.createBufferSource();
          sourceNode.buffer = audioBuffer;
          sourceNode.connect(ctx.destination);
          audioSourceNodeRef.current = sourceNode;

          sourceNode.onended = handleEnded;
          sourceNode.start(0);

          console.log('[RIME] PLAY: STARTED (Web Audio SourceNode active)');

          setState((prev) => ({
            ...prev,
            isPlaying: true,
            speaker,
            model,
            ttsLatencyMs: ttsTtfb,
            audioBytes: blob.size,
            audioFormat: contentType,
            hasAudio: true,
            error: null,
            autoplayBlocked: false,
            telemetry: {
              ...prev.telemetry,
              decode: 'SUCCESS',
              play: 'STARTED',
              blobType: blob.type,
              audioDuration: Number(audioBuffer.duration.toFixed(2)),
              audioMuted: false,
              audioVolume: 1.0,
              audioReadyState: 4,
              audioContextState: ctx.state,
              playError: null,
            },
          }));
        } catch (webaudioErr: unknown) {
          const wErr = webaudioErr as Error;
          console.warn(`[RIME] PLAY: FAILED • PLAY_ERROR: ${wErr.message} (Autoplay restricted by browser - click Play Voice)`);
          setState((prev) => ({
            ...prev,
            isPlaying: false,
            autoplayBlocked: true,
            hasAudio: true,
            audioBytes: blob.size,
            telemetry: {
              ...prev.telemetry,
              decode: 'SUCCESS',
              play: 'FAILED',
              blobType: blob.type,
              audioMuted: audio.muted,
              audioVolume: audio.volume,
              audioReadyState: audio.readyState,
              audioContextState: ctx.state,
              playError: `Autoplay restricted by browser: ${pErr.message}. Click Play Voice to listen.`,
            },
          }));
        }
      }
    },
    [stopAudio]
  );

  // Synthesize text with Rime TTS and play through browser audio
  const playRimeSpeech = useCallback(
    async (text: string, generationId: string = 'gen_1') => {
      if (!text || !text.trim()) return 0;

      activeGenerationRef.current = generationId;
      stopAudio('new_utterance');

      const tReqStart = Date.now() / 1000;
      console.log(`\n============================================================`);
      console.log(`[RIME] RIME_REQUEST: STARTED`);
      console.log(`[RIME] Text: "${text.slice(0, 60)}..." (gen: ${generationId})`);
      console.log(`============================================================`);

      setState((prev) => ({
        ...prev,
        isPlaying: true,
        error: null,
        activeGenerationId: generationId,
        latestText: text.trim(),
        telemetry: {
          ...prev.telemetry,
          rimeRequest: 'STARTED',
          play: 'STARTED',
          playError: null,
        },
      }));

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(`${getApiBase()}/api/tts/synthesize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text.trim(),
            generation_id: generationId,
          }),
          signal: abortController.signal,
        });

        const httpStatus = response.status;
        const contentType = response.headers.get('content-type') || 'audio/mpeg';
        const contentLength = response.headers.get('content-length') ? Number(response.headers.get('content-length')) : null;
        const speaker = response.headers.get('x-rime-speaker') || 'amber';
        const model = response.headers.get('x-rime-model') || 'mist';

        console.log(`[RIME] HTTP_STATUS: ${httpStatus}`);
        console.log(`[RIME] CONTENT_TYPE: ${contentType}`);
        console.log(`[RIME] CONTENT_LENGTH: ${contentLength ?? 'chunked/unknown'}`);

        if (!response.ok) {
          console.error(`[RIME] RIME_REQUEST: FAILED (HTTP ${httpStatus})`);
          setState((prev) => ({
            ...prev,
            isPlaying: false,
            telemetry: {
              ...prev.telemetry,
              rimeRequest: 'FAILED',
              httpStatus,
              contentType,
              playError: `Rime API HTTP ${httpStatus}`,
            },
          }));
          throw new Error(`Rime TTS API returned HTTP ${httpStatus}`);
        }

        const tRecv = Date.now() / 1000;
        const ttsTtfb = Math.round((tRecv - tReqStart) * 1000);

        // Read binary audio bytes
        const arrayBuf = await response.arrayBuffer();
        const responseSize = arrayBuf.byteLength;
        const responseKind = contentType.includes('json') ? 'JSON' : 'BINARY';
        const audioFormat = contentType.includes('wav') ? 'wav (24kHz)' : 'mp3 (24kHz)';

        console.log(`[RIME] RESPONSE_SIZE: ${responseSize} bytes`);
        console.log(`[RIME] RESPONSE_KIND: ${responseKind}`);
        console.log(`[RIME] AUDIO_FORMAT: ${audioFormat}`);

        if (responseSize === 0) {
          const err = 'Rime returned no audio data (0 bytes).';
          console.error(`[RIME] ${err}`);
          setState((prev) => ({
            ...prev,
            error: err,
            telemetry: {
              ...prev.telemetry,
              rimeRequest: 'FAILED',
              responseSize: 0,
              playError: err,
            },
          }));
          throw new Error(err);
        }

        const blob = new Blob([arrayBuf], { type: contentType });

        setState((prev) => ({
          ...prev,
          telemetry: {
            ...prev.telemetry,
            rimeRequest: 'SUCCESS',
            httpStatus,
            contentType,
            contentLength,
            responseSize,
            responseKind,
            audioFormat,
            blobType: blob.type,
            decode: 'PENDING',
          },
        }));

        // Check if generation was superseded during fetch
        if (activeGenerationRef.current !== generationId) {
          console.warn(`[RIME] Stale audio discarded: active gen is ${activeGenerationRef.current}, response is ${generationId}`);
          return 0;
        }

        await playAudioData(blob, arrayBuf, speaker, model, ttsTtfb, generationId, contentType);
        return ttsTtfb;
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') {
          console.log(`[RIME] TTS request aborted for gen ${generationId}`);
          return 0;
        }
        const error = err as Error;
        console.error(`[RIME] RIME_REQUEST: FAILED (${error.message})`);
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          error: `Rime synthesis error: ${error.message}`,
          telemetry: {
            ...prev.telemetry,
            rimeRequest: 'FAILED',
            play: 'FAILED',
            playError: error.message,
          },
        }));
        return 0;
      }
    },
    [stopAudio, playAudioData]
  );

  // Play stored cached audio for the current response without calling TTS API again
  const playCachedAudio = useCallback(async () => {
    if (latestAudioBlobRef.current && latestAudioBufferRef.current) {
      console.log('[RIME] Playing cached response audio without API call...');
      await playAudioData(
        latestAudioBlobRef.current,
        latestAudioBufferRef.current,
        state.speaker,
        state.model,
        state.ttsLatencyMs,
        activeGenerationRef.current,
        state.audioFormat
      );
    } else if (state.latestText) {
      console.log('[RIME] No cached audio found, synthesizing from latest text:', state.latestText);
      await playRimeSpeech(state.latestText, activeGenerationRef.current);
    }
  }, [state.speaker, state.model, state.ttsLatencyMs, state.latestText, state.audioFormat, playAudioData, playRimeSpeech]);

  // Test Rime voice directly with a fixed phrase
  const testRimeVoice = useCallback(async () => {
    console.log('[RIME] Testing Rime voice directly with test phrase...');
    await unlockAudioContext().catch(() => {});
    await playRimeSpeech('Hello, this is a Rime voice playback test.', 'gen_test');
  }, [playRimeSpeech]);

  // Fetch Rime engine info on mount
  useEffect(() => {
    fetch(`${getApiBase()}/api/tts/info`)
      .then((r) => r.json())
      .then((info) => {
        setState((prev) => ({
          ...prev,
          speaker: info.speaker || 'amber',
          model: info.model_id || 'mist',
        }));
      })
      .catch((e) => console.warn('Could not fetch Rime info:', e));

    return () => {
      stopAudio('unmount');
    };
  }, [stopAudio]);

  return {
    isPlaying: state.isPlaying,
    voiceProvider: state.voiceProvider,
    speaker: state.speaker,
    model: state.model,
    ttsLatencyMs: state.ttsLatencyMs,
    audioBytes: state.audioBytes,
    audioFormat: state.audioFormat,
    error: state.error,
    hasAudio: state.hasAudio,
    autoplayBlocked: state.autoplayBlocked,
    latestText: state.latestText,
    activeGenerationId: state.activeGenerationId,
    telemetry: state.telemetry,
    playRimeSpeech,
    playCachedAudio,
    testRimeVoice,
    stopAudio,
    setActiveGeneration,
  };
}
