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

export function postProcessMemory(raw) {
  const coachNotes = String(raw.coachNotes ?? raw.notes ?? "").trim();
  return {
    userLevel: normalizeUserLevel(raw.userLevel),
    topics: normalizeStringList(raw.topics, 4),
    frequentMistakes: normalizeStringList(raw.frequentMistakes, 5),
    coachNotes: coachNotes.slice(0, 400),
    updatedAt: new Date().toISOString(),
  };
}
