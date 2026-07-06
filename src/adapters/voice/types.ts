export interface VoiceConfig {
  sessionId: string;
  token: string;
  userId?: string;
  guestId?: string;
  language?: string;
  /** Doubao TTS voice_type. Omitted => proxy fills a default. */
  voiceType?: string;
  /** Doubao TTS speed_ratio (0.8–2.0). Omitted => server default (1.0). */
  speedRatio?: number;
  /** Full system_role for the Coach (topic-aware opening). */
  systemPrompt?: string;
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
  /** Send a text query (ChatTextQuery / event 501) to trigger a spoken reply. */
  sendTextQuery(text: string): void;
  /** Read aloud via SayHello (event 300) when text query is unavailable. */
  sayHello(text: string): void;
  on(
    event: "transcript" | "bot-message" | "tts-audio" | "realtime-hint" | "error",
    handler: (payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error) => void,
  ): void;
}
