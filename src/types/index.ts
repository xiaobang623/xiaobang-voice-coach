export interface TopicOption {
  id: string;
  title: string;
  description: string;
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
