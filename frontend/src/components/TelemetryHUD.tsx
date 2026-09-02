import type { FC } from 'react';
import { Activity, Zap, Clock, Volume2, ShieldAlert } from 'lucide-react';
import type { LatencyMetrics } from '../types/voice';

interface TelemetryHUDProps {
  metrics: LatencyMetrics;
  staleResultsDropped: number;
}

export const TelemetryHUD: FC<TelemetryHUDProps> = ({
  metrics,
  staleResultsDropped,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto rounded-2xl bg-slate-950/70 border border-slate-800/80 p-4 backdrop-blur-md">
      <div className="flex items-center justify-between mb-3 border-b border-slate-800/60 pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span>Realtime Voice Telemetry & Interruption Observability</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Active Telemetry</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
        {/* Metric 1: STT Latency */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col justify-between">
          <div className="text-slate-400 text-[10px] uppercase font-semibold flex items-center gap-1">
            <Clock className="w-3 h-3 text-sky-400" />
            STT Latency
          </div>
          <div className="text-base font-bold font-mono text-sky-300 mt-1">
            {metrics.transcriptionMs > 0 ? `${metrics.transcriptionMs} ms` : '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Deepgram Nova-2</div>
        </div>

        {/* Metric 2: Tool Execution Time */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col justify-between">
          <div className="text-slate-400 text-[10px] uppercase font-semibold flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-400" />
            Tool Duration
          </div>
          <div className="text-base font-bold font-mono text-amber-300 mt-1">
            {metrics.toolExecutionMs > 0 ? `${(metrics.toolExecutionMs / 1000).toFixed(2)} s` : '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">5.0s Fixed Stress Test</div>
        </div>

        {/* Metric 3: Interruption Audio Cutoff */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col justify-between">
          <div className="text-slate-400 text-[10px] uppercase font-semibold flex items-center gap-1">
            <Zap className="w-3 h-3 text-rose-400" />
            Audio Cutoff
          </div>
          <div className="text-base font-bold font-mono text-rose-300 mt-1">
            {metrics.interruptionCutoffMs > 0 ? `${metrics.interruptionCutoffMs} ms` : '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Ghost Audio Halted</div>
        </div>

        {/* Metric 4: Rime TTS TTFB */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col justify-between">
          <div className="text-slate-400 text-[10px] uppercase font-semibold flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-emerald-400" />
            Rime TTS TTFB
          </div>
          <div className="text-base font-bold font-mono text-emerald-300 mt-1">
            {metrics.ttsFirstByteMs > 0 ? `${metrics.ttsFirstByteMs} ms` : '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Time to 1st Audio Byte</div>
        </div>

        {/* Metric 5: Stale Results Blocked */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="text-slate-400 text-[10px] uppercase font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-cyan-400" />
            Stale Dropped
          </div>
          <div className="text-base font-bold font-mono text-cyan-300 mt-1">
            {staleResultsDropped}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Zero Leakage Guard</div>
        </div>
      </div>
    </div>
  );
};
