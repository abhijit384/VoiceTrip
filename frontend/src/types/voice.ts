export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'tool_running'
  | 'speaking'
  | 'interrupted';

export type PipelineInitState =
  | 'INITIALIZING'
  | 'MIC_READY'
  | 'LIVEKIT_READY'
  | 'STT_CONNECTING'
  | 'STT_READY'
  | 'VOICE_READY';

export interface TrainOption {
  trainNumber: string;
  name: string;
  departure: string;
  arrival: string;
  duration: string;
  departureTimeType: 'morning' | 'afternoon' | 'evening' | 'night';
  classes: string[];
  price: string;
}

export interface FlightOption {
  flight_number: string;
  airline: string;
  departure: string;
  arrival: string;
  duration: string;
  departure_time_type: string;
  stops: string;
  cabin_class: string;
  price: string;
  origin_city: string;
  destination_city: string;
}

export interface HotelOption {
  hotel_id: string;
  name: string;
  location: string;
  destination: string;
  rating: number;
  price_per_night: number;
  price_formatted: string;
  amenities: string[];
  room_type: string;
}

export interface RouteOption {
  mode: string;
  title: string;
  duration: string;
  estimated_cost: string;
  description: string;
  transfers: number;
}

export interface DestinationInfoOption {
  destination: string;
  best_time_to_visit: string;
  top_attractions: string[];
  local_tips: string[];
  overview: string;
}

export interface ToolDetails {
  toolName: string;
  toolType?: 'train' | 'flight' | 'hotel' | 'route' | 'destination' | 'general';
  params: Record<string, any>;
  executionTimeMs: number;
  cancelled?: boolean;
  source?: 'demo' | 'live';
  results?: any[];
  rawResult?: any;
}

export interface ConversationTurn {
  id: string;
  generationId: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  rawTranscript?: string;
  correctedTranscript?: string;
  wasCorrected?: boolean;
  corrections?: any[];
  timestamp: string;
  intent?: string;
  state?: VoiceState;
  isStale?: boolean;
  isInterrupted?: boolean;
  toolDetails?: ToolDetails;
}

export interface LatencyMetrics {
  speechToEndMs: number;
  transcriptionMs: number;
  toolExecutionMs: number;
  interruptionCutoffMs: number;
  ttsFirstByteMs: number;
  totalRoundtripMs: number;
}
