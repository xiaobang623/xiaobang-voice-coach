import type {
  MemorySummary,
  ReportReusedExpression,
  TrackedExpression,
  TrackedExpressionStatus,
} from "../types";

const TOKEN_SIMILARITY_THRESHOLD = 0.8;
const MIN_TOKENS_FOR_SIMILARITY = 3;

export interface TrackedExpressionReuseResult {
  summary: MemorySummary;
  reusedExpressions: ReportReusedExpression[];
}

interface UserUtterance {
  raw: string;
  normalized: string;
  tokens: string[];
}

function stripSpeakerPrefix(line: string): { speaker: string | null; text: string } {
  const match = line.match(/^\s*(user|coach|assistant|speaker)\s*:\s*(.*)$/i);
  if (!match) {
    return { speaker: null, text: line.trim() };
  }
  return { speaker: match[1].toLowerCase(), text: match[2].trim() };
}

export function normalizeExpressionForMatch(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractUserUtterances(transcript: string): UserUtterance[] {
  if (typeof transcript !== "string" || !transcript.trim()) {
    return [];
  }

  return transcript
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(stripSpeakerPrefix)
    .filter(({ speaker, text }) => speaker === "user" && text.length > 0)
    .map(({ text }) => {
      const normalized = normalizeExpressionForMatch(text);
      return {
        raw: text,
        normalized,
        tokens: normalized ? normalized.split(" ") : [],
      };
    })
    .filter((utterance) => utterance.normalized.length > 0);
}

function tokenSimilarity(targetTokens: string[], candidateTokens: string[]): number {
  if (targetTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateCounts = new Map<string, number>();
  for (const token of candidateTokens) {
    candidateCounts.set(token, (candidateCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const token of targetTokens) {
    const count = candidateCounts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      candidateCounts.set(token, count - 1);
    }
  }

  return overlap / targetTokens.length;
}

function findBestSimilarUtterance(
  targetTokens: string[],
  utterances: UserUtterance[],
): UserUtterance | null {
  let best: { utterance: UserUtterance; score: number } | null = null;

  for (const utterance of utterances) {
    const tokens = utterance.tokens;
    if (tokens.length < Math.max(1, targetTokens.length - 1)) {
      continue;
    }

    const maxWindowSize = Math.min(tokens.length, targetTokens.length + 1);
    const minWindowSize = Math.max(1, targetTokens.length - 1);

    for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize += 1) {
      for (let start = 0; start <= tokens.length - windowSize; start += 1) {
        const windowTokens = tokens.slice(start, start + windowSize);
        const score = tokenSimilarity(targetTokens, windowTokens);
        if (score >= TOKEN_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
          best = { utterance, score };
        }
      }
    }
  }

  return best?.utterance ?? null;
}

function findMatchingUtterance(targetText: string, utterances: UserUtterance[]): UserUtterance | null {
  const normalizedTarget = normalizeExpressionForMatch(targetText);
  if (!normalizedTarget) {
    return null;
  }

  const exact = utterances.find(
    (utterance) =>
      utterance.normalized === normalizedTarget ||
      utterance.normalized.includes(normalizedTarget),
  );
  if (exact) {
    return exact;
  }

  const targetTokens = normalizedTarget.split(" ");
  if (targetTokens.length < MIN_TOKENS_FOR_SIMILARITY) {
    return null;
  }

  return findBestSimilarUtterance(targetTokens, utterances);
}

function nextStatus(reuseCount: number): TrackedExpressionStatus {
  return reuseCount >= 2 ? "mastered" : "reviewing";
}

export function matchTrackedExpressions(
  transcript: string,
  trackedExpressions: TrackedExpression[],
): ReportReusedExpression[] {
  const utterances = extractUserUtterances(transcript);
  if (utterances.length === 0) {
    return [];
  }

  const matches: ReportReusedExpression[] = [];
  const seenIds = new Set<string>();

  for (const expression of trackedExpressions) {
    if (expression.status === "mastered" || seenIds.has(expression.id)) {
      continue;
    }

    const matchingUtterance = findMatchingUtterance(expression.targetText, utterances);
    if (!matchingUtterance) {
      continue;
    }

    const reuseCount = Math.max(0, expression.reuseCount) + 1;
    matches.push({
      expressionId: expression.id,
      previousOriginalText: expression.originalText,
      targetText: expression.targetText,
      currentText: matchingUtterance.raw,
      statusBefore: expression.status,
      statusAfter: nextStatus(reuseCount),
      reuseCount,
    });
    seenIds.add(expression.id);
  }

  return matches;
}

export function applyTrackedExpressionReuse(
  summary: MemorySummary,
  transcript: string,
  now = new Date().toISOString(),
): TrackedExpressionReuseResult {
  const matches = matchTrackedExpressions(transcript, summary.trackedExpressions);
  if (matches.length === 0) {
    return { summary, reusedExpressions: [] };
  }

  const matchById = new Map(matches.map((match) => [match.expressionId, match]));
  const trackedExpressions = summary.trackedExpressions.map((expression) => {
    const match = matchById.get(expression.id);
    if (!match) {
      return expression;
    }

    return {
      ...expression,
      status: match.statusAfter,
      reuseCount: match.reuseCount,
      lastSeenAt: now,
    } satisfies TrackedExpression;
  });

  return {
    summary: {
      ...summary,
      trackedExpressions,
      updatedAt: now,
    },
    reusedExpressions: matches,
  };
}

/**
 * Guard against downstream memory extraction accidentally reintroducing an older
 * copy of a reused expression. Reused target state is product-owned deterministic
 * state, so it must win over model-derived memory fields.
 */
export function preserveTrackedExpressionReuse(
  extractedSummary: MemorySummary,
  reuseUpdatedSummary: MemorySummary | null,
  reusedExpressions: ReportReusedExpression[],
): MemorySummary {
  if (!reuseUpdatedSummary || reusedExpressions.length === 0) {
    return extractedSummary;
  }

  const reusedIds = new Set(reusedExpressions.map((match) => match.expressionId));
  const reuseStateById = new Map(
    reuseUpdatedSummary.trackedExpressions
      .filter((expression) => reusedIds.has(expression.id))
      .map((expression) => [expression.id, expression]),
  );

  if (reuseStateById.size === 0) {
    return extractedSummary;
  }

  const seen = new Set<string>();
  const extractedTrackedExpressions = Array.isArray(extractedSummary.trackedExpressions)
    ? extractedSummary.trackedExpressions
    : [];
  const trackedExpressions = extractedTrackedExpressions.map((expression) => {
    const reuseState = reuseStateById.get(expression.id);
    if (!reuseState) {
      return expression;
    }
    seen.add(expression.id);
    return {
      ...expression,
      status: reuseState.status,
      reuseCount: reuseState.reuseCount,
      lastSeenAt: reuseState.lastSeenAt,
    } satisfies TrackedExpression;
  });

  for (const [id, reuseState] of reuseStateById) {
    if (!seen.has(id)) {
      trackedExpressions.push(reuseState);
    }
  }

  return {
    ...extractedSummary,
    trackedExpressions,
  };
}
