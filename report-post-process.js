/** Shared post-processing for report generation (used by report-server.js). */

const SEVERITY_RANK = { critical: 3, important: 2, minor: 1 };
const MAX_CORRECTIONS = 6;

const TYPE_ALIASES = {
  "word-choice": "vocabulary",
  word_choice: "vocabulary",
  wording: "vocabulary",
  phrase: "naturalness",
  expression: "naturalness",
};

const VALID_TYPES = new Set([
  "grammar",
  "collocation",
  "vocabulary",
  "naturalness",
  "structure",
]);

export const SYSTEM_PROMPT = `You are an English speaking coach. Analyze the conversation transcript and return ONLY valid JSON (no markdown fences) matching this schema:
{
  "sessionId": "string",
  "createdAt": "ISO-8601 string",
  "durationSeconds": number,
  "userLevel": "beginner" | "intermediate" | "advanced",
  "corrections": [{
    "original": "string",
    "corrected": "string",
    "type": "grammar" | "collocation" | "vocabulary" | "naturalness" | "structure",
    "explanation": "string",
    "severity": "minor" | "important" | "critical",
    "example": "string (optional)"
  }],
  "taskResults": [{
    "goalId": "string",
    "status": "done" | "partial" | "missed",
    "reason": "string (one concise sentence in Chinese)"
  }],
  "taskScore": "string (e.g. \\"2/3\\" — count of done goals over total)"
}

Analysis dimensions (use the type field):
1. grammar — tense, agreement, articles, prepositions, sentence grammar
2. collocation — unnatural word combinations (e.g. "make homework" → "do homework")
3. vocabulary — imprecise or basic word choice; suggest better words
4. naturalness — grammatically OK but not how natives say it; give idiomatic alternatives
5. structure — sentence organization, connectors, discourse flow

Rules:
- Infer userLevel from the USER's English in the transcript.
- Only analyze what the USER said (ignore Coach lines except for context).
- Return at most 10 corrections; backend will trim to top 6.
- Assign severity: critical = blocks understanding, important = clear error, minor = polish.
- Skip filler words and trivial typos. Write explanation in concise Chinese.
- If transcript is too short, return userLevel plus empty corrections array.

Task judging (only when Task goals are provided in the user message):
- For EACH listed goal, read the transcript objectively and assign status:
  done = user clearly achieved the goal; partial = attempted but incomplete; missed = not attempted or failed.
- Write reason in one concise Chinese sentence citing what the user did or didn't do.
- taskScore = number of "done" goals / total goals (e.g. "2/3"). Count only "done", not "partial".
- If no task goals are provided, omit taskResults and taskScore entirely.`;

function normalizeType(raw) {
  const value = String(raw ?? "grammar").toLowerCase().trim();
  const aliased = TYPE_ALIASES[value] ?? value;
  return VALID_TYPES.has(aliased) ? aliased : "grammar";
}

function normalizeSeverity(raw) {
  const value = String(raw ?? "important").toLowerCase().trim();
  return value === "critical" || value === "minor" || value === "important" ? value : "important";
}

function normalizeUserLevel(raw) {
  const value = String(raw ?? "intermediate").toLowerCase().trim();
  return value === "beginner" || value === "advanced" ? value : "intermediate";
}

function dedupeKey(item) {
  return [
    item.type,
    item.original.toLowerCase().trim(),
    item.corrected.toLowerCase().trim(),
  ].join("|");
}

function normalizeTaskStatus(raw) {
  const value = String(raw ?? "missed").toLowerCase().trim();
  return value === "done" || value === "partial" ? value : "missed";
}

function normalizeTaskResults(raw, input) {
  const goals = Array.isArray(input.taskGoals) ? input.taskGoals : [];
  if (goals.length === 0) {
    return { taskResults: undefined, taskScore: undefined };
  }

  const rawResults = Array.isArray(raw.taskResults) ? raw.taskResults : [];
  const byGoalId = new Map(
    rawResults
      .filter((entry) => entry?.goalId)
      .map((entry) => [
        String(entry.goalId),
        {
          goalId: String(entry.goalId),
          status: normalizeTaskStatus(entry.status),
          reason: String(entry.reason ?? "").trim() || "未能从对话中判断",
        },
      ]),
  );

  const taskResults = goals.map((goal) => {
    const existing = byGoalId.get(goal.id);
    if (existing) {
      return existing;
    }
    return {
      goalId: goal.id,
      status: "missed",
      reason: "对话中未涉及此目标",
    };
  });

  const doneCount = taskResults.filter((item) => item.status === "done").length;
  const taskScore =
    typeof raw.taskScore === "string" && raw.taskScore.includes("/")
      ? raw.taskScore
      : `${doneCount}/${goals.length}`;

  return { taskResults, taskScore };
}

/** Merge legacy naturalUpgrades into corrections list. */
export function migrateLegacyFields(raw) {
  const corrections = Array.isArray(raw.corrections) ? [...raw.corrections] : [];

  if (Array.isArray(raw.naturalUpgrades)) {
    for (const upgrade of raw.naturalUpgrades) {
      corrections.push({
        original: upgrade.original,
        corrected: upgrade.improved ?? upgrade.corrected,
        type: "naturalness",
        explanation: upgrade.note ?? "母语者会更自然地这样说",
        severity: "minor",
      });
    }
  }

  return corrections;
}

export function postProcessReport(raw, input) {
  const merged = migrateLegacyFields(raw);
  const bucket = new Map();

  for (const entry of merged) {
    if (!entry?.original || !entry?.corrected) {
      continue;
    }

    const normalized = {
      original: String(entry.original).trim(),
      corrected: String(entry.corrected).trim(),
      type: normalizeType(entry.type),
      explanation: String(entry.explanation ?? "").trim() || "可以这样说更自然",
      severity: normalizeSeverity(entry.severity),
      ...(entry.example ? { example: String(entry.example).trim() } : {}),
    };

    const key = dedupeKey(normalized);
    const existing = bucket.get(key);
    if (existing) {
      existing.frequency = (existing.frequency ?? 1) + 1;
      if (SEVERITY_RANK[normalized.severity] > SEVERITY_RANK[existing.severity]) {
        existing.severity = normalized.severity;
      }
    } else {
      bucket.set(key, { ...normalized, frequency: entry.frequency ?? 1 });
    }
  }

  const sorted = [...bucket.values()].sort((a, b) => {
    const severityDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return (b.frequency ?? 1) - (a.frequency ?? 1);
  });

  const { taskResults, taskScore } = normalizeTaskResults(raw, input);

  return {
    sessionId: input.sessionId,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    durationSeconds: input.durationSeconds,
    userLevel: normalizeUserLevel(raw.userLevel),
    corrections: sorted.slice(0, MAX_CORRECTIONS),
    ...(taskResults ? { taskResults, taskScore } : {}),
  };
}
