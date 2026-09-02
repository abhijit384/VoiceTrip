import type { FC } from 'react';
import {
  Mic,
  Square,
  AlertTriangle,
  Loader2,
  Sparkles,
  Volume2,
  Cpu,
  Clock,
  Zap,
} from 'lucide-react';
import type { VoiceState } from '../types/voice';
import { AudioWaveform } from './AudioWaveform';

interface VoiceStatusCardProps {
  state: VoiceState;
  toolProgress: number; // 0 to 100
  toolRemainingSeconds: number;
  onMicClick: () => void;
  onInterruptClick: () => void;
  interruptionCutoffMs: number;
}

export const VoiceStatusCard: FC<VoiceStatusCardProps> = ({
  state,
  toolProgress,
  toolRemainingSeconds,
  onMicClick,
  onInterruptClick,
  interruptionCutoffMs,
}) => {
  // Config for status indicators
  const getStatusBadge = () => {
    switch (state) {
      case 'listening':
        return {
          bg: 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300 shadow-[0_0_15px_rgba(56,189,248,0.3)]',
          dot: 'bg-cyan-400 animate-ping',
          icon: <Mic className="w-3.5 h-3.5 text-cyan-400" />,
          title: 'Listening',
          subtitle: 'Speak your travel request or constraint...',
        };
      case 'thinking':
        return {
          bg: 'bg-indigo-950/80 border-indigo-500/50 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.3)]',
          dot: 'bg-indigo-400 animate-pulse',
          icon: <Cpu className="w-3.5 h-3.5 text-indigo-400" />,
          title: 'Thinking',
          subtitle: 'Groq Llama 3.3 evaluating function calls...',
        };
      case 'tool_running':
        return {
          bg: 'bg-amber-950/80 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
          dot: 'bg-amber-400 animate-ping',
          icon: <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
          title: 'Tool Running (5s Stress Delay)',
          subtitle: 'Searching IRCTC trains: Kolkata to Delhi...',
        };
      case 'speaking':
        return {
          bg: 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]',
          dot: 'bg-emerald-400 animate-pulse',
          icon: <Volume2 className="w-3.5 h-3.5 text-emerald-400" />,
          title: 'AI Speaking (Rime TTS)',
          subtitle: 'Streaming primary voice via Rime Mist model...',
        };
      case 'interrupted':
        return {
          bg: 'bg-rose-950/90 border-rose-500/60 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.4)] animate-bounce',
          dot: 'bg-rose-400',
          icon: <Zap className="w-3.5 h-3.5 text-rose-400" />,
          title: 'Barge-In Interrupted!',
          subtitle: `Audio instantly cut in ${interruptionCutoffMs}ms • Old tool result staled`,
        };
      case 'idle':
      default:
        return {
          bg: 'bg-slate-900/80 border-slate-800 text-slate-300',
          dot: 'bg-slate-500',
          icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
          title: 'Ready',
          subtitle: 'Press microphone or select an acceptance scenario below',
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
      <div
        className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-semibold backdrop-blur-md transition-all duration-300 ${badge.bg}`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`relative inline-flex rounded-full h-2 w-2 ${badge.dot}`} />
        </span>
        {badge.icon}
        <span>{badge.title}</span>
      </div>

      {/* State Subtitle */}
      <p className="text-xs md:text-sm text-slate-400 text-center max-w-md font-medium min-h-[20px]">
        {badge.subtitle}
      </p>

      {/* Dynamic Audio Waveform */}
      <AudioWaveform state={state} barCount={32} />

      {/* Tool Running Countdown Bar (when tool is executing) */}
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

      {/* Large Glowing Microphone & Quick Action Center */}
      <div className="flex items-center gap-6 mt-1">
        {/* Main Microphone Button */}
        <button
          onClick={onMicClick}
          className={`relative group rounded-full p-6 transition-all duration-300 transform active:scale-95 ${
            state === 'listening'
              ? 'bg-gradient-to-tr from-cyan-500 to-sky-400 text-slate-950 shadow-[0_0_35px_rgba(56,189,248,0.7)] scale-110'
              : state === 'speaking'
              ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.6)]'
              : state === 'tool_running'
              ? 'bg-gradient-to-tr from-amber-500 to-orange-400 text-slate-950 shadow-[0_0_30px_rgba(245,158,11,0.6)]'
              : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border-2 border-slate-700 hover:border-cyan-500/50 shadow-lg'
          }`}
          title={state === 'listening' ? 'Stop listening' : 'Start voice input'}
        >
          {state === 'listening' ? (
            <Square className="w-8 h-8 fill-current" />
          ) : (
            <Mic className="w-8 h-8" />
          )}

          {/* Pulse ring when active */}
          {state === 'listening' && (
            <span className="absolute -inset-2 rounded-full border-2 border-cyan-400/50 animate-ping pointer-events-none" />
          )}
        </button>

        {/* Rapid Barge-in Interruption Button (accessible whenever tool is running or AI is speaking) */}
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

      <div className="text-[11px] text-slate-500 font-medium">
        {state === 'listening'
          ? 'Tap mic to complete utterance'
          : state === 'tool_running'
          ? 'Simulating 5.0s IRCTC delay. Interrupt anytime!'
          : state === 'speaking'
          ? 'Rime TTS output streaming. Barge in anytime.'
          : 'Microphone ready. Click to speak.'}
      </div>
    </div>
  );
};
