type UserLevel = "beginner" | "intermediate" | "advanced";
type SourceType = "correction" | "sayBetter" | "newExpression";
type Status = "unmastered" | "reviewing" | "mastered";

interface RawMemory {
  summary?: Record<string, unknown>;
  entry?: Record<string, unknown>;
  userLevel?: string;
  topics?: unknown[];
  frequentMistakes?: unknown[];
  personalFacts?: unknown[];
  coachNotes?: string;
  notes?: string;
}

export interface MemorySummary {
  userLevel: UserLevel;
  topics: string[];
  frequentMistakes: string[];
  personalFacts: string[];
  coachNotes: string;
  updatedAt: string;
  trackedExpressions: TrackedExpression[];
}

export interface MemoryEntry {
  sessionId: string;
  topic: string;
  highlights: string;
  mistakes: string;
  storyNotes: string;
  createdAt: string;
}

export interface ProcessedMemory {
  summary: MemorySummary;
  entries: MemoryEntry[];
}

export interface TrackedExpression {
  id: string;
  sourceType: SourceType;
  originalText: string;
  targetText: string;
  category: string;
  status: Status;
  firstSeenAt: string;
  lastSeenAt: string;
  reuseCount: number;
  nextReviewAt?: string;
}

export const MEMORY_SYSTEM_PROMPT = `You are an English speaking coach building a two-layer memory from one conversation.
Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "summary": {
    "userLevel": "beginner" | "intermediate" | "advanced",
    "topics": ["string"],
    "frequentMistakes": ["string"],
    "personalFacts": ["string"],
    "coachNotes": "string"
  },
  "entry": {
    "topic": "string",
    "highlights": "string",
    "mistakes": "string",
    "storyNotes": "string"
  }
}

Field rules:
- userLevel: infer from the USER's English in the transcript; keep consistent with the report when sensible.
- topics: 1–4 short English tags for what the user enjoyed or talked about (e.g. "travel", "work stress").
- frequentMistakes: up to 5 concise patterns as "wrong → right" or short English phrases the coach should watch for next time. Pull from the report corrections when useful.
- personalFacts: stable personal facts only (job, pets, hobbies, family, long-running goals). English only, each <=15 words, max 8. Do not include one-off events here unless they reveal a stable fact.
- coachNotes: 1–2 English sentences the Coach can use internally next session (tone, confidence, recurring habits). No Chinese.
- entry.topic: this conversation topic, <=6 words.
- entry.highlights: one learning highlight from this session, <=20 words.
- entry.mistakes: main error pattern from this session, <=20 words, or "".
- entry.storyNotes: concrete user story / recent life update from this session, <=20 words, or "".

If a previous profile is provided, MERGE: keep still-relevant topics, mistakes, personal facts, and coach notes; drop stale or unsupported details; refine userLevel gradually.
If an "Entry likely to be archived" is provided, compress any important long-term detail from it into summary.coachNotes or summary.personalFacts before it disappears from the recent stream.
Do not invent facts not supported by the transcript, report, previous profile, or archived entry.`;

const VALID_LEVELS = new Set<UserLevel>(["beginner", "intermediate", "advanced"]);
const VALID_SOURCE_TYPES = new Set<SourceType>(["correction", "sayBetter", "newExpression"]);
const VALID_STATUSES = new Set<Status>(["unmastered", "reviewing", "mastered"]);

const CATEGORY_BY_CORRECTION_TYPE: Record<string, string> = {
  grammar: "语法",
  collocation: "搭配",
  vocabulary: "用词",
  naturalness: "地道",
  structure: "句式",
};

function normalizeUserLevel(raw: string | undefined): UserLevel {
  const value = String(raw ?? "intermediate").toLowerCase().trim();
  return VALID_LEVELS.has(value as UserLevel) ? (value as UserLevel) : "intermediate";
}

function normalizeStringList(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of raw) {
    const value = String(entry ?? "").trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function limitWords(raw: unknown, maxWords: number): string {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) {
    return "";
  }
  const words = value.split(" ");
  if (words.length <= maxWords) {
    return value;
  }
  return words.slice(0, maxWords).join(" ");
}

function normalizePersonalFacts(raw: unknown): string[] {
  return normalizeStringList(raw, 12)
    .map((fact) => limitWords(fact, 15))
    .filter(Boolean)
    .slice(0, 8);
}

export function normalizeExpressionKey(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .trim()
    .replace(/[`'"“”‘’.,!?;:，。！？；：()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapCorrectionCategory(type: unknown): string {
  return CATEGORY_BY_CORRECTION_TYPE[String(type ?? "").trim()] ?? "未分类";
}

export function stableHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const input = String(value ?? "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeTrackedExpressionId(
  sourceType: SourceType,
  targetText: unknown,
  ownerKey = "memory",
): string {
  const key = normalizeExpressionKey(targetText);
  return `expr-${sourceType}-${stableHash(`${ownerKey}:${sourceType}:${key}`)}`;
}

function normalizeTrackedExpression(raw: unknown): TrackedExpression | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const sourceType = String(record.sourceType ?? "").trim() as SourceType;
  const status = String(record.status ?? "").trim() as Status;
  const targetText = String(record.targetText ?? "").trim();
  const id = String(record.id ?? "").trim();
  if (!id || !targetText || !VALID_SOURCE_TYPES.has(sourceType)) {
    return null;
  }

  const firstSeenAt = String(record.firstSeenAt ?? record.lastSeenAt ?? new Date().toISOString());
  const lastSeenAt = String(record.lastSeenAt ?? firstSeenAt);
  const expression: TrackedExpression = {
    id,
    sourceType,
    originalText: String(record.originalText ?? "").trim(),
    targetText,
    category: String(record.category ?? "未分类").trim() || "未分类",
    status: VALID_STATUSES.has(status) ? status : "unmastered",
    firstSeenAt,
    lastSeenAt,
    reuseCount: Number.isFinite(Number(record.reuseCount))
      ? Math.max(0, Number(record.reuseCount))
      : 0,
  };

  if (typeof record.nextReviewAt === "string" && record.nextReviewAt.trim()) {
    expression.nextReviewAt = record.nextReviewAt.trim();
  }

  return expression;
}

export function normalizeTrackedExpressions(raw: unknown): TrackedExpression[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: TrackedExpression[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const expression = normalizeTrackedExpression(item);
    if (!expression) {
      continue;
    }
    const key = normalizeExpressionKey(expression.targetText);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(expression);
  }
  return result;
}

export function mergeTrackedExpressions(
  existingRaw: unknown,
  incomingRaw: unknown,
  fallbackSeenAt = new Date().toISOString(),
): TrackedExpression[] {
  const result = normalizeTrackedExpressions(existingRaw);
  const indexByTarget = new Map<string, number>();

  result.forEach((expression, index) => {
    indexByTarget.set(normalizeExpressionKey(expression.targetText), index);
  });

  for (const incoming of normalizeTrackedExpressions(incomingRaw)) {
    const key = normalizeExpressionKey(incoming.targetText);
    if (!key) {
      continue;
    }

    const existingIndex = indexByTarget.get(key);
    if (existingIndex != null) {
      result[existingIndex] = {
        ...result[existingIndex],
        lastSeenAt: incoming.lastSeenAt || fallbackSeenAt,
      };
      continue;
    }

    indexByTarget.set(key, result.length);
    result.push(incoming);
  }

  return result;
}

function buildExpression({
  sourceType,
  originalText,
  targetText,
  category,
  now,
  ownerKey,
}: {
  sourceType: SourceType;
  originalText: unknown;
  targetText: unknown;
  category: string;
  now: string;
  ownerKey?: string;
}): TrackedExpression | null {
  const cleanTarget = String(targetText ?? "").trim();
  if (!cleanTarget) {
    return null;
  }

  return {
    id: makeTrackedExpressionId(sourceType, cleanTarget, ownerKey),
    sourceType,
    originalText: String(originalText ?? "").trim(),
    targetText: cleanTarget,
    category,
    status: "unmastered",
    firstSeenAt: now,
    lastSeenAt: now,
    reuseCount: 0,
  };
}

export function buildTrackedExpressionsFromReport(
  report: unknown,
  options: { now?: string; ownerKey?: string } = {},
): TrackedExpression[] {
  if (!report || typeof report !== "object") {
    return [];
  }

  const record = report as Record<string, unknown>;
  const now = options.now ?? new Date().toISOString();
  const ownerKey = options.ownerKey ?? "memory";
  const result: TrackedExpression[] = [];

  for (const correction of Array.isArray(record.corrections) ? record.corrections : []) {
    const item = correction as Record<string, unknown>;
    const expression = buildExpression({
      sourceType: "correction",
      originalText: item?.original,
      targetText: item?.corrected,
      category: mapCorrectionCategory(item?.type),
      now,
      ownerKey,
    });
    if (expression) {
      result.push(expression);
    }
  }

  const growth = record.growth && typeof record.growth === "object"
    ? (record.growth as Record<string, unknown>)
    : null;
  for (const item of Array.isArray(growth?.sayBetter) ? growth.sayBetter : []) {
    const sayBetter = item as Record<string, unknown>;
    const expression = buildExpression({
      sourceType: "sayBetter",
      originalText: sayBetter?.original,
      targetText: sayBetter?.upgraded,
      category: "地道",
      now,
      ownerKey,
    });
    if (expression) {
      result.push(expression);
    }
  }

  for (const item of Array.isArray(growth?.newExpressions) ? growth.newExpressions : []) {
    const newExpression = item as Record<string, unknown>;
    const expression = buildExpression({
      sourceType: "newExpression",
      originalText: "",
      targetText: newExpression?.phrase,
      category: "搭配",
      now,
      ownerKey,
    });
    if (expression) {
      result.push(expression);
    }
  }

  return result;
}

export function postProcessMemory(
  raw: RawMemory,
  options: {
    report?: Record<string, unknown> | null;
    previousSummary?: Record<string, unknown> | null;
    previousEntries?: unknown;
    sessionId?: string;
    ownerKey?: string;
  } = {},
): ProcessedMemory {
  const rawSummary =
    raw?.summary && typeof raw.summary === "object" ? raw.summary : raw && typeof raw === "object" ? raw : {};
  const rawEntry = raw?.entry && typeof raw.entry === "object" ? raw.entry : {};
  const previousSummary = options.previousSummary && typeof options.previousSummary === "object"
    ? options.previousSummary
    : {};

  const coachNotes = String(rawSummary.coachNotes ?? rawSummary.notes ?? "").trim();
  const updatedAt = new Date().toISOString();
  const baseMemory = {
    userLevel: normalizeUserLevel(String(rawSummary.userLevel ?? previousSummary.userLevel)),
    topics: normalizeStringList(rawSummary.topics ?? previousSummary.topics, 4),
    frequentMistakes: normalizeStringList(
      rawSummary.frequentMistakes ?? previousSummary.frequentMistakes,
      5,
    ),
    personalFacts: normalizePersonalFacts(rawSummary.personalFacts ?? previousSummary.personalFacts),
    coachNotes: coachNotes.slice(0, 400),
    updatedAt,
  };

  const previousTrackedExpressions = normalizeTrackedExpressions(
    options.previousSummary?.trackedExpressions,
  );

  const previousEntries = normalizeMemoryEntries(options.previousEntries);
  const growth = options.report?.growth && typeof options.report.growth === "object"
    ? (options.report.growth as Record<string, unknown>)
    : null;
  const entry = normalizeMemoryEntry(rawEntry, {
    sessionId: options.sessionId,
    createdAt: updatedAt,
    fallbackTopic: growth?.topic,
  });
  const entries = [...previousEntries, entry].slice(-20);

  try {
    const incomingTrackedExpressions = buildTrackedExpressionsFromReport(options.report, {
      now: updatedAt,
      ownerKey: options.ownerKey,
    });

    return {
      summary: {
        ...baseMemory,
        trackedExpressions: mergeTrackedExpressions(
          previousTrackedExpressions,
          incomingTrackedExpressions,
          updatedAt,
        ),
      },
      entries,
    };
  } catch (error) {
    console.warn(
      "[memory] trackedExpressions mapping failed:",
      error instanceof Error ? error.message : error,
    );
    return {
      summary: {
        ...baseMemory,
        trackedExpressions: previousTrackedExpressions,
      },
      entries,
    };
  }
}

export function normalizeMemoryEntry(
  raw: unknown,
  options: {
    sessionId?: string;
    createdAt?: unknown;
    fallbackTopic?: unknown;
  } = {},
): MemoryEntry {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const createdAt = String(options.createdAt ?? record.createdAt ?? new Date().toISOString());
  const sessionId = String(record.sessionId ?? options.sessionId ?? "").trim();

  return {
    sessionId: sessionId || `memory-${stableHash(`${createdAt}:${JSON.stringify(record ?? {})}`)}`,
    topic: limitWords(record.topic ?? options.fallbackTopic ?? "practice", 6),
    highlights: limitWords(record.highlights, 20),
    mistakes: limitWords(record.mistakes, 20),
    storyNotes: limitWords(record.storyNotes, 20),
    createdAt,
  };
}

export function normalizeMemoryEntries(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: MemoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const entry = normalizeMemoryEntry(record, { createdAt: record.createdAt });
    if (!entry.sessionId || seen.has(entry.sessionId)) {
      continue;
    }
    seen.add(entry.sessionId);
    result.push(entry);
  }

  return result
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-20);
}
