import React from 'react';
import {
  MessageSquare,
  MessageSquarePlus,
  Trash2,
  X,
  Compass,
  Clock,
  ChevronRight,
} from 'lucide-react';
import type { ChatSession } from '../types/voice';

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string, e: React.MouseEvent) => void;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
}) => {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-xs sm:max-w-sm bg-slate-950 border-r border-slate-800 h-full flex flex-col z-10 shadow-2xl animate-slide-right">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-teal-400 p-0.5">
              <div className="w-full h-full rounded-[10px] bg-slate-950 flex items-center justify-center text-cyan-400">
                <Compass className="w-4 h-4" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Chat History</h2>
              <p className="text-[10px] text-slate-400">Previous travel conversations</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-4 border-b border-slate-800/80">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            id="sidebar-new-chat-btn"
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-cyan-950/40 transition transform active:scale-98"
          >
            <MessageSquarePlus className="w-4 h-4 text-slate-950" />
            <span>+ New Chat</span>
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
              <p>No previous chats yet.</p>
              <p className="text-[10px] mt-1 text-slate-600">Start speaking or typing to create a chat!</p>
            </div>
          ) : (
            sessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              const msgCount = sess.turns?.length || 0;

              return (
                <div
                  key={sess.id}
                  onClick={() => {
                    onSelectSession(sess.id);
                    onClose();
                  }}
                  className={`group relative p-3 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between gap-2.5 ${
                    isActive
                      ? 'bg-cyan-950/40 border-cyan-700/60 text-cyan-100 shadow-sm shadow-cyan-950/50 ring-1 ring-cyan-500/30'
                      : 'bg-slate-900/40 border-slate-800/80 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold truncate text-xs ${isActive ? 'text-white' : 'text-slate-200'}`}>
                        {sess.title || 'Travel Search'}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                        <span>{formatTime(sess.updatedAt || sess.createdAt)}</span>
                        <span>•</span>
                        <span>{msgCount} message{msgCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => onDeleteSession(sess.id, e)}
                        className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition opacity-0 group-hover:opacity-100"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isActive && <ChevronRight className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800/80 text-[10px] text-slate-500 text-center">
          <span>VoiceTrip • Multi-turn Voice Travel Assistant</span>
        </div>
      </div>
    </div>
  );
};
