import type { FC } from 'react';
import { Play, Sparkles, Zap } from 'lucide-react';
import type { VoiceState } from '../types/voice';

interface DemoScenariosProps {
  onRunAcceptanceTest: () => void;
  onRunNormalSearch: () => void;
  onRunSpeechInterruption: () => void;
  onManualStateChange: (state: VoiceState) => void;
  isSimulating: boolean;
  currentState: VoiceState;
}

export const DemoScenarios: FC<DemoScenariosProps> = ({
  onRunAcceptanceTest,
  onRunNormalSearch,
  onRunSpeechInterruption,
  onManualStateChange,
  isSimulating,
  currentState,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto p-5 rounded-2xl bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Interactive Voice Stress Tests & Hackathon Scenarios</span>
          </h3>
          <p className="text-[11px] text-slate-400">
            Simulate realistic multi-turn voice flows, barge-ins, and 5-second tool cancellations.
          </p>
        </div>

        {isSimulating && (
          <span className="self-start sm:self-auto px-2.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-mono text-xs flex items-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            Simulation Running...
          </span>
        )}
      </div>

      {/* Main One-Click Scenario Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Scenario 1: Acceptance Test */}
        <button
          onClick={onRunAcceptanceTest}
          disabled={isSimulating}
          className="relative group p-3.5 rounded-xl bg-gradient-to-tr from-cyan-950/60 via-slate-900 to-indigo-950/40 border border-cyan-500/40 hover:border-cyan-400 transition-all text-left shadow-md hover:shadow-cyan-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 uppercase tracking-wider">
              ⭐ Core Acceptance Test
            </span>
            <Play className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-125 transition" />
          </div>
          <div className="font-bold text-xs text-slate-100">Barge-in During 5s Search</div>
          <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">
            Kolkata to Delhi → User interrupts at 2.5s with "Actually, only evening trains" → Old result staled → Evening trains spoken.
          </div>
        </button>

        {/* Scenario 2: Normal Search */}
        <button
          onClick={onRunNormalSearch}
          disabled={isSimulating}
          className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all text-left shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 uppercase tracking-wider">
              Standard Flow
            </span>
            <Play className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="font-bold text-xs text-slate-200">Uninterrupted Travel Query</div>
          <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">
            Completes full 5-second simulated lookup and speaks entire morning + evening schedule via Rime TTS.
          </div>
        </button>

        {/* Scenario 3: Interruption During Speech */}
        <button
          onClick={onRunSpeechInterruption}
          disabled={isSimulating}
          className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all text-left shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 uppercase tracking-wider">
              Audio Cutoff Test
            </span>
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="font-bold text-xs text-slate-200">Interrupt During Rime Speech</div>
          <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">
            Assistant speaks audio response; user barges in midway; audio halts within 30ms and recovers seamlessly.
          </div>
        </button>
      </div>

      {/* Manual State Selector Strip */}
      <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[11px] font-medium text-slate-400">Manual State Tester:</span>
        {(['idle', 'listening', 'thinking', 'tool_running', 'speaking', 'interrupted'] as VoiceState[]).map(
          (state) => {
            const isActive = currentState === state;
            return (
              <button
                key={state}
                onClick={() => onManualStateChange(state)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono capitalize transition ${
                  isActive
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/50'
                }`}
              >
                {state.replace('_', ' ')}
              </button>
            );
          }
        )}
      </div>
    </div>
  );
};
