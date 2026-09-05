import { useState } from 'react';
import type { FC } from 'react';
import { Activity, Mic, Cpu, Wrench, Volume2, Play, Loader2 } from 'lucide-react';
import { getApiBase } from '../config';

interface ComponentDiagnosticsProps {
  onPlayRimeTest: (text: string) => Promise<void>;
  onRunToolTest: () => Promise<void>;
  isMicActive: boolean;
  micVolume: number;
}

export const ComponentDiagnostics: FC<ComponentDiagnosticsProps> = ({
  onPlayRimeTest,
  onRunToolTest,
  isMicActive,
  micVolume,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [customRimeText, setCustomRimeText] = useState<string>('Hello! This is a test of Rime Text to Speech.');
  const [llmTestResult, setLlmTestResult] = useState<string | null>(null);
  const [llmTesting, setLlmTesting] = useState<boolean>(false);
  const [toolTestResult, setToolTestResult] = useState<string | null>(null);
  const [toolTesting, setToolTesting] = useState<boolean>(false);
  const [rimeTesting, setRimeTesting] = useState<boolean>(false);
  const [rimeTestStatus, setRimeTestStatus] = useState<string | null>(null);

  // Test LLM (Groq Chat)
  const runLlmTest = async () => {
    setLlmTesting(true);
    setLlmTestResult(null);
    try {
      const res = await fetch(`${getApiBase()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'diag_test',
          message: 'Reply in one short sentence: What is the capital of India?',
          generation_id: 'diag_1',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLlmTestResult(data.text || JSON.stringify(data.tool_calls || data));
    } catch (e: any) {
      setLlmTestResult(`Error: ${e.message}`);
    } finally {
      setLlmTesting(false);
    }
  };

  // Test Tool (Train Search 5s delay & result)
  const runToolDiagnostic = async () => {
    setToolTesting(true);
    setToolTestResult('Executing search_trains tool with 5.0s intentional delay...');
    try {
      await onRunToolTest();
      const res = await fetch(`${getApiBase()}/api/tools/search_trains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: 'Kolkata',
          destination: 'Delhi',
          date: 'tomorrow',
          generation_id: 'diag_tool_1',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setToolTestResult(`Success! Found ${data.trains_found} trains in ${(data.execution_time_ms / 1000).toFixed(2)}s.`);
    } catch (e: any) {
      setToolTestResult(`Error: ${e.message}`);
    } finally {
      setToolTesting(false);
    }
  };

  // Test Rime (Synthesize custom text & play)
  const runRimeTest = async () => {
    if (!customRimeText.trim()) return;
    setRimeTesting(true);
    setRimeTestStatus('Synthesizing speech via Rime...');
    try {
      await onPlayRimeTest(customRimeText.trim());
      setRimeTestStatus('Playback started successfully!');
    } catch (e: any) {
      setRimeTestStatus(`Playback error: ${e.message}`);
    } finally {
      setRimeTesting(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto rounded-2xl bg-slate-950/80 border border-slate-800 shadow-xl overflow-hidden text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="diagnostics-toggle-btn"
        className="w-full px-4 py-3 bg-slate-900/80 hover:bg-slate-800/80 border-b border-slate-800 flex items-center justify-between text-slate-300 transition"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-slate-200">Component Diagnostic Suite (Fallback Debug Mode)</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
            Isolated Component Tests
          </span>
        </div>
        <span className="text-slate-400 font-mono text-[11px]">{isOpen ? 'Hide Diagnostics [-]' : 'Run Diagnostics [+]'}</span>
      </button>

      {isOpen && (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-950/60">
          {/* 1. Microphone Test */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-cyan-400 font-semibold mb-2">
                <Mic className="w-4 h-4" />
                <span>1. Microphone Test</span>
              </div>
              <p className="text-slate-400 text-[11px] mb-3">
                Tests hardware microphone capture and live RMS audio energy levels.
              </p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-slate-400">Stream Status:</span>
                <span className={`font-semibold ${isMicActive ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isMicActive ? 'Live & Capturing' : 'Inactive (Click Mic to enable)'}
                </span>
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden mb-1">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-75"
                  style={{ width: `${Math.min(100, micVolume * 2)}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 font-mono">RMS Level: {micVolume}%</span>
            </div>
          </div>

          {/* 2. STT Test */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-sky-400 font-semibold mb-2">
                <Activity className="w-4 h-4" />
                <span>2. STT Speech Test</span>
              </div>
              <p className="text-slate-400 text-[11px] mb-3">
                Speak into your mic: live partial & final transcripts appear continuously in the main card.
              </p>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-300 min-h-[48px] flex items-center">
                {isMicActive ? 'Microphone open • Speak any sentence naturally...' : 'Click Center Mic ON to begin listening.'}
              </div>
            </div>
          </div>

          {/* 3. LLM (Google Gemini 3.6 Flash) Test */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-purple-400 font-semibold mb-2">
                <Cpu className="w-4 h-4" />
                <span>3. LLM Test (Gemini 3.6 Flash)</span>
              </div>
              <p className="text-slate-400 text-[11px] mb-2">
                Sends test request directly to Gemini backend API.
              </p>
              {llmTestResult && (
                <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] text-purple-300 mb-2 break-words">
                  {llmTestResult}
                </div>
              )}
            </div>
            <button
              onClick={runLlmTest}
              disabled={llmTesting}
              className="mt-3 w-full py-2 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            >
              {llmTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Test LLM API</span>
            </button>
          </div>

          {/* 4. Tool Execution Test */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-400 font-semibold mb-2">
                <Wrench className="w-4 h-4" />
                <span>4. Tool Test (5s Delay)</span>
              </div>
              <p className="text-slate-400 text-[11px] mb-2">
                Executes IRCTC train search tool with the intentional 5-second delay.
              </p>
              {toolTestResult && (
                <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] text-amber-300 mb-2 break-words">
                  {toolTestResult}
                </div>
              )}
            </div>
            <button
              onClick={runToolDiagnostic}
              disabled={toolTesting}
              className="mt-3 w-full py-2 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-white font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            >
              {toolTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Run Tool Benchmark</span>
            </button>
          </div>

          {/* 5. Rime TTS Test */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between lg:col-span-2">
            <div>
              <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-2">
                <Volume2 className="w-4 h-4" />
                <span>5. Rime TTS Playback Test</span>
              </div>
              <p className="text-slate-400 text-[11px] mb-2">
                Enter text below to synthesize directly through Rime and play through the audio element.
              </p>
              <input
                type="text"
                value={customRimeText}
                onChange={(e) => setCustomRimeText(e.target.value)}
                className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 text-[11px] font-sans focus:outline-none focus:border-emerald-500 mb-2"
                placeholder="Enter text to speak via Rime..."
              />
              {rimeTestStatus && (
                <div className="p-1.5 rounded bg-slate-950 text-[11px] text-emerald-300 mb-1">
                  {rimeTestStatus}
                </div>
              )}
            </div>
            <button
              onClick={runRimeTest}
              disabled={rimeTesting}
              className="mt-2 w-full py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            >
              {rimeTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Synthesize & Play Rime Audio</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
