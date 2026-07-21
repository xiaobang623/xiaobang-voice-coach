import type { Correction, CorrectionType, ReportJSON, UserLevel } from "../types";

export interface ReportSummaryCorrection {
  original: string;
  corrected: string;
  type: CorrectionType;
  frequency?: number;
}

export interface ReportSummaryGrowth {
  sayBetterCount: number;
  newExpressionCount: number;
  talkMoreCount: number;
}

export interface ReportSummary {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  userLevel: UserLevel;
  correctionCount: number;
  corrections: ReportSummaryCorrection[];
  growth: ReportSummaryGrowth;
}

const VALID_CORRECTION_TYPES = new Set<CorrectionType>([
  "grammar",
  "collocation",
  "vocabulary",
  "naturalness",
  "structure",
]);

const VALID_LEVELS = new Set<UserLevel>(["beginner", "intermediate", "advanced"]);

function normalizeLevel(value: unknown): UserLevel {
  const level = String(value ?? "").toLowerCase();
  return VALID_LEVELS.has(level as UserLevel) ? (level as UserLevel) : "intermediate";
}

function normalizeCorrectionType(value: unknown): CorrectionType {
  const type = String(value ?? "").toLowerCase();
  return VALID_CORRECTION_TYPES.has(type as CorrectionType)
    ? (type as CorrectionType)
    : "naturalness";
}

function normalizeFrequency(value: unknown): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(numberValue));
}

function buildCorrectionSummary(corrections: Correction[]): ReportSummaryCorrection[] {
  return corrections
    .map((correction) => {
      const original = String(correction.original ?? "").trim();
      const corrected = String(correction.corrected ?? "").trim();
      if (!original || !corrected) {
        return null;
      }

      const frequency = normalizeFrequency(correction.frequency);
      return {
        original,
        corrected,
        type: normalizeCorrectionType(correction.type),
        ...(frequency ? { frequency } : {}),
      } satisfies ReportSummaryCorrection;
    })
    .filter((correction): correction is ReportSummaryCorrection => Boolean(correction));
}

/** Build the lightweight report summary stored beside the full report payload. */
export function buildReportSummary(report: ReportJSON, createdAtFallback?: string): ReportSummary {
  const corrections = buildCorrectionSummary(Array.isArray(report.corrections) ? report.corrections : []);

  return {
    schemaVersion: 1,
    sessionId: String(report.sessionId ?? "").trim(),
    createdAt: String(report.createdAt ?? createdAtFallback ?? new Date().toISOString()),
    userLevel: normalizeLevel(report.userLevel),
    correctionCount: corrections.length,
    corrections,
    growth: {
      sayBetterCount: Array.isArray(report.growth?.sayBetter) ? report.growth.sayBetter.length : 0,
      newExpressionCount: Array.isArray(report.growth?.newExpressions)
        ? report.growth.newExpressions.length
        : 0,
      talkMoreCount: Array.isArray(report.growth?.talkMore) ? report.growth.talkMore.length : 0,
    },
  };
}

/** Parse a reports.summary jsonb value defensively for old or malformed rows. */
export function normalizeReportSummary(raw: unknown): Partial<ReportSummary> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return null;
  }

  const corrections = Array.isArray(record.corrections)
    ? record.corrections
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const correction = item as Record<string, unknown>;
          const original = String(correction.original ?? "").trim();
          const corrected = String(correction.corrected ?? "").trim();
          if (!original || !corrected) {
            return null;
          }
          const frequency = normalizeFrequency(correction.frequency);
          return {
            original,
            corrected,
            type: normalizeCorrectionType(correction.type),
            ...(frequency ? { frequency } : {}),
          } satisfies ReportSummaryCorrection;
        })
        .filter((item): item is ReportSummaryCorrection => Boolean(item))
    : [];

  const correctionCount = Number(record.correctionCount);
  const growthRecord = record.growth && typeof record.growth === "object"
    ? (record.growth as Record<string, unknown>)
    : {};

  return {
    schemaVersion: 1,
    sessionId: String(record.sessionId ?? "").trim(),
    createdAt: String(record.createdAt ?? "").trim(),
    userLevel: normalizeLevel(record.userLevel),
    correctionCount: Number.isFinite(correctionCount) ? Math.max(0, correctionCount) : corrections.length,
    corrections,
    growth: {
      sayBetterCount: Math.max(0, Number(growthRecord.sayBetterCount ?? 0) || 0),
      newExpressionCount: Math.max(0, Number(growthRecord.newExpressionCount ?? 0) || 0),
      talkMoreCount: Math.max(0, Number(growthRecord.talkMoreCount ?? 0) || 0),
    },
  };
}
