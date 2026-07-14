/** Shared post-processing for memory extraction (used by report-server + Vercel). */

export const MEMORY_SYSTEM_PROMPT = `You are an English speaking coach building a compact learner profile from one conversation.
Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "userLevel": "beginner" | "intermediate" | "advanced",
  "topics": ["string"],
  "frequentMistakes": ["string"],
  "coachNotes": "string"
}

Field rules:
- userLevel: infer from the USER's English in the transcript; keep consistent with the report when sensible.
- topics: 1–4 short English tags for what the user enjoyed or talked about (e.g. "travel", "work stress").
- frequentMistakes: up to 5 concise patterns as "wrong → right" or short English phrases the coach should watch for next time. Pull from the report corrections when useful.
- coachNotes: 1–2 English sentences the Coach can use internally next session (tone, confidence, recurring habits). No Chinese.

If a previous profile is provided, MERGE: keep still-relevant topics and mistakes, drop stale ones, refine userLevel gradually. Do not invent facts not supported by the transcript or report.`;

const VALID_LEVELS = new Set(["beginner", "intermediate", "advanced"]);
const VALID_SOURCE_TYPES = new Set(["correction", "sayBetter", "newExpression"]);
const VALID_STATUSES = new Set(["unmastered", "reviewing", "mastered"]);

const CATEGORY_BY_CORRECTION_TYPE = {
  grammar: "语法",
  collocation: "搭配",
  vocabulary: "用词",
  naturalness: "地道",
  structure: "句式",
};

function normalizeUserLevel(raw) {
  const value = String(raw ?? "intermediate").toLowerCase().trim();
  return VALID_LEVELS.has(value) ? value : "intermediate";
}

function normalizeStringList(raw, maxItems) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set();
  const result = [];
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

export function normalizeExpressionKey(raw) {
  return String(raw ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .trim()
    .replace(/[`'"“”‘’.,!?;:，。！？；：()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapCorrectionCategory(type) {
  return CATEGORY_BY_CORRECTION_TYPE[String(type ?? "").trim()] ?? "未分类";
}

export function stableHash(value) {
  let hash = 0x811c9dc5;
  const input = String(value ?? "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeTrackedExpressionId(sourceType, targetText, ownerKey = "memory") {
  const key = normalizeExpressionKey(targetText);
  return `expr-${sourceType}-${stableHash(`${ownerKey}:${sourceType}:${key}`)}`;
}

function normalizeTrackedExpression(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const sourceType = String(raw.sourceType ?? "").trim();
  const status = String(raw.status ?? "").trim();
  const targetText = String(raw.targetText ?? "").trim();
  const id = String(raw.id ?? "").trim();
  if (!id || !targetText || !VALID_SOURCE_TYPES.has(sourceType)) {
    return null;
  }

  const firstSeenAt = String(raw.firstSeenAt ?? raw.lastSeenAt ?? new Date().toISOString());
  const lastSeenAt = String(raw.lastSeenAt ?? firstSeenAt);
  const expression = {
    id,
    sourceType,
    originalText: String(raw.originalText ?? "").trim(),
    targetText,
    category: String(raw.category ?? "未分类").trim() || "未分类",
    status: VALID_STATUSES.has(status) ? status : "unmastered",
    firstSeenAt,
    lastSeenAt,
    reuseCount: Number.isFinite(Number(raw.reuseCount)) ? Math.max(0, Number(raw.reuseCount)) : 0,
  };

  if (typeof raw.nextReviewAt === "string" && raw.nextReviewAt.trim()) {
    expression.nextReviewAt = raw.nextReviewAt.trim();
  }

  return expression;
}

export function normalizeTrackedExpressions(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result = [];
  const seen = new Set();
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

export function mergeTrackedExpressions(existingRaw, incomingRaw, fallbackSeenAt = new Date().toISOString()) {
  const result = normalizeTrackedExpressions(existingRaw);
  const indexByTarget = new Map();

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

function buildExpression({ sourceType, originalText, targetText, category, now, ownerKey }) {
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

export function buildTrackedExpressionsFromReport(report, options = {}) {
  if (!report || typeof report !== "object") {
    return [];
  }

  const now = options.now ?? new Date().toISOString();
  const ownerKey = options.ownerKey ?? "memory";
  const result = [];

  for (const correction of Array.isArray(report.corrections) ? report.corrections : []) {
    const expression = buildExpression({
      sourceType: "correction",
      originalText: correction?.original,
      targetText: correction?.corrected,
      category: mapCorrectionCategory(correction?.type),
      now,
      ownerKey,
    });
    if (expression) {
      result.push(expression);
    }
  }

  const growth = report.growth && typeof report.growth === "object" ? report.growth : null;
  for (const item of Array.isArray(growth?.sayBetter) ? growth.sayBetter : []) {
    const expression = buildExpression({
      sourceType: "sayBetter",
      originalText: item?.original,
      targetText: item?.upgraded,
      category: "地道",
      now,
      ownerKey,
    });
    if (expression) {
      result.push(expression);
    }
  }

  for (const item of Array.isArray(growth?.newExpressions) ? growth.newExpressions : []) {
    const expression = buildExpression({
      sourceType: "newExpression",
      originalText: "",
      targetText: item?.phrase,
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

export function postProcessMemory(raw, options = {}) {
  const coachNotes = String(raw.coachNotes ?? raw.notes ?? "").trim();
  const updatedAt = new Date().toISOString();
  const baseMemory = {
    userLevel: normalizeUserLevel(raw.userLevel),
    topics: normalizeStringList(raw.topics, 4),
    frequentMistakes: normalizeStringList(raw.frequentMistakes, 5),
    coachNotes: coachNotes.slice(0, 400),
    updatedAt,
  };

  const previousTrackedExpressions = normalizeTrackedExpressions(
    options.previousSummary?.trackedExpressions,
  );

  try {
    const incomingTrackedExpressions = buildTrackedExpressionsFromReport(options.report, {
      now: updatedAt,
      ownerKey: options.ownerKey,
    });

    return {
      ...baseMemory,
      trackedExpressions: mergeTrackedExpressions(
        previousTrackedExpressions,
        incomingTrackedExpressions,
        updatedAt,
      ),
    };
  } catch (error) {
    console.warn(
      "[memory] trackedExpressions mapping failed:",
      error instanceof Error ? error.message : error,
    );
    return {
      ...baseMemory,
      trackedExpressions: previousTrackedExpressions,
    };
  }
}
