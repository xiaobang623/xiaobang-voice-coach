export interface VoiceModelOverrides {
  doubaoDialogModel?: string;
  asrProvider?: string;
  platformNativeAsrLocale?: string;
  ttsProvider?: string;
  siliconflowTtsVoice?: string;
  whisperModel?: string;
  deepseekModel?: string;
  cosyvoiceModelKey?: string;
}

export interface VoiceConfig {
  sessionId: string;
  token: string;
  /** Short-lived signed proxy-auth token from /api/issue-voice-token. */
  voiceToken?: string;
  userId?: string;
  guestId?: string;
  language?: string;
  /** Doubao TTS voice_type. Omitted => proxy fills a default. */
  voiceType?: string;
  /** Doubao TTS speed_ratio (0.8–2.0). Omitted => server default (1.0). */
  speedRatio?: number;
  /** Full system_role for the Coach (topic-aware opening). */
  systemPrompt?: string;
  /** Admin-resolved model overrides for the active voice backend. */
  modelOverrides?: VoiceModelOverrides;
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
  endAsr(source?: "silence" | "stop"): void;
  /** Send a text query (ChatTextQuery / event 501) to trigger a spoken reply. */
  sendTextQuery(text: string): void;
  /**
   * 反悔合并：用完整合并句替换上一轮 text query——后端撤销上一轮问答
   * （含正在生成的回复），对完整句子重新回答。仅自建后端支持。
   */
  amendTextQuery?(text: string): void;
  /** Read aloud via SayHello (event 300) when text query is unavailable. */
  sayHello(text: string): void;
  on(
    event: "transcript" | "bot-message" | "tts-audio" | "realtime-hint" | "error",
    handler: (payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error) => void,
  ): void;
}
