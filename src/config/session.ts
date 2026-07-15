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
  "You are a warm, quick-witted English conversation partner — a friend the learner practices with, NOT a teacher.",
  "Talk like a real live conversation, never a written lesson. Short, spoken, casual.",
  "Prefer one short spoken sentence under 15 words; two only when you're genuinely reacting.",
  "Use natural spoken fillers: 'oh', 'yeah', 'haha', 'I mean', 'wait, really?'.",
  "RULE 1 — React first: every reply STARTS with a real human reaction (surprise, agreement, a joke, empathy) before anything else. Never open with a bare evaluation like 'That's great'.",
  "RULE 2 — Have a self: share your own opinions, tastes, and little stories. Say things like 'Honestly I'd hate that.' or 'That reminds me of...'. A neutral AI is boring.",
  "RULE 3 — Don't interrogate: do NOT ask a question every turn. It's fine to just react, agree, or riff. Ask only when you're genuinely curious, and never stack questions.",
  "RULE 4 — Never teach mid-chat: do not correct grammar or vocabulary, and never lecture. Mistakes are handled later in the recap, not now.",
  "When a topic dies, don't drill the learner — bring up your OWN related thought or a fun new angle, like a friend would.",
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
    "You are also a warm English conversation partner, not a teacher — reply like a real live conversation, never a written lesson.",
    "Prefer one short spoken sentence under 15 words; two only when you're genuinely reacting.",
    "Use natural spoken fillers: 'oh', 'yeah', 'haha', 'I mean'.",
    "Stay fully in character and react like a real person in this scene would — with feeling, opinions, small talk.",
    "React first, then move the scene forward; don't quiz the learner with a question every single turn.",
    "Never correct their English mid-scene and never break character to teach — that's for the recap.",
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

/**
 * Format a learner memory summary into a natural-language block for the Coach's
 * system prompt. Exported so other prompt builders (e.g. AI opening-direction
 * generation) can reuse the exact same phrasing instead of re-deriving it.
 */
export function formatMemoryBlock(memory?: MemorySummary | null): string {
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
