import type { FC } from 'react';
import {
  User,
  Sparkles,
  Train,
  Plane,
  Building2,
  Navigation,
  MapPin,
  AlertOctagon,
  CheckCircle,
  XCircle,
  Volume2,
  Compass,
  Star,
} from 'lucide-react';
import type { ConversationTurn } from '../types/voice';

interface ConversationFeedProps {
  turns: ConversationTurn[];
}

export const ConversationFeed: FC<ConversationFeedProps> = ({ turns }) => {
  if (turns.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
        <Compass className="w-8 h-8 text-slate-600 animate-spin-slow" />
        <span>No conversation history yet. Tap the microphone to ask about flights, hotels, trains, or trip ideas.</span>
      </div>
    );
  }

  const getToolIcon = (name?: string) => {
    if (!name) return <Compass className="w-3.5 h-3.5" />;
    if (name.includes('flight')) return <Plane className="w-3.5 h-3.5" />;
    if (name.includes('hotel')) return <Building2 className="w-3.5 h-3.5" />;
    if (name.includes('route')) return <Navigation className="w-3.5 h-3.5" />;
    if (name.includes('dest')) return <MapPin className="w-3.5 h-3.5" />;
    return <Train className="w-3.5 h-3.5" />;
  };

  const getToolDisplayName = (name?: string) => {
    if (!name) return 'Travel options found';
    if (name.includes('flight')) return 'Flight options found';
    if (name.includes('hotel')) return 'Hotel options found';
    if (name.includes('train')) return 'Train options found';
    if (name.includes('route')) return 'Travel options found';
    if (name.includes('dest')) return 'Travel options found';
    return 'Travel options found';
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between px-2 text-xs font-semibold text-slate-400">
        <span>Conversation History</span>
        <span>{turns.length} Turn{turns.length > 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-3">
        {turns.map((turn) => {
          const isUser = turn.sender === 'user';
          const tool = turn.toolDetails;
          const rawResult = tool?.rawResult || {};

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

              {/* Tool Execution Details Pill */}
              {tool && (
                <div className="mt-3 ml-8 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1.5 font-medium text-cyan-300">
                      {getToolIcon(tool.toolName)}
                      <span>{getToolDisplayName(tool.toolName)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {tool.cancelled ? (
                        <span className="text-rose-400 font-semibold">Cancelled</span>
                      ) : (
                        <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                          <CheckCircle className="w-3 h-3" /> Done
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 1. Train Cards */}
                  {tool.toolName === 'search_trains' && tool.results && tool.results.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {tool.results.map((train: any) => (
                        <div
                          key={train.trainNumber || train.train_number}
                          className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white flex items-center gap-1.5">
                              <Train className="w-3.5 h-3.5 text-cyan-400" />
                              {train.trainNumber || train.train_number} • {train.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 uppercase font-medium">
                              {train.departureTimeType || train.departure_time_type}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-300 mt-1.5">
                            <span>{train.departure} → {train.arrival}</span>
                            <span className="text-slate-400 font-mono">{train.duration}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/80">
                            <span>Classes: {Array.isArray(train.classes) ? train.classes.join(', ') : '2A, 3A, SL'}</span>
                            <span className="font-bold text-emerald-400">{train.price}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 2. Flight Cards */}
                  {tool.toolName === 'search_flights' && tool.results && tool.results.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {tool.results.map((flight: any) => (
                        <div
                          key={flight.flight_number}
                          className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between hover:border-sky-500/40 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white flex items-center gap-1.5">
                              <Plane className="w-3.5 h-3.5 text-sky-400" />
                              {flight.airline} {flight.flight_number}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-500/30 uppercase font-medium">
                              {flight.stops || 'Non-stop'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-300 mt-1.5">
                            <span>{flight.departure} → {flight.arrival}</span>
                            <span className="text-slate-400 font-mono">{flight.duration}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/80">
                            <span>{flight.cabin_class || 'Economy'}</span>
                            <span className="font-bold text-emerald-400">{flight.price}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 3. Hotel Cards */}
                  {tool.toolName === 'search_hotels' && tool.results && tool.results.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {tool.results.map((hotel: any) => (
                        <div
                          key={hotel.hotel_id || hotel.name}
                          className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between hover:border-emerald-500/40 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                              {hotel.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 font-medium flex items-center gap-0.5">
                              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                              {hotel.rating}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {hotel.location} • {hotel.room_type}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/80">
                            <span>{Array.isArray(hotel.amenities) ? hotel.amenities.slice(0, 2).join(' • ') : ''}</span>
                            <span className="font-bold text-emerald-400">{hotel.price_formatted}/night</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 4. Route Options Cards */}
                  {tool.toolName === 'get_route_options' && tool.results && tool.results.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 mt-2">
                      {tool.results.map((route: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col gap-1 hover:border-purple-500/40 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white flex items-center gap-1.5">
                              <Navigation className="w-3.5 h-3.5 text-purple-400" />
                              {route.mode} • {route.title}
                            </span>
                            <span className="font-bold text-xs text-emerald-400">{route.estimated_cost}</span>
                          </div>
                          <p className="text-[11px] text-slate-300">{route.description}</p>
                          <div className="text-[10px] text-slate-400 flex items-center gap-3">
                            <span>Duration: {route.duration}</span>
                            <span>Transfers: {route.transfers}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 5. Destination Info Cards */}
                  {tool.toolName === 'get_destination_info' && rawResult && (
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2 mt-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-white flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-rose-400" />
                          Destination Guide: {rawResult.destination}
                        </span>
                        <span className="text-[10px] text-cyan-300 font-medium">
                          Best Season: {rawResult.best_time_to_visit}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300">{rawResult.overview}</p>
                      {rawResult.top_attractions && (
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Top Sights:</span>
                          <p className="text-[11px] text-slate-200 mt-0.5">
                            {rawResult.top_attractions.join(' • ')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-slate-500 italic text-center pt-1 tracking-wide">
                    Prototype data — not live availability
                  </p>
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
