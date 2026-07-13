export type PracticeMode = "chat" | "task";

export interface TopicOption {
  id: string;
  title: string;
  description: string;
  /** Shown in the chat screen so the user knows what to expect after picking a topic. */
  openingHint?: string;
  /** Spoken aloud by the Coach right after connecting, so the Coach opens the conversation. */
  greeting?: string;
  /**
   * English guidance appended to the Coach's system_role so the opening line
   * actually sticks to the chosen topic. "" / undefined = free talk.
   */
  promptSeed?: string;
  /** Defaults to "chat" for backward compatibility. */
  mode?: PracticeMode;
}

export interface TaskGoal {
  id: string;
  /** Display text for the user (Chinese). */
  desc: string;
  /** English hint injected into the Coach system_role. */
  coachHint: string;
}

export interface TaskScenario extends TopicOption {
  mode: "task";
  category: "life" | "work";
  /** Who the Coach plays and the scene setup. */
  roleSetup: string;
  /** Hand-written goals; empty array means LLM generates on entry (future). */
  goals: TaskGoal[];
}

export type TaskGoalStatus = "done" | "partial" | "missed";

export interface TaskResult {
  goalId: string;
  status: TaskGoalStatus;
  /** One-sentence reason in Chinese. */
  reason: string;
}

/** A selectable TTS voice. `id` is the Doubao `voice_type` sent upstream. */
export interface VoiceOption {
  id: string;
  label: string;
  /** @deprecated UI uses VoiceAvatar initials instead */
  emoji?: string;
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

/** Saved practice defaults (voice / speed / subtitle). */
export interface UserPreferences {
  voiceType: string;
  speedRatio: number;
  showSubtitle: boolean;
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

/** A correct-but-plain sentence the user said, upgraded to a richer version. */
export interface GrowthSayBetter {
  original: string;
  upgraded: string;
  note: string;
}

/** A topic-relevant spoken chunk / pattern worth learning. */
export interface GrowthNewExpression {
  phrase: string;
  meaning: string;
  example: string;
}

/** An angle the user could expand on next time, with a ready-to-use opener. */
export interface GrowthTalkMore {
  angle: string;
  starter: string;
}

/** 口语提升包 — helps the user say more / say it better, beyond error fixing. */
export interface ReportGrowth {
  topic: string;
  sayBetter: GrowthSayBetter[];
  newExpressions: GrowthNewExpression[];
  talkMore: GrowthTalkMore[];
}

export interface ReportJSON {
  sessionId: string;
  createdAt: string;
  durationSeconds: number;
  userLevel: UserLevel;
  corrections: Correction[];
  /** 口语提升包：下次这样说 / 新表达 / 还能聊什么。Absent on old reports or very short sessions. */
  growth?: ReportGrowth;
  /** Present only for task-mode sessions. */
  taskResults?: TaskResult[];
  /** e.g. "2/3" — count of done goals over total. */
  taskScore?: string;
}

/** Compact learner profile stored in memory.summary. */
export interface MemorySummary {
  userLevel: UserLevel;
  topics: string[];
  frequentMistakes: string[];
  coachNotes: string;
  updatedAt: string;
}

export interface FrequentMistakeStat {
  original: string;
  corrected: string;
  type: CorrectionType;
  count: number;
}

/** Aggregated growth metrics for the growth page. */
export interface GrowthStats {
  sessionCount: number;
  totalDurationSeconds: number;
  currentStreakDays: number;
  longestStreakDays: number;
  latestUserLevel: UserLevel | null;
  frequentMistakes: FrequentMistakeStat[];
}

/** One past session report for the history list on the growth page. */
export interface ReportHistoryItem {
  sessionId: string;
  createdAt: string;
  topic: string | null;
  durationSeconds: number;
  userLevel: UserLevel;
  correctionCount: number;
  /** Loaded on demand when the user expands a history row. */
  report?: ReportJSON;
}

/** Combined payload for the growth page (stats + lightweight history list). */
export interface GrowthPageData {
  stats: GrowthStats;
  history: ReportHistoryItem[];
}
