const USAGE_FIELDS = [
  "input_text_tokens",
  "input_audio_tokens",
  "cached_text_tokens",
  "cached_audio_tokens",
  "output_text_tokens",
  "output_audio_tokens",
];

export function createEmptyDoubaoUsageTotals() {
  return {
    input_text_tokens: 0,
    input_audio_tokens: 0,
    cached_text_tokens: 0,
    cached_audio_tokens: 0,
    output_text_tokens: 0,
    output_audio_tokens: 0,
  };
}

export function extractDoubaoUsagePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  return usage;
}

export function mergeDoubaoUsage(totals, usage) {
  if (!usage || typeof usage !== "object") {
    return totals;
  }

  const next = { ...totals };
  for (const field of USAGE_FIELDS) {
    const value = Number(usage[field] ?? 0);
    if (Number.isFinite(value) && value > 0) {
      next[field] += value;
    }
  }
  return next;
}

export function sumDoubaoUsageTokens(totals) {
  return USAGE_FIELDS.reduce((sum, field) => sum + Number(totals[field] ?? 0), 0);
}
