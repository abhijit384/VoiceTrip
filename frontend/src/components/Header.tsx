import type { FC } from 'react';
import { Train, RotateCcw, Activity, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  generationId: string;
  isConnected: boolean;
  onReset: () => void;
  latencyPing: number;
}

export const Header: FC<HeaderProps> = ({
  generationId,
  isConnected,
  onReset,
  latencyPing,
}) => {
  return (
    <header className="w-full max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 md:px-6 border-b border-slate-800/80 bg-slate-950/40 backdrop-blur-md rounded-2xl">
      {/* Brand & Name */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 ring-1 ring-cyan-400/30">
              <Train className="w-5 h-5 text-white" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center">
                Voice<span className="text-cyan-400">Trip</span>
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-950/70 border border-cyan-500/40 text-cyan-300">
                Rime Voice Native
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              Realtime Travel Assistant • Interruption & Stale Protection
            </p>
          </div>
        </div>

        {/* Small Screen Reset Button */}
        <button
          onClick={onReset}
          className="sm:hidden p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/50 transition-colors"
          title="Reset conversation"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Status Badges & Controls */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
        {/* Generation Epoch Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono text-slate-300">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-500 text-[10px] uppercase font-sans">Epoch:</span>
          <span className="font-bold text-cyan-300">{generationId}</span>
        </div>

        {/* Connection Status */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            isConnected
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-950/40 text-rose-300 border-rose-500/30'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {isConnected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isConnected ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
            />
          </span>
          <span>{isConnected ? 'Realtime Voice' : 'Disconnected'}</span>
          {isConnected && (
            <span className="text-[10px] font-mono text-emerald-400/80 flex items-center gap-0.5">
              <Activity className="w-3 h-3 inline" />
              {latencyPing}ms
            </span>
          )}
        </div>

        {/* Desktop Reset Button */}
        <button
          onClick={onReset}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 transition text-xs font-medium shadow-sm hover:border-slate-600"
          title="Reset conversation state and generation epoch"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
          <span>Reset</span>
        </button>
      </div>
    </header>
  );
};
