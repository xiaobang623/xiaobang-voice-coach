export interface VoiceConfig {
  sessionId: string;
  token: string;
  language?: string;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface RealtimeHintEvent {
  message: string;
  level: "info" | "warning";
}

export interface BotMessageEvent {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface VoiceAdapter {
  connect(config: VoiceConfig): Promise<void>;
  disconnect(): void;
  sendAudio(chunk: ArrayBuffer): void;
  on(
    event: "transcript" | "bot-message" | "tts-audio" | "realtime-hint" | "error",
    handler: (payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error) => void,
  ): void;
}
