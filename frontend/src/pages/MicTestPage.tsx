import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, AlertCircle, Volume2, RefreshCw, Terminal, ArrowLeft } from 'lucide-react';

interface DeviceItem {
  deviceId: string;
  label: string;
}

interface TrackInfo {
  label: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
  id: string;
}

export const MicTestPage: React.FC = () => {
  const [permissionStatus, setPermissionStatus] = useState<'PROMPT' | 'GRANTED' | 'DENIED' | 'UNSUPPORTED'>('PROMPT');
  const [streamStatus, setStreamStatus] = useState<'INACTIVE' | 'ACTIVE' | 'ERROR'>('INACTIVE');
  const [trackCount, setTrackCount] = useState<number>(0);
  const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [peakLevel, setPeakLevel] = useState<number>(0);
  const [audioCtxState, setAudioCtxState] = useState<string>('closed');
  const [sampleRate, setSampleRate] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const line = `[${timestamp}] ${msg}`;
    console.log(`[MIC_DEBUG] ${line}`);
    setLogs((prev) => [...prev.slice(-150), line]);
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Enumerate input devices
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      addLog('navigator.mediaDevices.enumerateDevices is UNSUPPORTED in this browser.');
      return;
    }
    try {
      addLog('Enumerating audio input devices...');
      const devList = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devList
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1} (${d.deviceId.slice(0, 8)}...)`,
        }));
      setDevices(audioInputs);
      addLog(`Found ${audioInputs.length} audioinput device(s).`);
      audioInputs.forEach((d, i) => addLog(`  Device [${i}]: "${d.label}" id=${d.deviceId}`));
    } catch (err: unknown) {
      const e = err as Error;
      addLog(`Error enumerating devices: ${e.name} - ${e.message}`);
    }
  }, [addLog]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Clean Stop Function
  const stopMicrophone = useCallback(() => {
    addLog('STOP requested: stopping tracks, disconnecting nodes, closing AudioContext.');

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track, i) => {
        addLog(`Stopping track[${i}] (${track.label}) - was readyState="${track.readyState}"`);
        track.stop();
      });
      streamRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }

    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx.state !== 'closed') {
        ctx.close().then(() => {
          addLog('AudioContext cleanly closed.');
          setAudioCtxState('closed');
        }).catch((e) => {
          addLog(`AudioContext close error: ${e}`);
        });
      }
    }

    setStreamStatus('INACTIVE');
    setTrackCount(0);
    setTrackInfo(null);
    setAudioLevel(0);
    addLog('Microphone stopped cleanly. UI state set to INACTIVE. Level reset to 0.000.');
  }, [addLog]);

  // Start Microphone Function
  const startMicrophone = useCallback(async (targetDeviceId?: string) => {
    stopMicrophone();
    setErrorMessage(null);
    setAudioLevel(0);
    setPeakLevel(0);

    const devId = targetDeviceId || selectedDeviceId;
    addLog('==================================================');
    addLog(`START MICROPHONE clicked. Selected deviceId="${devId || 'default'}"`);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'navigator.mediaDevices.getUserMedia is NOT supported in this environment.';
      addLog(`CRITICAL: ${msg}`);
      setPermissionStatus('UNSUPPORTED');
      setStreamStatus('ERROR');
      setErrorMessage(msg);
      return;
    }

    // Step 1: UserMedia request
    const constraints: MediaStreamConstraints = {
      audio: devId
        ? {
            deviceId: { exact: devId },
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
          }
        : {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
          },
    };

    addLog(`Calling getUserMedia() with constraints: ${JSON.stringify(constraints)}`);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setPermissionStatus('GRANTED');
      setStreamStatus('ACTIVE');
      addLog('getUserMedia() SUCCESS: Permission GRANTED, MediaStream received.');
    } catch (err: unknown) {
      const e = err as Error;
      addLog(`CRITICAL: getUserMedia() FAILED with error: ${e.name} - ${e.message}`);
      setStreamStatus('ERROR');
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setPermissionStatus('DENIED');
        setErrorMessage(`Permission Denied: ${e.name}. Please grant microphone access in Chrome URL bar permissions.`);
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setErrorMessage(`Device Not Found: ${e.name}. No physical microphone hardware was detected.`);
      } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        setErrorMessage(`Hardware In Use / Not Readable: ${e.name}. Another application or Windows setting is locking your microphone.`);
      } else if (e.name === 'SecurityError') {
        setErrorMessage(`Security Error: ${e.name}. getUserMedia() requires HTTPS or http://localhost/127.0.0.1.`);
      } else {
        setErrorMessage(`Browser Error: ${e.name}: ${e.message}`);
      }
      return;
    }

    // Step 2: Verify Audio Tracks
    const tracks = stream.getAudioTracks();
    setTrackCount(tracks.length);
    addLog(`MediaStream active=${stream.active}, audio tracks count=${tracks.length}`);

    if (tracks.length === 0) {
      const msg = 'MediaStream contains ZERO audio tracks!';
      addLog(`ERROR: ${msg}`);
      setErrorMessage(msg);
      return;
    }

    const firstTrack = tracks[0];
    const info: TrackInfo = {
      label: firstTrack.label || 'Default Audio Input',
      readyState: firstTrack.readyState,
      enabled: firstTrack.enabled,
      muted: firstTrack.muted,
      id: firstTrack.id,
    };
    setTrackInfo(info);
    addLog(`Track[0] label: "${info.label}"`);
    addLog(`Track[0] readyState: "${info.readyState}"`);
    addLog(`Track[0] enabled: ${info.enabled}`);
    addLog(`Track[0] muted: ${info.muted}`);

    firstTrack.onended = () => {
      addLog('Track[0] event: "ended"');
      setTrackInfo((prev) => (prev ? { ...prev, readyState: 'ended' } : null));
    };

    firstTrack.onmute = () => {
      addLog('Track[0] event: "mute" (Microphone hardware was muted by OS/switch)');
      setTrackInfo((prev) => (prev ? { ...prev, muted: true } : null));
    };

    firstTrack.onunmute = () => {
      addLog('Track[0] event: "unmute" (Microphone hardware unmuted)');
      setTrackInfo((prev) => (prev ? { ...prev, muted: false } : null));
    };

    // Step 3: Refresh devices to get full labels after permission is granted
    refreshDevices();

    // Step 4: Web Audio API Pipeline (MediaStream -> SourceNode -> AnalyserNode -> Destination)
    try {
      addLog('Initializing Web Audio API for RMS level detection...');
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      setAudioCtxState(audioCtx.state);
      setSampleRate(audioCtx.sampleRate);
      addLog(`AudioContext created. state="${audioCtx.state}", sampleRate=${audioCtx.sampleRate}Hz`);

      if (audioCtx.state === 'suspended') {
        addLog('AudioContext is suspended; calling audioCtx.resume()...');
        await audioCtx.resume();
        addLog(`AudioContext resumed! state="${audioCtx.state}"`);
        setAudioCtxState(audioCtx.state);
      }

      audioCtx.onstatechange = () => {
        if (audioCtxRef.current) {
          addLog(`AudioContext state changed: "${audioCtxRef.current.state}"`);
          setAudioCtxState(audioCtxRef.current.state);
        }
      };

      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      addLog('MediaStreamAudioSourceNode created.');

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      analyserRef.current = analyser;
      addLog(`AnalyserNode created: fftSize=${analyser.fftSize}`);

      // 4x Boost GainNode to ensure quiet laptop/Windows microphones are clearly amplified
      const boostGain = audioCtx.createGain();
      boostGain.gain.value = 4.0;
      source.connect(boostGain);
      boostGain.connect(analyser);
      addLog('Source connected via 4x Boost GainNode (+12dB) to AnalyserNode.');

      // Connect to a tiny non-zero gain node connected to destination so Chrome's audio clock pulls frames
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0.00001;
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      addLog('Analyser connected to destination via active pull graph.');

      // Realtime Audio Loop
      const dataArray = new Float32Array(analyser.fftSize);
      const freqArray = new Uint8Array(analyser.frequencyBinCount);
      let localPeak = 0;
      let lastLogTime = 0;

      const renderAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(dataArray);
        analyserRef.current.getByteFrequencyData(freqArray);

        // 1. Calculate true time-domain RMS
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = dataArray[i];
          sumSquares += val * val;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        // 2. Calculate frequency energy
        let freqSum = 0;
        for (let i = 0; i < freqArray.length; i++) {
          freqSum += freqArray[i];
        }
        const freqLevel = (freqSum / freqArray.length) / 255;

        // Combined responsive level (0.000 to 1.000)
        const normalized = Math.min(1, Math.max(rms * 5, freqLevel * 2));
        setAudioLevel(normalized);

        if (normalized > localPeak) {
          localPeak = normalized;
          setPeakLevel(localPeak);
        }

        const now = Date.now();
        if (normalized > 0.02 && now - lastLogTime > 1500) {
          lastLogTime = now;
          addLog(`Live Voice Audio Detected! RMS=${rms.toFixed(4)} Freq=${freqLevel.toFixed(4)} Level=${normalized.toFixed(3)}`);
        }

        // Draw visual oscilloscope
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const width = canvas.width;
            const height = canvas.height;
            ctx.fillStyle = '#0a0f1d';
            ctx.fillRect(0, 0, width, height);

            ctx.lineWidth = 2;
            ctx.strokeStyle = normalized > 0.05 ? '#06b6d4' : '#334155';
            ctx.beginPath();

            const sliceWidth = width / dataArray.length;
            let x = 0;

            for (let i = 0; i < dataArray.length; i++) {
              const v = dataArray[i] * 3; // amplifies waveform height
              const y = (height / 2) + (v * (height / 2));

              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
              x += sliceWidth;
            }

            ctx.lineTo(width, height / 2);
            ctx.stroke();
          }
        }

        animFrameRef.current = requestAnimationFrame(renderAudio);
      };

      animFrameRef.current = requestAnimationFrame(renderAudio);
      addLog('Audio rendering loop started successfully. Speak into your microphone now!');
    } catch (audioErr: unknown) {
      const e = audioErr as Error;
      addLog(`ERROR setting up Web Audio API: ${e.name} - ${e.message}`);
      setErrorMessage(`Audio Analysis Error: ${e.message}`);
    }
  }, [selectedDeviceId, addLog, stopMicrophone, refreshDevices]);

  // Handle device change
  const handleDeviceSelect = (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    addLog(`Device selected from dropdown: "${newDeviceId}"`);
    if (streamStatus === 'ACTIVE') {
      addLog('Restarting microphone with newly selected device...');
      startMicrophone(newDeviceId);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, [stopMicrophone]);

  return (
    <div className="min-h-screen bg-[#050811] text-slate-100 p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to VoiceTrip</span>
            </a>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
                <Mic className="w-5 h-5 text-cyan-400" />
                <span>Isolated Browser Microphone Diagnostic</span>
              </h1>
              <p className="text-xs text-slate-400">
                Pure browser hardware verification (Direct getUserMedia & Web Audio API RMS)
              </p>
            </div>
          </div>
          <button
            onClick={refreshDevices}
            title="Refresh connected microphones"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Refresh Devices</span>
          </button>
        </div>

        {/* Error Alert Box */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-200 text-sm flex items-start gap-3 shadow-lg animate-fadeIn">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-rose-100">Microphone Capture Error</div>
              <div className="mt-1 font-mono text-xs">{errorMessage}</div>
            </div>
          </div>
        )}

        {/* Main Status Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Permission */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Permission</span>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`text-sm font-bold font-mono px-2 py-0.5 rounded ${
                  permissionStatus === 'GRANTED'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                    : permissionStatus === 'DENIED'
                    ? 'bg-rose-950 text-rose-400 border border-rose-500/30'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {permissionStatus}
              </span>
            </div>
          </div>

          {/* Stream */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Stream Status</span>
            <div className="mt-1">
              <span
                className={`text-sm font-bold font-mono px-2 py-0.5 rounded ${
                  streamStatus === 'ACTIVE'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                    : streamStatus === 'ERROR'
                    ? 'bg-rose-950 text-rose-400 border border-rose-500/30'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {streamStatus}
              </span>
            </div>
          </div>

          {/* Track Count */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Audio Tracks</span>
            <div className="mt-1 text-sm font-bold font-mono text-cyan-300">
              {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
            </div>
          </div>

          {/* AudioContext State */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">AudioContext</span>
            <div className="mt-1 text-sm font-bold font-mono text-purple-300">
              {audioCtxState} {sampleRate > 0 && `(${sampleRate / 1000}kHz)`}
            </div>
          </div>
        </div>

        {/* Device Selection Card */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>Selected Microphone Device</span>
            <span className="text-[11px] font-mono text-cyan-400">{devices.length} microphone(s) detected</span>
          </label>
          <select
            value={selectedDeviceId}
            onChange={(e) => handleDeviceSelect(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:border-cyan-500 font-mono"
          >
            <option value="">Default System Microphone</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          {trackInfo && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px] font-mono text-slate-400 border-t border-slate-800/80">
              <div>
                <span className="text-slate-500">Track State: </span>
                <span className="text-emerald-400 font-semibold">{trackInfo.readyState}</span>
              </div>
              <div>
                <span className="text-slate-500">Track Enabled: </span>
                <span className={trackInfo.enabled ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                  {String(trackInfo.enabled)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Track Muted: </span>
                <span className={trackInfo.muted ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                  {String(trackInfo.muted)}
                </span>
              </div>
              <div className="truncate" title={trackInfo.label}>
                <span className="text-slate-500">Label: </span>
                <span className="text-cyan-300">{trackInfo.label}</span>
              </div>
            </div>
          )}
        </div>

        {/* Realtime Audio Meter & Oscilloscope */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-sm text-slate-200">Realtime Audio Level Meter</span>
            </div>
            <div className="text-xs font-mono">
              <span className="text-slate-400">Microphone Level: </span>
              <span className={`text-base font-bold ${audioLevel > 0.05 ? 'text-cyan-300' : 'text-slate-500'}`}>
                {audioLevel.toFixed(3)}
              </span>
              <span className="text-slate-600 ml-2">(Peak: {peakLevel.toFixed(3)})</span>
            </div>
          </div>

          {/* Level Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full h-5 bg-slate-950 rounded-lg overflow-hidden p-1 border border-slate-800 flex items-center">
              <div
                className={`h-full rounded-md transition-all duration-75 ${
                  audioLevel > 0.2
                    ? 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-amber-400 shadow-[0_0_12px_rgba(6,182,212,0.8)]'
                    : audioLevel > 0.03
                    ? 'bg-gradient-to-r from-sky-500 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                    : 'bg-slate-700'
                }`}
                style={{ width: `${Math.min(100, Math.max(streamStatus === 'ACTIVE' ? 1.5 : 0, audioLevel * 100))}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1">
              <span>0.00 (Silent)</span>
              <span>0.25 (Normal Speech)</span>
              <span>0.50 (Loud)</span>
              <span>1.00 (Max)</span>
            </div>
          </div>

          {/* Real-time Oscilloscope Canvas */}
          <div>
            <div className="text-[10px] font-mono text-slate-500 mb-1">REALTIME AUDIO WAVEFORM (TIME DOMAIN):</div>
            <canvas
              ref={canvasRef}
              width={700}
              height={90}
              className="w-full h-24 rounded-lg bg-[#0a0f1d] border border-slate-800 block"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => startMicrophone()}
              disabled={streamStatus === 'ACTIVE'}
              className={`flex-1 py-3 px-5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg ${
                streamStatus === 'ACTIVE'
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/25 active:scale-98'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>START MICROPHONE</span>
            </button>

            <button
              onClick={stopMicrophone}
              disabled={streamStatus !== 'ACTIVE'}
              className={`py-3 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
                streamStatus !== 'ACTIVE'
                  ? 'bg-slate-800/60 text-slate-600 cursor-not-allowed border border-slate-800'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25 active:scale-98'
              }`}
            >
              <MicOff className="w-4 h-4" />
              <span>STOP</span>
            </button>
          </div>
        </div>

        {/* Live Diagnostics Console */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 font-bold text-cyan-400">
              <Terminal className="w-4 h-4" />
              Console Diagnostics
            </span>
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-slate-500 hover:text-slate-300 underline"
            >
              Clear Logs
            </button>
          </div>
          <div
            ref={logContainerRef}
            className="h-48 overflow-y-auto font-mono text-[11px] space-y-1 text-slate-300 bg-[#070b16] p-3 rounded-lg border border-slate-900 select-text"
          >
            {logs.length === 0 ? (
              <div className="text-slate-600 italic">Click [ START MICROPHONE ] to begin capturing diagnostic logs...</div>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={
                    log.includes('CRITICAL') || log.includes('ERROR') || log.includes('FAILED')
                      ? 'text-rose-400'
                      : log.includes('SUCCESS') || log.includes('GRANTED') || log.includes('Live Voice Audio')
                      ? 'text-emerald-300 font-semibold'
                      : log.includes('AudioContext') || log.includes('Analyser')
                      ? 'text-purple-300'
                      : 'text-slate-400'
                  }
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
