import type { MemorySummary, SpeedOption, TaskScenario, VoiceOption } from "../types";

/**
 * S2S-Omni (O2.0) official voices for volc.speech.dialog.
 * Docs: https://www.volcengine.com/docs/6561/1594356 — only these four work
 * with model 1.2.1.1; other voice_type ids silently fall back to vv.
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "zh_female_vv_jupiter_bigtts", label: "Vivi" },
  { id: "zh_female_xiaohe_jupiter_bigtts", label: "小何" },
  { id: "zh_male_yunzhou_jupiter_bigtts", label: "云舟（男）" },
  { id: "zh_male_xiaotian_jupiter_bigtts", label: "小天（男）" },
];

export const DEFAULT_VOICE_TYPE = "zh_female_vv_jupiter_bigtts";

/** Speed presets. ratio -> Doubao `speed_ratio` (range 0.8–2.0, default 1.0). */
export const SPEED_OPTIONS: SpeedOption[] = [
  { id: "slow", label: "慢", ratio: 0.9 },
  { id: "normal", label: "正常", ratio: 1.0 },
  { id: "fast", label: "快", ratio: 1.25 },
];

export const DEFAULT_SPEED_RATIO = 1.0;

/** Base persona for the Coach. Topic-specific guidance is appended per session. */
const BASE_SYSTEM_ROLE = [
  "You are a calm, concise English speaking coach.",
  "Reply like a real live conversation, not a written lesson.",
  "Prefer one short spoken sentence under 15 words; use two only when necessary.",
  "Your job is to keep the learner talking: end almost every reply with exactly one short, easy follow-up question.",
  "Never reply with only a comment like 'That's great' — react briefly, then ask something concrete.",
  "If the learner gives a short answer, dig deeper: ask why, how, or for an example.",
  "When a topic runs dry, proactively suggest a new concrete angle or a related everyday topic instead of waiting.",
  "Avoid stacked questions, long clauses, lists, or grammar lectures.",
].join(" ");

/**
 * Merge the base persona with the selected topic's promptSeed and optional
 * learner memory so the Coach can personalize without breaking the topic opener.
 */
export function buildSystemPrompt(promptSeed?: string, memory?: MemorySummary | null): string {
  const seed = promptSeed?.trim();
  const topicLine = seed
    ? `For this session, ${seed}`
    : "Open by warmly greeting the user and inviting them to chat about anything on their mind.";

  const memoryBlock = formatMemoryBlock(memory);
  if (!memoryBlock) {
    return `${BASE_SYSTEM_ROLE} ${topicLine}`;
  }

  return `${BASE_SYSTEM_ROLE} ${memoryBlock} ${topicLine}`;
}

/**
 * Task-mode system_role: role-play persona + embedded sub-goals for the Coach.
 * The Coach guides toward goals naturally and never announces completion aloud.
 */
export function buildTaskSystemPrompt(
  scenario: TaskScenario,
  memory?: MemorySummary | null,
): string {
  const goalBlock = scenario.goals
    .map((goal, index) => `Sub-goal ${index + 1}: ${goal.coachHint}`)
    .join(" ");

  const roleBlock = [
    scenario.roleSetup,
    "You are also an English speaking coach — reply like a real live conversation, not a written lesson.",
    "Prefer one short spoken sentence under 15 words; use two only when necessary.",
    "Your job is to keep the learner talking inside the role-play.",
    "End almost every reply with exactly one short, concrete follow-up question or role-play prompt.",
    "Never reply with only a comment like 'Great' — react briefly, then give the learner an easy next thing to say.",
    "If the learner gives a short answer, ask why, how, or for a specific example before moving on.",
    "Avoid stacked questions, long clauses, lists, or grammar lectures.",
    "Guide the user toward each sub-goal through realistic role-play dialogue.",
    "Never say things like 'you completed goal 1' or 'task done' — stay in character.",
    "When a sub-goal seems reached, smoothly move the scene forward with another concrete speaking cue.",
    goalBlock,
  ].join(" ");

  const memoryBlock = formatMemoryBlock(memory);
  if (!memoryBlock) {
    return roleBlock;
  }
  return `${roleBlock} ${memoryBlock}`;
}

function formatMemoryBlock(memory?: MemorySummary | null): string {
  if (!memory) {
    return "";
  }

  const parts: string[] = [];
  parts.push(`You have spoken with this learner before (level: ${memory.userLevel}).`);

  if (memory.topics.length > 0) {
    parts.push(`They enjoy talking about: ${memory.topics.join(", ")}.`);
  }

  if (memory.frequentMistakes.length > 0) {
    parts.push(`Gently watch for: ${memory.frequentMistakes.join("; ")}.`);
  }

  if (memory.coachNotes.trim()) {
    parts.push(memory.coachNotes.trim());
  }

  parts.push(
    "Weave this in naturally — do not list these facts aloud or sound like you are reading a file.",
  );

  return parts.join(" ");
}
