import type { FC } from 'react';
import {
  User,
  Sparkles,
  Train,
  AlertOctagon,
  Clock,
  CheckCircle,
  XCircle,
  Volume2,
} from 'lucide-react';
import type { ConversationTurn } from '../types/voice';

interface ConversationFeedProps {
  turns: ConversationTurn[];
}

export const ConversationFeed: FC<ConversationFeedProps> = ({ turns }) => {
  if (turns.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
        <Train className="w-8 h-8 text-slate-600" />
        <span>No conversation history yet. Start by tapping the microphone or trigger the Acceptance Test below.</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between px-2 text-xs font-semibold text-slate-400">
        <span>Conversation History & Epoch Ledger</span>
        <span>{turns.length} Turn{turns.length > 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-3">
        {turns.map((turn) => {
          const isUser = turn.sender === 'user';

          return (
            <div
              key={turn.id}
              className={`p-4 rounded-2xl border transition-all ${
                turn.isStale
                  ? 'bg-rose-950/20 border-rose-500/30 opacity-70'
                  : turn.isInterrupted
                  ? 'bg-amber-950/25 border-amber-500/40'
                  : isUser
                  ? 'bg-slate-900/90 border-slate-800'
                  : 'bg-gradient-to-r from-slate-900/90 to-indigo-950/40 border-indigo-900/40 shadow-md'
              }`}
            >
              {/* Header Info */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      isUser
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-xs font-semibold text-slate-200">
                    {isUser ? 'User' : 'VoiceTrip (Rime Spoken Output)'}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    {turn.generationId}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {turn.isStale && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                      <XCircle className="w-3 h-3" />
                      Stale Tool Result Blocked
                    </span>
                  )}
                  {turn.isInterrupted && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      <AlertOctagon className="w-3 h-3" />
                      Interrupted
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">{turn.timestamp}</span>
                </div>
              </div>

              {/* Message Content */}
              <p className="text-sm text-slate-100 pl-8 leading-relaxed font-normal">
                {turn.text}
              </p>

              {/* Tool Execution Details Pill (if present) */}
              {turn.toolDetails && (
                <div className="mt-3 ml-8 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1.5 font-mono text-cyan-300">
                      <Train className="w-3.5 h-3.5" />
                      <span>{turn.toolDetails.toolName}</span>
                      <span>({JSON.stringify(turn.toolDetails.params)})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400" />
                        {turn.toolDetails.executionTimeMs}ms
                      </span>
                      {turn.toolDetails.cancelled ? (
                        <span className="text-rose-400 font-semibold">Cancelled</span>
                      ) : (
                        <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                          <CheckCircle className="w-3 h-3" /> Done
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Render Train Cards if results available */}
                  {turn.toolDetails.results && turn.toolDetails.results.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {turn.toolDetails.results.map((train) => (
                        <div
                          key={train.trainNumber}
                          className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white">
                              {train.trainNumber} • {train.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 uppercase">
                              {train.departureTimeType}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-300 mt-1">
                            <span>{train.departure} → {train.arrival}</span>
                            <span className="text-slate-400 font-mono">{train.duration}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 pt-1 border-t border-slate-800/80">
                            <span>Classes: {train.classes.join(', ')}</span>
                            <span className="font-bold text-emerald-400">{train.price}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Rime Voice Attribution Footer */}
              {!isUser && !turn.isStale && (
                <div className="mt-2 ml-8 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Volume2 className="w-3 h-3 text-cyan-400" />
                  <span>Synthesized with Rime TTS (Amber Voice) • Instant Cutoff Protected</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
