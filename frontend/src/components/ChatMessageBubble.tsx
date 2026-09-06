import React from 'react';
import { User, Bot, Volume2, Sparkles } from 'lucide-react';
import type { ConversationTurn } from '../types/voice';
import { TravelResultCards } from './TravelResultCards';

interface ChatMessageBubbleProps {
  turn: ConversationTurn;
  onPlayVoice?: (text: string) => void;
  isPlayingVoice?: boolean;
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  turn,
  onPlayVoice,
  isPlayingVoice = false,
}) => {
  const isUser = turn.sender === 'user';

  // Format message text into clean readable paragraphs/bullets without raw tokens
  const renderFormattedContent = (content: string) => {
    if (!content) return null;

    // Split by newlines
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);

    return (
      <div className="space-y-2 text-sm leading-relaxed">
        {lines.map((line, idx) => {
          // Handle bullet lines
          if (line.startsWith('- ') || line.startsWith('• ') || line.startsWith('* ')) {
            const cleanLine = line.replace(/^[-•*]\s+/, '');
            return (
              <div key={idx} className="flex items-start gap-2 pl-1">
                <span className="text-cyan-400 mt-1 font-bold text-xs">•</span>
                <span className="text-slate-200">{cleanLine}</span>
              </div>
            );
          }

          // Handle numbered lines (1. 2. etc)
          const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
          if (numMatch) {
            return (
              <div key={idx} className="flex items-start gap-2 pl-1">
                <span className="text-cyan-400 font-semibold text-xs min-w-[16px]">{numMatch[1]}.</span>
                <span className="text-slate-200">{numMatch[2]}</span>
              </div>
            );
          }

          // Standard paragraph
          return (
            <p key={idx} className={isUser ? 'text-cyan-50 font-normal' : 'text-slate-200 font-normal'}>
              {line}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`w-full flex gap-3.5 group transition-all duration-300 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* Assistant Avatar on Left */}
      {!isUser && (
        <div className="flex-shrink-0 pt-0.5">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-gradient-to-tr from-purple-600 via-cyan-500 to-teal-400 p-[1.5px] shadow-md shadow-cyan-950/40 flex items-center justify-center">
            <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center text-cyan-300">
              <Bot className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </div>
          </div>
        </div>
      )}

      {/* Message Body Container */}
      <div
        className={`max-w-[88%] sm:max-w-[80%] flex flex-col gap-1.5 ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        {/* Sender Name & Timestamp Header */}
        <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-300 flex items-center gap-1">
            {isUser ? 'You' : 'VoiceTrip'}
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-500 font-mono text-[10px]">{turn.timestamp}</span>
        </div>

        {/* Message Bubble Card */}
        <div
          className={`relative p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-lg backdrop-blur-md transition-all ${
            isUser
              ? 'bg-gradient-to-br from-cyan-950/60 via-slate-900/80 to-slate-950/90 border border-cyan-700/40 text-cyan-50 rounded-tr-sm shadow-cyan-950/20'
              : 'bg-gradient-to-br from-slate-900/90 via-slate-950/95 to-slate-950 border border-slate-800/80 text-slate-100 rounded-tl-sm shadow-purple-950/10'
          }`}
        >
          {/* Loading / Thinking State (ChatGPT-style) */}
          {turn.isLoading ? (
            <div className="flex items-center gap-3 py-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse [animation-delay:200ms]" />
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse [animation-delay:400ms]" />
              </div>
              <span className="text-xs font-medium text-cyan-300 animate-pulse">
                {turn.loadingStatus || 'Thinking...'}
              </span>
            </div>
          ) : (
            <>
              {/* Message Content */}
              {renderFormattedContent(turn.text)}

              {/* STT Autocorrection Indicator (Subtle compact pill for user message) */}
              {isUser && turn.wasCorrected && turn.rawTranscript && turn.rawTranscript.toLowerCase() !== turn.text.toLowerCase() && (
                <div className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-800/40 text-[11px] text-cyan-300/90 font-mono w-fit">
                  <Sparkles className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                  <span>Heard: "{turn.rawTranscript}"</span>
                </div>
              )}

              {/* Attached Travel Result Cards inside Assistant Turn */}
              {!isUser && turn.toolDetails?.rawResult && (
                <div className="mt-4 pt-3 border-t border-slate-800/80 w-full">
                  <TravelResultCards
                    toolName={turn.toolDetails.toolName}
                    toolResults={turn.toolDetails.rawResult}
                  />
                </div>
              )}

              {/* Voice Replay Button for Assistant Turn */}
              {!isUser && onPlayVoice && turn.text && (
                <div className="mt-2 pt-2 flex items-center justify-between border-t border-slate-800/40 text-[11px]">
                  <button
                    onClick={() => onPlayVoice(turn.text)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 transition"
                    title="Play voice audio for this message"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{isPlayingVoice ? 'Speaking...' : 'Play Voice'}</span>
                  </button>
                  <span className="text-[10px] text-slate-600 font-mono">Rime Mist</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* User Avatar on Right */}
      {isUser && (
        <div className="flex-shrink-0 pt-0.5">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-gradient-to-tr from-cyan-500 to-teal-400 p-[1.5px] shadow-md shadow-cyan-950/40 flex items-center justify-center">
            <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center text-cyan-400">
              <User className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
