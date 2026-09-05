import type { FC } from 'react';
import {
  Play,
  Sparkles,
  Plane,
  Building2,
  MapPin,
  Calendar,
  Compass,
  Train,
  ShieldAlert,
} from 'lucide-react';
import type { VoiceState } from '../types/voice';

interface DemoScenariosProps {
  onRunAcceptanceTest: () => void;
  onRunQuery?: (query: string) => void;
  onSimulateInterruption?: () => void;
  onManualStateChange: (state: VoiceState) => void;
  isSimulating: boolean;
  currentState: VoiceState;
}

export const DemoScenarios: FC<DemoScenariosProps> = ({
  onRunAcceptanceTest,
  onRunQuery,
  onSimulateInterruption,
  onManualStateChange,
  isSimulating,
  currentState,
}) => {
  const triggerQuery = (q: string) => {
    if (onRunQuery) onRunQuery(q);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-5 rounded-2xl bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Interactive Travel Queries & Multi-Intent Scenarios</span>
          </h3>
          <p className="text-[11px] text-slate-400">
            One-click triggers for flights, hotels, trains, routes, destination guides, and multi-turn flows.
          </p>
        </div>

        {isSimulating && (
          <span className="self-start sm:self-auto px-2.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-mono text-xs flex items-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            Executing Voice Flow...
          </span>
        )}
      </div>

      {/* Main Multi-Turn Acceptance Test Banner */}
      <button
        onClick={onRunAcceptanceTest}
        disabled={isSimulating}
        data-testid="core-acceptance-test-btn"
        className="w-full p-3.5 rounded-xl bg-gradient-to-tr from-cyan-950/70 via-slate-900 to-indigo-950/50 border border-cyan-500/40 hover:border-cyan-400 transition-all text-left shadow-md hover:shadow-cyan-500/10 disabled:opacity-50 disabled:cursor-not-allowed group"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 uppercase tracking-wider">
            ⭐ 6-Turn Multi-Intent Acceptance Test
          </span>
          <Play className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-125 transition" />
        </div>
        <div className="font-bold text-xs text-slate-100">
          Trains → Evening Refinement → Goa Hotels → Goa Sights → Flights → Tomorrow Evening Flight
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          Demonstrates seamless context preservation, intent isolation, and zero railway leaks across 6 distinct turns.
        </div>
      </button>

      {/* Grid of Individual Scenario Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {/* 1. Flight Search */}
        <button
          onClick={() => triggerQuery('Find a flight from Kolkata to Delhi tomorrow.')}
          disabled={isSimulating}
          className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-sky-500/40 transition text-left flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-sky-300 font-semibold mb-1">
            <span className="flex items-center gap-1.5"><Plane className="w-3.5 h-3.5" /> Flight Search</span>
            <Play className="w-3 h-3 text-slate-500" />
          </div>
          <p className="text-[11px] text-slate-300">"Find a flight from Kolkata to Delhi tomorrow."</p>
        </button>

        {/* 2. Hotel Search */}
        <button
          onClick={() => triggerQuery('Find hotels in Goa under 5000 rupees.')}
          disabled={isSimulating}
          className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-emerald-500/40 transition text-left flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold mb-1">
            <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Hotel Search</span>
            <Play className="w-3 h-3 text-slate-500" />
          </div>
          <p className="text-[11px] text-slate-300">"Find hotels in Goa under 5000 rupees."</p>
        </button>

        {/* 3. Train Search */}
        <button
          onClick={() => triggerQuery('Find trains from NJP to Howrah tomorrow evening.')}
          disabled={isSimulating}
          className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition text-left flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-cyan-300 font-semibold mb-1">
            <span className="flex items-center gap-1.5"><Train className="w-3.5 h-3.5" /> Train Search</span>
            <Play className="w-3 h-3 text-slate-500" />
          </div>
          <p className="text-[11px] text-slate-300">"Find trains from NJP to Howrah tomorrow evening."</p>
        </button>

        {/* 4. Destination Info */}
        <button
          onClick={() => triggerQuery('What are the best places to visit in Jaipur?')}
          disabled={isSimulating}
          className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-rose-500/40 transition text-left flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-rose-300 font-semibold mb-1">
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Destination Sights</span>
            <Play className="w-3 h-3 text-slate-500" />
          </div>
          <p className="text-[11px] text-slate-300">"What are the best places to visit in Jaipur?"</p>
        </button>

        {/* 5. Itinerary Planning */}
        <button
          onClick={() => triggerQuery('Plan a three day Goa trip.')}
          disabled={isSimulating}
          className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/40 transition text-left flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-purple-300 font-semibold mb-1">
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Trip Planning</span>
            <Play className="w-3 h-3 text-slate-500" />
          </div>
          <p className="text-[11px] text-slate-300">"Plan a three day Goa trip."</p>
        </button>

        {/* 6. Route Multi-Modal */}
        <button
          onClick={() => triggerQuery('How do I get from Kolkata to Darjeeling?')}
          disabled={isSimulating}
          className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 transition text-left flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-amber-300 font-semibold mb-1">
            <span className="flex items-center gap-1.5"><Compass className="w-3.5 h-3.5" /> Route Options</span>
            <Play className="w-3 h-3 text-slate-500" />
          </div>
          <p className="text-[11px] text-slate-300">"How do I get from Kolkata to Darjeeling?"</p>
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

        {onSimulateInterruption && (
          <button
            onClick={onSimulateInterruption}
            disabled={isSimulating}
            className="ml-auto px-2.5 py-1 rounded-lg text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-500/40 hover:bg-amber-900/50 flex items-center gap-1 transition disabled:opacity-50"
          >
            <ShieldAlert className="w-3 h-3 text-amber-400" />
            <span>Test Mid-Sentence Interruption</span>
          </button>
        )}
      </div>
    </div>
  );
};
