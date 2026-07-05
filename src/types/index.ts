export interface TopicOption {
  id: string;
  title: string;
  description: string;
  /**
   * English guidance appended to the Coach's system_role so the opening line
   * actually sticks to the chosen topic. "" / undefined = free talk.
   */
  promptSeed?: string;
}

/** A selectable TTS voice. `id` is the Doubao `voice_type` sent upstream. */
export interface VoiceOption {
  id: string;
  label: string;
  emoji: string;
  /** true once confirmed to actually produce sound on the current account. */
  verified?: boolean;
}

/** A selectable speaking speed. `ratio` maps to Doubao `speed_ratio` (0.8–2.0). */
export interface SpeedOption {
  id: "slow" | "normal" | "fast";
  label: string;
  ratio: number;
}

/** Per-conversation personalization resolved before `start()`. */
export interface SessionSettings {
  voiceType: string;
  speedRatio: number;
  /** Full system_role for the Coach, already merged with the topic seed. */
  systemPrompt: string;
}

export type CorrectionType =
  | "grammar"
  | "collocation"
  | "vocabulary"
  | "naturalness"
  | "structure";

export type CorrectionSeverity = "minor" | "important" | "critical";

export type UserLevel = "beginner" | "intermediate" | "advanced";

export interface Correction {
  original: string;
  corrected: string;
  type: CorrectionType;
  explanation: string;
  frequency?: number;
  severity?: CorrectionSeverity;
  example?: string;
}

export interface ReportJSON {
  sessionId: string;
  createdAt: string;
  durationSeconds: number;
  userLevel: UserLevel;
  corrections: Correction[];
}
