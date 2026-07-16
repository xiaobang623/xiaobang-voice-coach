/**
 * Shared prompt + validation logic for AI-generated opening talk directions.
 * Used by both api/generate-directions.js (Vercel) and report-server.js
 * (local dev mirror on :8090) so the two stay in sync — same pattern as
 * report-post-process.js / memory-post-process.js.
 */

export const DIRECTIONS_SYSTEM_PROMPT = [
  "You help an English speaking-practice app generate opening talking-point suggestions for a Chinese learner.",
  "Given a chat topic (and optionally what you know about this learner), produce 6 short talking directions in Chinese.",
  "Each direction is a specific ANGLE to talk about, not a full sentence — under 14 Chinese characters, casual and concrete.",
  "Avoid generic restatements of the topic title; make them feel fresh and varied, like a friend suggesting things to bring up.",
  "When learner memory is provided, personalize softly: include interests they often discuss, phrased as a friend's coincidental suggestion — never as recall of past sessions.",
  "HARD RULE — no surveillance feel: never reference previous conversations. The Chinese text must NOT contain '上次', '之前', '你说过', '你提到', '我记得', '还记得' or anything implying the app remembers them. Write every direction as if suggesting it for the first time.",
  "If the memory includes a useful expression to reuse, make exactly ONE direction whose scenario naturally calls for that expression, and put the expression itself (or a close variant) in that direction's en field — without hinting it was taught before.",
  "Each direction may also include a short English phrase (2-6 words) the learner could borrow to start speaking — omit \"en\" if it wouldn't help.",
  'Respond ONLY with strict JSON in this exact shape: {"directions":[{"zh":"...","en":"..."}, ...]} with exactly 6 items, no extra text. Every item must include both zh and en.',
].join(" ");

/**
 * Build the user-turn prompt from a topic/task's title, description and prompt
 * seed, plus an optional pre-formatted learner memory block (built client-side
 * via src/config/session.ts formatMemoryBlock — same phrasing the Coach itself
 * uses, so directions stay consistent with how the Coach already talks to them).
 */
export function buildDirectionsUserPrompt({ title, description, promptSeed, userMemoryBlock }) {
  const lines = [`Topic: ${title}`];
  if (description) {
    lines.push(`Description: ${description}`);
  }
  if (promptSeed) {
    lines.push(`Context: ${promptSeed}`);
  }
  if (userMemoryBlock) {
    lines.push(`About this learner: ${userMemoryBlock}`);
  }
  lines.push("Generate 6 talking directions for this topic now.");
  return lines.join("\n");
}

/**
 * Validate + clean the model's raw JSON output. Returns null (never throws) when
 * the shape is wrong or there aren't enough usable items — callers must treat
 * null as "generation failed" and fall back to the static direction pool.
 */
export function postProcessDirections(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.directions)) {
    return null;
  }

  const seen = new Set();
  const cleaned = [];
  for (const item of raw.directions) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const zh = typeof item.zh === "string" ? item.zh.trim() : "";
    if (!zh || zh.length > 40 || seen.has(zh)) {
      continue;
    }
    seen.add(zh);
    const en = typeof item.en === "string" && item.en.trim() ? item.en.trim() : undefined;
    cleaned.push(en ? { zh, en } : { zh });
    if (cleaned.length >= 8) {
      break;
    }
  }

  return cleaned.length >= 3 ? cleaned : null;
}
