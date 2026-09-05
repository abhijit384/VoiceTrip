import type { FC } from 'react';
import { User, Sparkles, Volume2, Mic, Radio } from 'lucide-react';
import type { VoiceState } from '../types/voice';

interface LiveTranscriptsProps {
  userTranscript: string;
  partialTranscript?: string;
  aiTranscript: string;
  state: VoiceState;
  isStreaming?: boolean;
  sttProvider?: string;
  speechVolume?: number;
}

export const LiveTranscripts: FC<LiveTranscriptsProps> = ({
  userTranscript,
  partialTranscript = '',
  aiTranscript,
  state,
  isStreaming = false,
  sttProvider = 'Deepgram Flux',
  speechVolume = 0,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Live User Transcript Card */}
      <div className="relative rounded-2xl bg-slate-900/80 border border-slate-800 p-4 md:p-5 flex flex-col justify-between shadow-lg backdrop-blur-md min-h-[160px] hover:border-slate-700 transition">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
              <User className="w-4 h-4" />
              <span>Live User Transcript</span>
            </div>
            {isStreaming && (
              <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-500/30 animate-pulse">
                <Radio className="w-3 h-3 text-cyan-400 animate-spin" />
                Live STT
              </span>
            )}
          </div>

          <div className="text-sm leading-relaxed space-y-1">
            {/* Show finalized text if available */}
            {userTranscript && (
              <p className="text-slate-100 font-medium">
                {userTranscript}
              </p>
            )}

            {/* Show interim/partial text live */}
            {partialTranscript ? (
              <p className="text-cyan-300 italic font-mono flex items-center gap-1.5 animate-fadeIn">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping inline-block" />
                <span>"{partialTranscript}"</span>
                <span className="text-[10px] uppercase font-sans px-1 py-0.2 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
                  interim
                </span>
              </p>
            ) : (
              !userTranscript && (
                <p className="text-slate-500 italic">
                  Awaiting spoken input... Speak naturally into your microphone
                </p>
              )
            )}
          </div>

          {/* Real-time Voice Audio Level Progress Bar */}
          <div className="mt-3.5 p-2 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <div className="flex items-center justify-between text-[10px] mb-1 font-mono">
              <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                <span className={`w-2 h-2 rounded-full ${speechVolume > 5 ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'}`} />
                <span>Voice Input Level</span>
              </span>
              <span className={`font-bold ${speechVolume > 5 ? 'text-cyan-300' : 'text-slate-500'}`}>
                {speechVolume}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800/80">
              <div
                className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-75 ease-out shadow-[0_0_8px_rgba(6,182,212,0.6)]"
                style={{ width: `${Math.min(100, Math.max(speechVolume > 0 ? 3 : 0, speechVolume))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <Mic className="w-3 h-3 text-sky-400" />
            Provider: <strong className="text-slate-300 capitalize">{sttProvider.replace('_', ' ')}</strong>
          </span>
          <span>Barge-in: Active</span>
        </div>
      </div>

      {/* Live AI Transcript Card (Rime TTS Spoken Output) */}
      <div className="relative rounded-2xl bg-slate-900/80 border border-slate-800 p-4 md:p-5 flex flex-col justify-between shadow-lg backdrop-blur-md min-h-[150px] hover:border-slate-700 transition">
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
