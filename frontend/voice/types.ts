// Voice Engine type definitions

export enum VoiceState {
  IDLE = 'idle',
  WAKE_LISTENING = 'wake_listening',
  COMMAND_LISTENING = 'command_listening',
  PROCESSING = 'processing',
  SPEAKING = 'speaking',
  ERROR = 'error',
}

export interface VoiceCommand {
  type:
    | 'start_detection'
    | 'stop_detection'
    | 'navigate_to'
    | 'stop_navigation'
    | 'where_am_i'
    | 'emergency'
    | 'unknown';
  raw: string;
  params?: { location?: string };
}

export interface VoiceEngineCallbacks {
  startDetection: () => void;
  stopDetection: () => void;
  startNavigation: (location: string) => void;
  stopNavigation: () => void;
  speakCurrentLocation: () => void;
  triggerSOS: () => void;
}

export interface VoiceEngineState {
  state: VoiceState;
  isWakeWordActive: boolean;
  lastCommand: VoiceCommand | null;
  error: string | null;
}
