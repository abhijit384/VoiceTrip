import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, createLocalAudioTrack, LocalAudioTrack } from 'livekit-client';

export type LiveKitConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type MicPermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

interface LiveKitSessionState {
  status: LiveKitConnectionStatus;
  micPermission: MicPermissionStatus;
  isMicActive: boolean;
  micVolume: number; // 0 to 100
  roomName: string | null;
  participantId: string | null;
  isCloudConfigured: boolean;
  errorMessage: string | null;
  mediaStream: MediaStream | null;
}

export function useLiveKitSession() {
  const [state, setState] = useState<LiveKitSessionState>({
    status: 'disconnected',
    micPermission: 'prompt',
    isMicActive: false,
    micVolume: 0,
    roomName: null,
    participantId: null,
    isCloudConfigured: false,
    errorMessage: null,
    mediaStream: null,
  });

  const roomRef = useRef<Room | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Monitor microphone volume from real audio stream
  const startVolumeAnalysis = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const average = sum / buffer.length;
        // Normalize 0-255 to 0-100
        const volume = Math.min(100, Math.round((average / 128) * 100));
        setState((prev) => ({ ...prev, micVolume: volume }));
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('AudioContext volume analysis error:', e);
    }
  }, []);

  const stopVolumeAnalysis = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setState((prev) => ({ ...prev, micVolume: 0 }));
  }, []);

  // Disconnect session and release microphone
  const disconnect = useCallback(() => {
    stopVolumeAnalysis();

    if (audioTrackRef.current) {
      audioTrackRef.current.stop();
      audioTrackRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      status: 'disconnected',
      isMicActive: false,
      micVolume: 0,
      errorMessage: null,
      mediaStream: null,
    }));
  }, [stopVolumeAnalysis]);

  // Connect to LiveKit Session & capture microphone
  const connect = useCallback(
    async (roomName: string = 'voicetrip-room') => {
      // Prevent multiple simultaneous connections
      disconnect();

      setState((prev) => ({
        ...prev,
        status: 'connecting',
        errorMessage: null,
      }));

      // Step 1: Check mediaDevices support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          micPermission: 'unsupported',
          errorMessage: 'Your browser does not support microphone audio capture.',
        }));
        return;
      }

      // Step 2: Request real microphone permission
      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = localStream;
        setState((prev) => ({ ...prev, micPermission: 'granted', isMicActive: true, mediaStream: localStream }));
        startVolumeAnalysis(localStream);
      } catch (err: unknown) {
        const error = err as Error;
        console.error('Microphone permission error:', error);
        setState((prev) => ({
          ...prev,
          status: 'error',
          micPermission: 'denied',
          errorMessage:
            error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
              ? 'Microphone permission was denied. Please allow microphone access in your browser settings.'
              : `Microphone error: ${error.message || 'Device not found'}`,
        }));
        return;
      }

      // Step 3: Fetch token from backend
      try {
        const tokenRes = await fetch('http://localhost:8000/api/livekit/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_name: roomName, participant_name: 'Traveler' }),
        });

        if (!tokenRes.ok) {
          throw new Error(`Token endpoint returned HTTP ${tokenRes.status}`);
        }

        const tokenData = await tokenRes.json();
        const { token, url, is_livekit_configured, participant_identity } = tokenData;

        setState((prev) => ({
          ...prev,
          roomName,
          participantId: participant_identity,
          isCloudConfigured: is_livekit_configured,
        }));

        // Step 4: Create LiveKit local audio track
        try {
          const track = await createLocalAudioTrack({
            echoCancellation: true,
            noiseSuppression: true,
          });
          audioTrackRef.current = track;
        } catch (trackErr) {
          console.warn('Could not create LiveKit audio track wrapper; using native stream:', trackErr);
        }

        // Step 5: If LiveKit Cloud is configured, join actual room
        if (is_livekit_configured && url && !url.includes('placeholder')) {
          const room = new Room({
            adaptiveStream: true,
            dynacast: true,
          });
          roomRef.current = room;

          room
            .on(RoomEvent.Connected, () => {
              console.log('Connected to LiveKit Cloud room:', roomName);
              setState((prev) => ({ ...prev, status: 'connected', errorMessage: null }));
              if (audioTrackRef.current) {
                room.localParticipant.publishTrack(audioTrackRef.current).catch((err) => {
                  console.warn('Track publish notice:', err);
                });
              }
            })
            .on(RoomEvent.Reconnecting, () => {
              setState((prev) => ({ ...prev, status: 'reconnecting' }));
            })
            .on(RoomEvent.Reconnected, () => {
              setState((prev) => ({ ...prev, status: 'connected' }));
            })
            .on(RoomEvent.Disconnected, () => {
              setState((prev) => ({ ...prev, status: 'disconnected' }));
            });

          await room.connect(url, token);
        } else {
          // Local/Simulated Realtime WebRTC mode: Audio stream is live, volume analysis active
          console.log('LiveKit session connected in local development mode (Microphone active)');
          setState((prev) => ({
            ...prev,
            status: 'connected',
            errorMessage: null,
          }));
        }
      } catch (err: unknown) {
        const error = err as Error;
        console.error('LiveKit connection error:', error);
        // Even if remote cloud room fails, keep microphone stream active with fallback status
        setState((prev) => ({
          ...prev,
          status: 'connected',
          isCloudConfigured: false,
          errorMessage: `LiveKit Cloud unreachable (${error.message}). Running in local audio session mode.`,
        }));
      }
    },
    [disconnect, startVolumeAnalysis]
  );

  // Toggle microphone mute/unmute
  const toggleMic = useCallback(() => {
    if (audioTrackRef.current) {
      if (audioTrackRef.current.isMuted) {
        audioTrackRef.current.unmute();
        setState((prev) => ({ ...prev, isMicActive: true }));
      } else {
        audioTrackRef.current.mute();
        setState((prev) => ({ ...prev, isMicActive: false }));
      }
    } else if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setState((prev) => ({ ...prev, isMicActive: audioTrack.enabled }));
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status: state.status,
    micPermission: state.micPermission,
    isMicActive: state.isMicActive,
    micVolume: state.micVolume,
    roomName: state.roomName,
    participantId: state.participantId,
    isCloudConfigured: state.isCloudConfigured,
    errorMessage: state.errorMessage,
    mediaStream: state.mediaStream,
    connect,
    disconnect,
    toggleMic,
  };
}
