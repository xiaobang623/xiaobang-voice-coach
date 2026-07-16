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

const TRANSCRIPT_SPEAKER_PREFIX_RE = /^(user|coach|assistant|speaker)\s*:\s*/i;
const TRANSCRIPT_NESTED_PREFIX_RE = /^(?:(?:user|coach|assistant|speaker)\s*:\s*)+/i;
const TRANSCRIPT_NOISE_MARKER_RE = /[\[(]\s*(?:inaudible|unintelligible|noise|crosstalk|laughter|laughs?|music|silence|unknown)\s*[\])]/gi;
const TRANSCRIPT_EDGE_FILLER_RE =
  /^(?:um+|uh+|erm+|hmm+|mm+|ah+|eh+|er+|呃+|嗯+|啊+|那个+|就是+)\b[\s,.;:!?-]*/i;
const TRANSCRIPT_TRAILING_FILLER_RE =
  /[\s,.;:!?-]*(?:um+|uh+|erm+|hmm+|mm+|ah+|eh+|er+|呃+|嗯+|啊+|那个+|就是+)$/i;
const TRANSCRIPT_FILLER_ONLY_RE =
  /^(?:\s*(?:um+|uh+|erm+|hmm+|mm+|ah+|eh+|er+|呃+|嗯+|啊+|那个+|就是+)[\s,.;:!?\-…]*)+$/i;
const TRANSCRIPT_PUNCT_ONLY_RE = /^[\s,.;:!?\-…]+$/;

function cleanTranscriptLine(line) {
  let value = String(line ?? "").replace(/\r/g, "").trim();
  if (!value) {
    return "";
  }

  value = value.replace(TRANSCRIPT_NOISE_MARKER_RE, " ");
  value = value.replace(/\uFFFD/g, " ");
  value = value.replace(TRANSCRIPT_NESTED_PREFIX_RE, "");
  while (TRANSCRIPT_EDGE_FILLER_RE.test(value)) {
    value = value.replace(TRANSCRIPT_EDGE_FILLER_RE, "");
  }
  value = value.replace(TRANSCRIPT_TRAILING_FILLER_RE, "");
  value = value.replace(/\s+/g, " ").trim();

  if (!value || TRANSCRIPT_FILLER_ONLY_RE.test(value) || TRANSCRIPT_PUNCT_ONLY_RE.test(value)) {
    return "";
  }

  return value;
}

/**
 * Lightly normalize an ASR transcript before sending it to the model.
 *
 * The goal is to remove obvious recognition noise without rewriting the user's
 * actual wording, so the downstream model still sees the learner's real errors.
 */
export function cleanTranscriptForReport(transcript) {
  if (typeof transcript !== "string") {
    return "";
  }

  const lines = transcript.replace(/\r\n/g, "\n").split("\n");
  const cleanedLines = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const prefixMatch = trimmed.match(TRANSCRIPT_SPEAKER_PREFIX_RE);
    const prefix = prefixMatch?.[0] ?? "";
    const content = prefix ? trimmed.slice(prefix.length) : trimmed;
    const cleanedContent = cleanTranscriptLine(content);
    if (!cleanedContent) {
      continue;
    }

    const cleanedLine = prefix ? `${prefix.replace(/\s+$/, "")} ${cleanedContent}` : cleanedContent;
    const previousLine = cleanedLines[cleanedLines.length - 1];
    if (previousLine && previousLine.toLowerCase() === cleanedLine.toLowerCase()) {
      continue;
    }

    cleanedLines.push(cleanedLine);
  }

  return cleanedLines.join("\n");
}

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
  "growth": {
    "topic": "string (本次话题概括, in Chinese)",
    "sayBetter": [{
      "original": "string (a sentence the user actually said — correct but plain, short, or repetitive)",
      "upgraded": "string (a richer, more native version slightly above the user's current level)",
      "note": "string (Chinese: what the upgrade adds — 连接词 / 细节 / 更地道的词块)"
    }],
    "newExpressions": [{
      "phrase": "string (a spoken chunk, collocation, or sentence pattern)",
      "meaning": "string (Chinese meaning + 什么场合用)",
      "example": "string (one natural English example tied to THIS conversation's topic)"
    }],
    "talkMore": [{
      "angle": "string (Chinese: 这个话题下次还可以聊的具体角度)",
      "starter": "string (a ready-to-use English opener the user can literally say next time)"
    }]
  },
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
- Treat the transcript as ASR output, not a perfect transcript.
- If a fragment looks like speech recognition noise, mishearing, missing words, or a broken sentence that you cannot confidently attribute to the user's English ability, ignore it rather than turning it into a correction.
- Prefer false negatives over false positives: when in doubt, skip the item.
- Do not spend corrections on obvious ASR mistakes, repeated fragments, filler noise, or unclear words unless the surrounding context makes the intended phrase very clear.
- Return at most 10 corrections; backend will trim to top 6.
- Assign severity: critical = blocks understanding, important = clear error, minor = polish.
- Skip filler words and trivial typos. Write explanation in concise Chinese.
- Prioritize corrections that TEACH something new. Repetitive low-value slips (dropped subjects, minor articles, casual spoken shortcuts) should appear at most ONCE as a single pattern-level item — never fill the list with them.
- If transcript is too short, return userLevel plus empty corrections array and growth: null.

Growth pack (the "growth" field — ALWAYS include it when the transcript has enough content):
- Purpose: help the user SAY MORE and SAY IT BETTER next time — this is the part the user learns NEW things from, not error fixing.
- sayBetter (2-3 items): pick sentences the user actually said that are CORRECT but plain, short, or repetitive, and upgrade them to a richer, more natural version one notch above the user's level (i+1). Do NOT reuse sentences already listed in corrections. The upgrade must be a REAL step up that teaches something structural: a connector, a vivid verb, a native chunk, or added concrete detail. Merely inserting an adverb or filler ("really", "quite", "you know") is NOT an upgrade — skip the item instead.
- newExpressions (3-5 items): teach spoken chunks, collocations, or sentence patterns directly useful for THIS topic and appropriate for the user's level. They must be expressions the user did NOT already say in this conversation — never present the user's own words back as something new. Prefer high-frequency spoken English over fancy written words. Each needs one natural example sentence in the context of this conversation.
- talkMore (2-3 items): concrete angles the user could expand on next time within this topic — a detail, an opinion, a comparison, a short story — each with a ready-to-use English starter the user can say verbatim.
- Everything in growth must feel fresh: no overlap with corrections, no generic advice like "practice more".
- If the transcript is too short to infer a topic, set growth to null.

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

const MAX_SAY_BETTER = 3;
const MAX_NEW_EXPRESSIONS = 5;
const MAX_TALK_MORE = 3;

/** Normalize the growth pack ("说得更好" 提升层); returns undefined when empty/absent. */
export function normalizeGrowth(raw) {
  const growth = raw?.growth;
  if (!growth || typeof growth !== "object") {
    return undefined;
  }

  const sayBetter = (Array.isArray(growth.sayBetter) ? growth.sayBetter : [])
    .map((item) => ({
      original: String(item?.original ?? "").trim(),
      upgraded: String(item?.upgraded ?? item?.improved ?? "").trim(),
      note: String(item?.note ?? "").trim(),
    }))
    .filter((item) => item.original && item.upgraded)
    .slice(0, MAX_SAY_BETTER);

  const newExpressions = (Array.isArray(growth.newExpressions) ? growth.newExpressions : [])
    .map((item) => ({
      phrase: String(item?.phrase ?? "").trim(),
      meaning: String(item?.meaning ?? "").trim(),
      example: String(item?.example ?? "").trim(),
    }))
    .filter((item) => item.phrase && item.meaning)
    .slice(0, MAX_NEW_EXPRESSIONS);

  const talkMore = (Array.isArray(growth.talkMore) ? growth.talkMore : [])
    .map((item) => ({
      angle: String(item?.angle ?? "").trim(),
      starter: String(item?.starter ?? "").trim(),
    }))
    .filter((item) => item.angle && item.starter)
    .slice(0, MAX_TALK_MORE);

  if (sayBetter.length === 0 && newExpressions.length === 0 && talkMore.length === 0) {
    return undefined;
  }

  return {
    topic: String(growth.topic ?? "").trim(),
    sayBetter,
    newExpressions,
    talkMore,
  };
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
  const growth = normalizeGrowth(raw);

  return {
    sessionId: input.sessionId,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    durationSeconds: input.durationSeconds,
    userLevel: normalizeUserLevel(raw.userLevel),
    corrections: sorted.slice(0, MAX_CORRECTIONS),
    ...(growth ? { growth } : {}),
    ...(taskResults ? { taskResults, taskScore } : {}),
  };
}
