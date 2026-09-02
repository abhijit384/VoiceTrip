export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'tool_running'
  | 'speaking'
  | 'interrupted';

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

export interface ConversationTurn {
  id: string;
  generationId: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  state?: VoiceState;
  isStale?: boolean;
  isInterrupted?: boolean;
  toolDetails?: {
    toolName: string;
    params: Record<string, string>;
    executionTimeMs: number;
    cancelled?: boolean;
    results?: TrainOption[];
  };
}

export interface LatencyMetrics {
  speechToEndMs: number;
  transcriptionMs: number;
  toolExecutionMs: number;
  interruptionCutoffMs: number;
  ttsFirstByteMs: number;
  totalRoundtripMs: number;
}
