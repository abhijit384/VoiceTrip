import { useState, useEffect } from 'react';
import {
  Mic,
  Radio,
  Sparkles,
  Train,
  CheckCircle2,
  AlertCircle,
  Clock,
  Volume2,
  RefreshCw,
  Cpu,
  Layers,
} from 'lucide-react';

interface BackendHealth {
  status: string;
  app: string;
  version: string;
  timestamp: number;
  services: {
    rime_tts: {
      configured: boolean;
      model: string;
      speaker: string;
      endpoint: string;
    };
    groq_llm: {
      configured: boolean;
      model: string;
    };
    deepgram_stt: {
      configured: boolean;
      model: string;
    };
    livekit: {
      configured: boolean;
    };
    tool_delay_seconds: number;
  };
}

export default function App() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:8000/api/health');
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backend unreachable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col items-center justify-between p-4 md:p-8 selection:bg-cyan-500/20">
      {/* Top Navigation */}
      <header className="w-full max-w-5xl flex items-center justify-between py-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Train className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400">
              Rime Voice Travel
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              Realtime Voice Assistant with Interruption & Stale Guard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchHealth}
            title="Refresh Backend Status"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              health?.status === 'healthy'
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-950/40 text-rose-400 border-rose-500/30'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                health?.status === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            {health?.status === 'healthy' ? 'FastAPI Online' : 'Backend Offline'}
          </div>
        </div>
      </header>

      {/* Main Interactive Stage */}
      <main className="w-full max-w-5xl flex-1 flex flex-col items-center justify-center my-8 gap-8">
        {/* Core Tagline Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs font-medium backdrop-blur-sm">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Rime Hackathon Challenge • Voice-Native Architecture</span>
        </div>

        {/* Visualizer & Mic Hero */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative group">
            {/* Outer Glow Halo */}
            <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-full blur-xl opacity-30 group-hover:opacity-60 transition duration-1000"></div>

            {/* Mic Centerpiece */}
            <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-slate-700/80 flex flex-col items-center justify-center shadow-2xl transition transform group-hover:scale-105">
              <Mic className="w-12 h-12 text-cyan-400 mb-1 animate-pulse-subtle" />
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400">
                Phase 1 Ready
              </span>
            </div>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Voice Travel Assistant
            </h2>
            <p className="text-sm text-slate-400 max-w-md">
              Engineered to test barge-in interruptions during 5-second simulated IRCTC travel searches with zero stale audio leakage.
            </p>
          </div>
        </div>

        {/* Service Health Cards Grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Rime TTS */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur flex flex-col justify-between hover:border-slate-700 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <span>Primary Voice: Rime</span>
              </div>
              {health?.services?.rime_tts.configured ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Ready for Key
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 space-y-0.5">
              <div>Speaker: <span className="text-slate-200">{health?.services?.rime_tts.speaker ?? 'amber'}</span></div>
              <div>Model: <span className="text-slate-200">{health?.services?.rime_tts.model ?? 'mist'}</span></div>
            </div>
          </div>

          {/* Card 2: Groq LLM */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur flex flex-col justify-between hover:border-slate-700 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span>LLM: Groq Free Tier</span>
              </div>
              {health?.services?.groq_llm.configured ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Ready for Key
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 space-y-0.5">
              <div>Model: <span className="text-slate-200 truncate block">{health?.services?.groq_llm.model ?? 'llama-3.3-70b'}</span></div>
              <div>Tier: <span className="text-emerald-400">Zero-Cost Cloud</span></div>
            </div>
          </div>

          {/* Card 3: Deepgram STT & LiveKit */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur flex flex-col justify-between hover:border-slate-700 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
                <Radio className="w-4 h-4 text-purple-400" />
                <span>Realtime & STT</span>
              </div>
              <CheckCircle2 className="w-4 h-4 text-slate-500" />
            </div>
            <div className="text-xs text-slate-400 space-y-0.5">
              <div>STT: <span className="text-slate-200">Deepgram Nova-2</span></div>
              <div>Transport: <span className="text-slate-200">LiveKit / WebRTC</span></div>
            </div>
          </div>

          {/* Card 4: Tool Delay */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur flex flex-col justify-between hover:border-slate-700 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Stress-Test Tool</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {health?.services?.tool_delay_seconds ?? 5.0}s delay
              </span>
            </div>
            <div className="text-xs text-slate-400 space-y-0.5">
              <div>Tool: <span className="text-slate-200">IRCTC Train Search</span></div>
              <div>Interruption: <span className="text-emerald-400">Cancelable Task</span></div>
            </div>
          </div>
        </div>

        {/* Acceptance Demo Flow Preview */}
        <div className="w-full p-5 rounded-2xl bg-gradient-to-b from-slate-900/90 to-slate-950 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Core Hackathon Acceptance Test Preview</span>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 font-mono">
              Generation Epoch Protocol
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 space-y-1">
              <div className="font-semibold text-sky-400">Step 1: User Request</div>
              <div className="italic text-slate-300">"Find me trains from Kolkata to Delhi tomorrow."</div>
              <div className="text-[11px] text-slate-400">Spawns generation <span className="font-mono text-cyan-300">gen_1</span> & starts 5s search.</div>
            </div>

            <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 space-y-1">
              <div className="font-semibold text-amber-400">Step 2: Mid-Search Interruption</div>
              <div className="italic text-slate-300">"Actually, only evening trains."</div>
              <div className="text-[11px] text-amber-200/80">Immediately aborts <span className="font-mono text-amber-300">gen_1</span> audio, cancels task, invalidates stale results.</div>
            </div>

            <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 space-y-1">
              <div className="font-semibold text-emerald-400">Step 3: Stale Guard & Rime Recovery</div>
              <div className="italic text-slate-300">"Here are the evening trains: Howrah Rajdhani at 16:55..."</div>
              <div className="text-[11px] text-emerald-200/80">Spoken via <span className="font-mono text-emerald-300">Rime TTS</span> under <span className="font-mono text-cyan-300">gen_2</span>.</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error} — ensure backend is running with `python main.py`</span>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-4">
        <span>Rime Voice Travel Assistant • Phase 1</span>
        <span>FastAPI + Vite + React + Tailwind CSS</span>
      </footer>
    </div>
  );
}
