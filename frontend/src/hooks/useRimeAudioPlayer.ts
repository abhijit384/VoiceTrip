import { useState, useRef, useCallback, useEffect } from 'react';

export interface RimePlayerState {
  isPlaying: boolean;
  voiceProvider: string;
  speaker: string;
  model: string;
  ttsLatencyMs: number;
  error: string | null;
}

export function useRimeAudioPlayer(onPlaybackEnded?: () => void) {
  const [state, setState] = useState<RimePlayerState>({
    isPlaying: false,
    voiceProvider: 'Rime TTS',
    speaker: 'amber',
    model: 'mist',
    ttsLatencyMs: 0,
    error: null,
  });

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  // Stop currently playing audio immediately
  const stopAudio = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.src = '';
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  // Synthesize text with Rime TTS and play through browser audio
  const playRimeSpeech = useCallback(
    async (text: string, generationId: string = 'gen_1') => {
      if (!text || !text.trim()) return;

      // Stop any prior playback
      stopAudio();

      const startTime = Date.now();
      setState((prev) => ({ ...prev, error: null }));

      try {
        console.log(`[Rime TTS] Synthesizing speech for epoch ${generationId}: "${text.slice(0, 40)}..."`);
        const response = await fetch('http://localhost:8000/api/tts/synthesize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text.trim(),
            generation_id: generationId,
          }),
        });

        if (!response.ok) {
          throw new Error(`Rime TTS API returned HTTP ${response.status}`);
        }

        const ttsTtfb = Date.now() - startTime;
        const speaker = response.headers.get('x-rime-speaker') || 'amber';
        const model = response.headers.get('x-rime-model') || 'mist';

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        currentBlobUrlRef.current = blobUrl;

        const audio = new Audio(blobUrl);
        audioElementRef.current = audio;

        audio.onplay = () => {
          setState((prev) => ({
            ...prev,
            isPlaying: true,
            speaker,
            model,
            ttsLatencyMs: ttsTtfb,
          }));
        };

        audio.onended = () => {
          setState((prev) => ({ ...prev, isPlaying: false }));
          if (currentBlobUrlRef.current) {
            URL.revokeObjectURL(currentBlobUrlRef.current);
            currentBlobUrlRef.current = null;
          }
          if (onPlaybackEnded) {
            onPlaybackEnded();
          }
        };

        audio.onerror = (e) => {
          console.error('Audio playback error:', e);
          setState((prev) => ({ ...prev, isPlaying: false, error: 'Audio playback failed' }));
        };

        await audio.play();
        return ttsTtfb;
      } catch (err: unknown) {
        const error = err as Error;
        console.error('Rime TTS synthesis error:', error);
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          error: `Rime synthesis failed: ${error.message}`,
        }));
        return 0;
      }
    },
    [stopAudio, onPlaybackEnded]
  );

  // Fetch Rime engine info on mount
  useEffect(() => {
    fetch('http://localhost:8000/api/tts/info')
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
      stopAudio();
    };
  }, [stopAudio]);

  return {
    isPlaying: state.isPlaying,
    voiceProvider: state.voiceProvider,
    speaker: state.speaker,
    model: state.model,
    ttsLatencyMs: state.ttsLatencyMs,
    error: state.error,
    playRimeSpeech,
    stopAudio,
  };
}
