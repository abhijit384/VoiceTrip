import type { FC } from 'react';
import { User, Sparkles, Volume2, Mic } from 'lucide-react';
import type { VoiceState } from '../types/voice';

interface LiveTranscriptsProps {
  userTranscript: string;
  aiTranscript: string;
  state: VoiceState;
}

export const LiveTranscripts: FC<LiveTranscriptsProps> = ({
  userTranscript,
  aiTranscript,
  state,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Live User Transcript Card */}
      <div className="relative rounded-2xl bg-slate-900/80 border border-slate-800 p-4 md:p-5 flex flex-col justify-between shadow-lg backdrop-blur-md min-h-[140px] hover:border-slate-700 transition">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
              <User className="w-4 h-4" />
              <span>Live User Transcript</span>
            </div>
            {state === 'listening' && (
              <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-500/30 animate-pulse">
                <Mic className="w-3 h-3 text-cyan-400" />
                Listening
              </span>
            )}
          </div>

          <p
            className={`text-sm leading-relaxed ${
              userTranscript
                ? 'text-slate-100 font-medium'
                : 'text-slate-500 italic'
            }`}
          >
            {userTranscript || 'Awaiting spoken input... ("Find me trains from Kolkata to Delhi tomorrow")'}
          </p>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
          <span>Speech-to-Text: Deepgram Nova-2</span>
          <span>Barge-in: Active</span>
        </div>
      </div>

      {/* Live AI Transcript Card (Rime TTS Spoken Output) */}
      <div className="relative rounded-2xl bg-slate-900/80 border border-slate-800 p-4 md:p-5 flex flex-col justify-between shadow-lg backdrop-blur-md min-h-[140px] hover:border-slate-700 transition">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Sparkles className="w-4 h-4" />
              <span>Spoken Output (Rime TTS)</span>
            </div>
            {state === 'speaking' && (
              <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-300 border border-emerald-500/30 animate-pulse">
                <Volume2 className="w-3 h-3 text-emerald-400" />
                Speaking
              </span>
            )}
          </div>

          <p
            className={`text-sm leading-relaxed ${
              aiTranscript
                ? 'text-slate-100 font-medium'
                : 'text-slate-500 italic'
            }`}
          >
            {aiTranscript || 'Assistant response will be spoken via Rime TTS...'}
          </p>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
          <span>Primary Voice: Rime (Amber)</span>
          <span>Format: 24kHz MP3</span>
        </div>
      </div>
    </div>
  );
};
