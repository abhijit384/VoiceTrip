import React from 'react';
import {
  Train,
  Plane,
  Building2,
  MapPin,
  Clock,
  Star,
  Navigation,
  Sparkles,
  ArrowRight,
  Info,
  CheckCircle2,
  Search,
} from 'lucide-react';

interface TrainItem {
  train_number?: string;
  train_name?: string;
  name?: string;
  departure_time?: string;
  departure?: string;
  arrival_time?: string;
  arrival?: string;
  duration?: string;
  price?: string | number;
  fare?: string | number;
  class_type?: string;
  classes?: string[];
  days_of_run?: string[];
}

interface FlightItem {
  flight_number?: string;
  airline?: string;
  departure_time?: string;
  departure?: string;
  arrival_time?: string;
  arrival?: string;
  duration?: string;
  price?: string | number;
  stops?: string;
}

interface HotelItem {
  hotel_name?: string;
  name?: string;
  location?: string;
  rating?: string | number;
  price?: string | number;
  price_formatted?: string;
  amenities?: string[];
}

interface RouteItem {
  mode?: string;
  duration?: string;
  price?: string;
  transfers?: string;
  description?: string;
}

interface TravelResultCardsProps {
  toolName: string | null;
  toolResults: any;
  canonicalContext?: any;
}

export const TravelResultCards: React.FC<TravelResultCardsProps> = ({ toolName, toolResults, canonicalContext }) => {
  if (!toolResults) return null;

  // Extract results based on type or tool name
  const resType = toolResults.type || toolName || '';
  const isTrain = resType.includes('train');
  const isFlight = resType.includes('flight');
  const isHotel = resType.includes('hotel');
  const isRoute = resType.includes('route');
  const isDestination = resType.includes('destination');

  const origin = toolResults.origin || canonicalContext?.origin || '';
  const destination = toolResults.destination || canonicalContext?.destination || '';
  const travelDate = toolResults.date || toolResults.travel_date || canonicalContext?.travel_date || '';
  const timeConstraint = toolResults.time_constraint || canonicalContext?.time_constraint || '';
  const requestType = canonicalContext?.request_type || 'NEW';
  const previousSummary = canonicalContext?.previous_summary;
  const updatedSummary = canonicalContext?.updated_summary;

  // Render "You searched for" / "Follow-up update" Header Banner (Requirements 15 & 19)
  const renderUnderstoodBanner = () => {
    if (requestType === 'FOLLOW_UP' && previousSummary) {
      return (
        <div className="p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-700/50 shadow-inner flex flex-col gap-2 text-xs animate-slide-up">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-cyan-400">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>Follow-up Request Understood</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 pt-0.5">
            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">Previous:</span>
              <span className="font-medium text-slate-300">{previousSummary}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-cyan-950/80 border border-cyan-600/50">
              <span className="text-[10px] text-cyan-400 uppercase font-semibold block mb-0.5">Updated:</span>
              <span className="font-semibold text-cyan-200">{updatedSummary || previousSummary}</span>
            </div>
          </div>
        </div>
      );
    }

    if (updatedSummary || (origin && destination) || destination) {
      return (
        <div className="p-3 px-4 rounded-2xl bg-slate-950/70 border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shadow-sm animate-slide-up">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-md bg-cyan-500/10 text-cyan-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <span className="text-[11px] uppercase font-bold text-slate-400">You searched for:</span>
            <span className="font-semibold text-slate-100">
              {updatedSummary ? (
                `"${updatedSummary}"`
              ) : origin && destination ? (
                <>
                  "{origin} → {destination}
                  {travelDate && ` • ${travelDate}`}
                  {timeConstraint && timeConstraint !== 'any' ? ` (${timeConstraint})` : ''}"
                </>
              ) : destination ? (
                `"${destination}${travelDate ? ` • ${travelDate}` : ''}"`
              ) : (
                `"Travel options"`
              )}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  // 1. TRAIN RESULTS CARD
  if (isTrain && (toolResults.trains || Array.isArray(toolResults))) {
    const trains: TrainItem[] = toolResults.trains || (Array.isArray(toolResults) ? toolResults : []);

    return (
      <div className="mt-4 flex flex-col gap-3.5 animate-slide-up">
        {renderUnderstoodBanner()}

        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
            <Train className="w-4 h-4 text-emerald-400" />
            Travel Options Found — Trains ({trains.length})
          </h3>
          {(origin || destination) && (
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5 font-medium">
              <span>{origin || 'Origin'}</span>
              <ArrowRight className="w-3 h-3 text-slate-500" />
              <span className="text-slate-200">{destination || 'Destination'}</span>
              {travelDate && <span className="text-cyan-400 ml-1">• {travelDate}</span>}
              {timeConstraint && timeConstraint !== 'any' && (
                <span className="text-amber-400 ml-1 capitalize">({timeConstraint})</span>
              )}
            </span>
          )}
        </div>

        {trains.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 text-center italic">
            No matching train options were found for {origin} → {destination} ({timeConstraint || 'requested time'}).
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {trains.map((train, idx) => {
              const name = train.train_name || train.name || `Train Option ${idx + 1}`;
              const number = train.train_number ? `(#${train.train_number})` : '';
              const dep = train.departure_time || train.departure || '5:30 AM';
              const arr = train.arrival_time || train.arrival || '1:35 PM';
              const duration = train.duration || '8h 05m';
              const price = train.price || train.fare || '₹1,390';

              return (
                <div
                  key={idx}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 transition-all duration-200 shadow-lg flex flex-col justify-between gap-3.5 group hover:shadow-emerald-950/30"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-sm text-white group-hover:text-emerald-300 transition">
                          {name}
                        </h4>
                        {number && <span className="text-[11px] font-mono text-slate-400">{number}</span>}
                      </div>
                      <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 shadow-sm">
                        {price}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-300 bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Departure</span>
                        <span className="font-bold text-slate-100">{dep}</span>
                      </div>
                      <div className="flex flex-col items-center px-2">
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                          <Clock className="w-2.5 h-2.5 text-slate-400" />
                          {duration}
                        </span>
                        <div className="w-16 h-0.5 bg-slate-700/80 my-1 rounded-full relative">
                          <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full absolute -top-0.5 right-0 shadow-[0_0_6px_#34d399]" />
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Arrival</span>
                        <span className="font-bold text-slate-100">{arr}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                    <span>Standard & Executive CC</span>
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Available
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-500 italic text-center pt-1 tracking-wide">
          Prototype data — not live availability
        </p>
      </div>
    );
  }

  // 2. FLIGHT RESULTS CARD
  if (isFlight && (toolResults.flights || Array.isArray(toolResults))) {
    const flights: FlightItem[] = toolResults.flights || (Array.isArray(toolResults) ? toolResults : []);

    return (
      <div className="mt-4 flex flex-col gap-3.5 animate-slide-up">
        {renderUnderstoodBanner()}

        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
            <Plane className="w-4 h-4 text-cyan-400" />
            Travel Options Found — Flights ({flights.length})
          </h3>
          {(origin || destination) && (
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5 font-medium">
              <span>{origin}</span>
              <ArrowRight className="w-3 h-3 text-slate-500" />
              <span className="text-slate-200">{destination}</span>
              {travelDate && <span className="text-cyan-400 ml-1">• {travelDate}</span>}
              {timeConstraint && timeConstraint !== 'any' && (
                <span className="text-amber-400 ml-1 capitalize">({timeConstraint})</span>
              )}
            </span>
          )}
        </div>

        {flights.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 text-center italic">
            No matching flight options were found for {origin} → {destination} ({timeConstraint || 'requested time'}).
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {flights.map((flight, idx) => {
              const airline = flight.airline || 'IndiGo';
              const flightNo = flight.flight_number || `6E-${idx + 101}`;
              const dep = flight.departure_time || flight.departure || '07:15 AM';
              const arr = flight.arrival_time || flight.arrival || '09:30 AM';
              const duration = flight.duration || '2h 15m';
              const price = flight.price || '₹4,850';

              return (
                <div
                  key={idx}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 transition-all duration-200 shadow-lg flex flex-col justify-between gap-3.5 group hover:shadow-cyan-950/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-sm text-white group-hover:text-cyan-300 transition">
                        {airline}
                      </h4>
                      <span className="text-[11px] font-mono text-slate-400">{flightNo} • Non-stop</span>
                    </div>
                    <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 shadow-sm">
                      {price}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Depart</span>
                      <span className="font-bold text-slate-100">{dep}</span>
                    </div>
                    <div className="flex flex-col items-center px-2">
                      <span className="text-[10px] text-slate-400 font-medium">{duration}</span>
                      <div className="w-16 h-0.5 bg-slate-700/80 my-1 rounded-full relative">
                        <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full absolute -top-0.5 right-0 shadow-[0_0_6px_#22d3ee]" />
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Arrive</span>
                      <span className="font-bold text-slate-100">{arr}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                    <span>Cabin: Economy (7kg Baggage)</span>
                    <span className="text-cyan-400 font-medium">Fastest Option</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-500 italic text-center pt-1 tracking-wide">
          Prototype data — not live availability
        </p>
      </div>
    );
  }

  // 3. HOTEL RESULTS CARD
  if (isHotel && (toolResults.hotels || Array.isArray(toolResults))) {
    const hotels: HotelItem[] = toolResults.hotels || (Array.isArray(toolResults) ? toolResults : []);

    return (
      <div className="mt-4 flex flex-col gap-3.5 animate-slide-up">
        {renderUnderstoodBanner()}

        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-amber-400" />
            Travel Options Found — Hotels ({hotels.length})
          </h3>
          {destination && (
            <span className="text-[11px] text-slate-400 font-medium">
              Location: <strong className="text-slate-200">{destination}</strong>
              {canonicalContext?.budget && (
                <span className="text-emerald-400 ml-1.5">• Under ₹{Math.round(canonicalContext.budget).toLocaleString()}</span>
              )}
            </span>
          )}
        </div>

        {hotels.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 text-center italic">
            No matching hotel options were found in {destination} matching your criteria.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {hotels.map((hotel, idx) => {
              const name = hotel.hotel_name || hotel.name || `Hotel Option ${idx + 1}`;
              const loc = hotel.location || destination || 'City Center';
              const rating = hotel.rating || '4.5';
              const price = hotel.price_formatted || (hotel.price ? `₹${hotel.price}/night` : '₹3,500/night');

              return (
                <div
                  key={idx}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-amber-500/50 transition-all duration-200 shadow-lg flex flex-col justify-between gap-3.5 group hover:shadow-amber-950/30"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-sm text-white group-hover:text-amber-300 transition">
                          {name}
                        </h4>
                        <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          {loc}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-950/80 text-amber-400 border border-amber-800/60 text-xs font-semibold shadow-sm">
                        <Star className="w-3 h-3 fill-current text-amber-400" />
                        <span>{rating}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                    <span className="text-slate-400 text-[11px]">Free WiFi • Breakfast Included</span>
                    <span className="font-mono font-bold text-amber-300 text-sm">{price}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-500 italic text-center pt-1 tracking-wide">
          Prototype data — not live availability
        </p>
      </div>
    );
  }

  // 4. ROUTE OR DESTINATION INFO
  if (isRoute && toolResults.routes) {
    const routes: RouteItem[] = toolResults.routes;
    return (
      <div className="mt-4 flex flex-col gap-3.5 animate-slide-up">
        {renderUnderstoodBanner()}
        <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
          <Navigation className="w-4 h-4 text-purple-400" />
          Travel Options Found — Route Overview
        </h3>
        <div className="grid grid-cols-1 gap-2.5">
          {routes.map((r, idx) => (
            <div key={idx} className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-white">{r.mode || 'Multi-modal transit'}</span>
              <span className="text-slate-400">{r.duration}</span>
              <span className="text-purple-300 font-mono font-semibold">{r.price}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 italic text-center pt-1 tracking-wide">
          Prototype data — not live availability
        </p>
      </div>
    );
  }

  if (isDestination && toolResults.top_attractions) {
    return (
      <div className="mt-4 flex flex-col gap-3.5 animate-slide-up">
        {renderUnderstoodBanner()}
        <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          Travel Options Found — {toolResults.destination || 'Destination'}
        </h3>
        <div className="flex flex-wrap gap-2">
          {toolResults.top_attractions.map((att: string, idx: number) => (
            <span key={idx} className="px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 shadow-sm">
              {att}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 italic text-center pt-1 tracking-wide">
          Prototype data — not live availability
        </p>
      </div>
    );
  }

  return null;
};
