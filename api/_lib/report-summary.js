const VALID_CORRECTION_TYPES = new Set([
  "grammar",
  "collocation",
  "vocabulary",
  "naturalness",
  "structure",
]);

const VALID_LEVELS = new Set(["beginner", "intermediate", "advanced"]);

function normalizeLevel(value) {
  const level = String(value ?? "").toLowerCase();
  return VALID_LEVELS.has(level) ? level : "intermediate";
}

function normalizeCorrectionType(value) {
  const type = String(value ?? "").toLowerCase();
  return VALID_CORRECTION_TYPES.has(type) ? type : "naturalness";
}

function normalizeFrequency(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(numberValue));
}

function buildCorrectionSummary(corrections) {
  if (!Array.isArray(corrections)) {
    return [];
  }

  return corrections
    .map((correction) => {
      const original = String(correction?.original ?? "").trim();
      const corrected = String(correction?.corrected ?? "").trim();
      if (!original || !corrected) {
        return null;
      }

      const frequency = normalizeFrequency(correction?.frequency);
      return {
        original,
        corrected,
        type: normalizeCorrectionType(correction?.type),
        ...(frequency ? { frequency } : {}),
      };
    })
    .filter(Boolean);
}

/** Build the lightweight report summary stored beside the full report payload. */
export function buildReportSummary(report, createdAtFallback) {
  const corrections = buildCorrectionSummary(report?.corrections);

  return {
    schemaVersion: 1,
    sessionId: String(report?.sessionId ?? "").trim(),
    createdAt: String(report?.createdAt ?? createdAtFallback ?? new Date().toISOString()),
    userLevel: normalizeLevel(report?.userLevel),
    correctionCount: corrections.length,
    corrections,
    growth: {
      sayBetterCount: Array.isArray(report?.growth?.sayBetter) ? report.growth.sayBetter.length : 0,
      newExpressionCount: Array.isArray(report?.growth?.newExpressions)
        ? report.growth.newExpressions.length
        : 0,
      talkMoreCount: Array.isArray(report?.growth?.talkMore) ? report.growth.talkMore.length : 0,
    },
  };
}
