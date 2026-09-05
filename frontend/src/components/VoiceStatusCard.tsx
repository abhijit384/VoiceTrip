import type { FC } from 'react';
import {
  Mic,
  MicOff,
  Square,
  AlertTriangle,
  Loader2,
  Sparkles,
  Volume2,
  Clock,
  Zap,
  ShieldAlert,
  Activity,
  ChevronDown,
} from 'lucide-react';
import type { VoiceState, PipelineInitState } from '../types/voice';
import type {
  LiveKitConnectionStatus,
  MicPermissionStatus,
  AppAudioInputOption,
  DeviceDiagnostics,
} from '../hooks/useLiveKitSession';
import { AudioWaveform } from './AudioWaveform';

interface VoiceStatusCardProps {
  state: VoiceState;
  pipelineState?: PipelineInitState;
  connectionStatus: LiveKitConnectionStatus;
  micPermission: MicPermissionStatus;
  isMicActive: boolean;
  micVolume: number;
  toolProgress: number; // 0 to 100
  toolRemainingSeconds: number;
  interruptionCutoffMs: number;
  isAudioTrackLive?: boolean;
  onMicClick: () => void;
  onInterruptClick: () => void;
  onToggleMicMute: () => void;
  onConnect: () => void;
  errorMessage: string | null;
  // Microphone Device Selection Props
  audioOptions?: AppAudioInputOption[];
  selectedDeviceId?: string;
  onSelectDevice?: (deviceId: string) => void;
  activeDeviceLabel?: string;
  diagnostics?: DeviceDiagnostics | null;
}

export const VoiceStatusCard: FC<VoiceStatusCardProps> = ({
  state,
  pipelineState,
  connectionStatus,
  micPermission,
  isMicActive,
  micVolume,
  toolProgress,
  toolRemainingSeconds,
  interruptionCutoffMs,
  isAudioTrackLive = false,
  onMicClick,
  onInterruptClick,
  onToggleMicMute,
  onConnect,
  errorMessage,
  audioOptions = [
    { id: 'system_default', type: 'system_default', label: 'System Default', rawDeviceId: '' },
  ],
  selectedDeviceId = 'system_default',
  onSelectDevice,
  activeDeviceLabel,
  diagnostics,
}) => {
  // Config for status indicators
  const getStatusBadge = () => {
    if (isMicActive && pipelineState && pipelineState !== 'VOICE_READY' && state === 'listening') {
      return {
        bg: 'bg-amber-950/80 border-amber-500/50 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
        dot: 'bg-amber-400 animate-pulse',
        icon: <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
        title: 'Starting voice...',
        subtitle: `Connecting realtime audio engine (${pipelineState.replace('_', ' ')})...`,
      };
    }

    switch (state) {
      case 'idle':
        return {
          bg: 'bg-slate-900/80 border-slate-700/60 text-slate-400',
          dot: 'bg-slate-500',
          icon: <Mic className="w-3.5 h-3.5 text-slate-400" />,
          title: 'Mic OFF (Ready)',
          subtitle: 'Tap microphone to start continuous hands-free conversation',
        };
      case 'listening':
        return {
          bg: 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.3)]',
          dot: 'bg-cyan-400 animate-ping',
          icon: <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />,
          title: 'Mic ON • Listening Continuously',
          subtitle: 'Speak naturally • Pause when finished (auto-detected)',
        };
      case 'thinking':
        return {
          bg: 'bg-purple-950/80 border-purple-500/50 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]',
          dot: 'bg-purple-400 animate-pulse',
          icon: <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-spin" />,
          title: 'Thinking (Gemini 3.6 Flash)',
          subtitle: 'Evaluating speech turn and extracting intent...',
        };
      case 'tool_running':
        return {
          bg: 'bg-amber-950/80 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
          dot: 'bg-amber-400 animate-ping',
          icon: <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
          title: 'Tool Running (5s Delay)',
          subtitle: 'Executing travel search... Speak anytime to barge-in!',
        };
      case 'speaking':
        return {
          bg: 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]',
          dot: 'bg-emerald-400 animate-pulse',
          icon: <Volume2 className="w-3.5 h-3.5 text-emerald-400" />,
          title: 'AI Speaking (Rime TTS)',
          subtitle: 'Full-duplex mic open • Speak anytime to interrupt!',
        };
      case 'interrupted':
        return {
          bg: 'bg-rose-950/80 border-rose-500/50 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.4)]',
          dot: 'bg-rose-400 animate-ping',
          icon: <Square className="w-3.5 h-3.5 text-rose-400" />,
          title: 'Barge-In Interrupted (< 15ms)',
          subtitle: 'Old turn cancelled • Listening to your new instruction...',
        };
      default:
        return {
          bg: 'bg-slate-900 border-slate-700 text-slate-400',
          dot: 'bg-slate-500',
          icon: <Mic className="w-3.5 h-3.5 text-slate-400" />,
          title: 'Idle',
          subtitle: 'Ready',
        };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="relative w-full max-w-2xl mx-auto rounded-3xl bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-slate-800 p-6 md:p-8 shadow-2xl backdrop-blur-xl flex flex-col items-center gap-6 overflow-hidden">
      {/* Background ambient lighting */}
      <div
        className={`absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none transition-all duration-700 ${
          state === 'listening'
            ? 'bg-cyan-500 opacity-30'
            : state === 'tool_running'
            ? 'bg-amber-500 opacity-35'
            : state === 'speaking'
            ? 'bg-emerald-500 opacity-30'
            : state === 'interrupted'
            ? 'bg-rose-500 opacity-40'
            : 'bg-indigo-500 opacity-15'
        }`}
      />

      {/* Top State Pill Badge */}
      <div className="flex items-center gap-2">
        <div
          className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all duration-300 ${badge.bg}`}
        >
          <span className="relative flex h-2 w-2">
            <span className={`relative inline-flex rounded-full h-2 w-2 ${badge.dot}`} />
          </span>
          {badge.icon}
          <span>{badge.title}</span>
        </div>

        {/* Real Mic Live Volume Indicator */}
        {connectionStatus === 'connected' && isMicActive && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-300">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Mic Vol: {micVolume}%</span>
          </div>
        )}
      </div>

      {/* State Subtitle */}
      <p className="text-xs md:text-sm text-slate-400 text-center max-w-md font-medium min-h-[20px]">
        {badge.subtitle}
      </p>

      {/* Dynamic Audio Waveform with live volume responsiveness */}
      <AudioWaveform state={state} barCount={32} micVolume={micVolume} />

      {/* Live Voice Audio Meter Bar */}
      {isMicActive && (
        <div className="w-full max-w-sm mx-auto px-3.5 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center gap-2.5 shadow-inner">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-400 font-semibold whitespace-nowrap">
            <span className={`w-2 h-2 rounded-full ${micVolume > 5 ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'}`} />
            <span>Voice Input:</span>
          </div>
          <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-75 ease-out shadow-[0_0_8px_rgba(6,182,212,0.6)]"
              style={{ width: `${Math.min(100, Math.max(micVolume > 0 ? 3 : 0, micVolume))}%` }}
            />
          </div>
          <span className={`font-mono text-[11px] font-bold min-w-[32px] text-right ${micVolume > 5 ? 'text-cyan-300' : 'text-slate-500'}`}>
            {micVolume}%
          </span>
        </div>
      )}

      {/* Primary Microphone / Device Selector on Main Voice Interface */}
      <div className="w-full max-w-lg mx-auto bg-slate-950/90 border border-slate-800/90 rounded-2xl p-4 shadow-xl flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Mic className="w-4 h-4 text-cyan-400" />
            <span>Microphone</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Microphone level: <span className={micVolume > 5 ? 'text-cyan-300 font-bold' : 'text-slate-500'}>{micVolume}%</span>
            </span>
          </div>
        </div>

        <div className="relative w-full">
          <select
            data-testid="main-mic-selector"
            aria-label="Microphone Device"
            value={selectedDeviceId}
            onChange={(e) => {
              if (onSelectDevice) {
                onSelectDevice(e.target.value);
              }
            }}
            className="w-full bg-slate-900/95 border border-slate-700/80 hover:border-cyan-500/60 focus:border-cyan-400 text-slate-100 text-xs font-medium rounded-xl px-3.5 py-2.5 outline-none transition appearance-none cursor-pointer pr-9 shadow-inner focus:ring-1 focus:ring-cyan-500/50"
          >
            {audioOptions.map((opt) => (
              <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-100 py-1.5">
                {opt.type === 'system_default'
                  ? '🎙 System Default'
                  : opt.type === 'communications_default'
                  ? '📞 Windows Communications Default'
                  : opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Selected hardware and track status */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-mono text-slate-400 pt-0.5">
          <div className="flex items-center gap-1.5 truncate max-w-[280px]">
            <span className="text-slate-500">Active Track:</span>
            <span className="text-cyan-300 truncate font-semibold">
              {activeDeviceLabel && activeDeviceLabel !== 'None (Mic Inactive)'
                ? activeDeviceLabel
                : diagnostics?.actualLabel
                ? diagnostics.actualLabel
                : selectedDeviceId === 'system_default'
                ? 'System Default'
                : 'Microphone'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">State:</span>
            <span
              className={
                isMicActive && diagnostics?.readyState === 'live'
                  ? 'text-emerald-400 font-bold'
                  : isMicActive
                  ? 'text-emerald-400'
                  : 'text-slate-500'
              }
            >
              {isMicActive ? (diagnostics?.readyState ? diagnostics.readyState.toUpperCase() : 'LIVE') : 'INACTIVE'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Audio & Infrastructure Verification Ribbon */}
      <div className="w-full max-w-lg mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2 px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">LiveKit:</span>
          <span
            className={
              connectionStatus === 'connected'
                ? 'text-emerald-400 font-bold'
                : connectionStatus === 'error'
                ? 'text-rose-400 font-bold'
                : connectionStatus === 'connecting'
                ? 'text-amber-400 font-bold'
                : 'text-slate-500'
            }
          >
            {connectionStatus === 'connected'
              ? 'CONNECTED'
              : connectionStatus === 'error'
              ? 'FAILED'
              : connectionStatus === 'connecting'
              ? 'CONNECTING'
              : 'DISCONNECTED'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Microphone:</span>
          <span className={isMicActive ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
            {isMicActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Track:</span>
          <span className={isAudioTrackLive ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
            {isAudioTrackLive ? 'LIVE' : 'ENDED'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Mic level:</span>
          <span className={micVolume > 5 ? 'text-cyan-300 font-bold' : 'text-slate-400'}>
            {micVolume}%
          </span>
        </div>
      </div>

      {/* Permission Denied Alert */}
      {micPermission === 'denied' && (
        <div className="w-full max-w-md bg-rose-950/60 border border-rose-500/60 rounded-xl p-3.5 text-rose-300 text-xs flex items-center gap-3 animate-fadeIn">
          <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-bold">Microphone Access Denied</div>
            <div className="text-[11px] text-rose-200/80 mt-0.5">
              Please click the camera/microphone icon in your browser URL bar to allow microphone access, then refresh.
            </div>
          </div>
          <button
            onClick={onConnect}
            className="px-2.5 py-1 rounded bg-rose-900 hover:bg-rose-800 text-white text-[11px] font-semibold transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Prominent LiveKit / Infrastructure Connection Error Banner */}
      {errorMessage && micPermission !== 'denied' && (
        <div className="w-full max-w-lg bg-rose-950/70 border border-rose-500/70 rounded-2xl p-4 text-rose-200 text-xs flex items-start gap-3 shadow-xl animate-fadeIn">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="font-bold text-rose-300 text-sm">LiveKit Connection Failed</div>
            <div className="text-[12px] leading-relaxed text-rose-200 font-sans">{errorMessage}</div>
          </div>
          <button
            onClick={onConnect}
            className="px-3 py-1.5 rounded-lg bg-rose-900 hover:bg-rose-800 text-white text-xs font-semibold transition shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tool Running Countdown Bar */}
      {state === 'tool_running' && (
        <div className="w-full max-w-md bg-slate-950/80 border border-amber-500/40 rounded-xl p-3.5 space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-amber-400 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Simulated Travel Tool Running</span>
            </div>
            <span className="font-mono text-amber-300 font-bold">
              {toolRemainingSeconds.toFixed(1)}s left
            </span>
          </div>

          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-100 ease-linear rounded-full shadow-[0_0_8px_rgba(245,158,11,0.5)]"
              style={{ width: `${toolProgress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              Test barge-in interruption now
            </span>
            <button
              onClick={onInterruptClick}
              className="px-2.5 py-1 rounded bg-rose-950/70 hover:bg-rose-900 border border-rose-500/50 text-rose-300 text-[10px] font-bold uppercase tracking-wider transition shadow-sm hover:scale-105"
            >
              Interrupt Now
            </button>
          </div>
        </div>
      )}

      {/* Interruption Notice Banner */}
      {state === 'interrupted' && (
        <div className="w-full max-w-md bg-rose-950/50 border border-rose-500/50 rounded-xl p-3 text-rose-300 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-rose-400 flex-shrink-0 animate-bounce" />
            <div>
              <div className="font-bold">Ghost Audio Blocked</div>
              <div className="text-[11px] text-rose-300/80">
                Stale result cancelled before reaching speaker
              </div>
            </div>
          </div>
          <span className="font-mono text-[11px] font-bold bg-rose-900/60 px-2 py-0.5 rounded border border-rose-700/50">
            {interruptionCutoffMs}ms Cutoff
          </span>
        </div>
      )}

      {/* Main Controls Centerpiece */}
      <div className="flex items-center gap-5 mt-1">
        {/* Mute/Unmute Mic Toggle (visible when connected) */}
        {connectionStatus === 'connected' && (
          <button
            onClick={onToggleMicMute}
            className={`p-3 rounded-full border transition ${
              isMicActive
                ? 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
                : 'bg-rose-950/70 hover:bg-rose-900 border-rose-500 text-rose-300'
            }`}
            title={isMicActive ? 'Mute Microphone' : 'Unmute Microphone'}
          >
            {isMicActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>
        )}

        {/* Primary Microphone Button */}
        <button
          onClick={onMicClick}
          data-testid="center-mic-button"
          aria-label="Microphone"
          className={`relative group rounded-full p-6 transition-all duration-300 transform active:scale-95 ${
            state === 'listening'
              ? 'bg-gradient-to-tr from-cyan-500 to-sky-400 text-slate-950 shadow-[0_0_35px_rgba(56,189,248,0.7)] scale-110'
              : state === 'speaking'
              ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.6)]'
              : state === 'tool_running'
              ? 'bg-gradient-to-tr from-amber-500 to-orange-400 text-slate-950 shadow-[0_0_30px_rgba(245,158,11,0.6)]'
              : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border-2 border-slate-700 hover:border-cyan-500/50 shadow-lg'
          }`}
          title={state === 'listening' ? 'Mic ON (Listening) • Click to turn OFF' : 'Mic OFF • Click to start continuous voice'}
        >
          {state === 'speaking' ? (
            <Volume2 className="w-8 h-8 fill-current" />
          ) : (
            <Mic className="w-8 h-8" />
          )}

          {/* Pulse ring when listening */}
          {state === 'listening' && (
            <span className="absolute -inset-2 rounded-full border-2 border-cyan-400/50 animate-ping pointer-events-none" />
          )}
        </button>

        {/* Rapid Barge-in Interruption Button (accessible during tool run or AI speech) */}
        {(state === 'tool_running' || state === 'speaking') && (
          <button
            onClick={onInterruptClick}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition transform hover:scale-105 active:scale-95 animate-pulse"
            title="Simulate user interrupting while assistant is busy"
          >
            <Zap className="w-4 h-4 fill-current" />
            <span>Interrupt</span>
          </button>
        )}
      </div>

      <div className="text-[11px] text-slate-500 font-medium text-center">
        {state === 'listening'
          ? 'Mic ON • Continuous listening active (pause when finished speaking)'
          : state === 'speaking'
          ? 'Assistant speaking via Rime • Speak anytime to interrupt'
          : state === 'tool_running'
          ? 'Executing tool (5s delay) • Speak anytime to interrupt'
          : 'Tap microphone to start hands-free voice session'}
      </div>
    </div>
  );
};
