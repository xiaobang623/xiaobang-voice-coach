import type {
  ExpressionPracticeContext,
  MemoryEntry,
  MemorySummary,
  SpeedOption,
  TaskScenario,
  UserMemory,
  VoiceOption,
} from "../types";

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
  "RULE 5 — Keep the conversation flowing: the selected topic is only a starting point, not a cage.",
  "RULE 6 — Rescue stuck moments: if the learner goes quiet, hesitates, or signals they're stuck (e.g. 'um...', 'how do I say...', long silence, or says it in Chinese), do NOT wait or pressure them. Warmly lower the bar and always do both in the same reply: first reassure them with 'take your time, no rush' or similar, then give one concrete tiny scaffold — a simpler sentence starter they can repeat (for example, 'I mean...' or 'For me...'), two easy options to pick from, or an easier related question. Do not reply with reassurance only. If they ask in Chinese, acknowledge gently but scaffold them back into one simple English starter, rather than asking them to continue in Chinese only. Never correct, never point out the struggle as a mistake. The goal is to make speaking feel safe, not to test them.",
  "If the learner sounds done, gives short answers, repeats themselves, or the topic has gone around a few times, smoothly drift to a related topic.",
  "Never announce a learning flow: don't say 'new topic', 'next practice', 'choose a topic', 'we finished this topic', or anything classroom-like.",
  "Use friend-style bridges: connect one detail they just mentioned to a nearby angle, then ask one easy question.",
  "Examples: food -> travel for food; busy work -> how they relax; weekend -> hobbies; stress -> small comforts; a favorite place -> memories there.",
].join(" ");

/**
 * Merge the base persona with the selected topic's promptSeed and optional
 * learner memory so the Coach can personalize without breaking the topic opener.
 */
type MemoryInput = MemorySummary | UserMemory | null | undefined;

/**
 * Build a light "reuse hook" for ONE carry-over expression. Injected into the
 * normal chat so the Coach naturally engineers a single chance for the learner
 * to reuse what the last recap told them to bring back — the conversation-side
 * half of the learning loop. Kept soft: never forced, never announced.
 */
function buildReuseHookBlock(focusExpression?: string): string {
  const target = focusExpression?.trim();
  if (!target) {
    return "";
  }
  return [
    `Soft hidden goal for THIS chat: at some natural moment, gently steer toward a context where the learner could reuse the expression "${target}".`,
    "Do it at most once, only when it fits the flow — ask a question or share something that makes that expression the natural thing to say.",
    "If it doesn't come up naturally, just let it go. Never name it as a target, never say 'try to use', never turn it into an exercise, and never correct them if they skip it.",
  ].join(" ");
}

export function buildSystemPrompt(
  promptSeed?: string,
  memory?: MemoryInput,
  focusExpression?: string,
): string {
  const seed = promptSeed?.trim();
  const topicLine = seed
    ? `Use this as the starting vibe, not a strict agenda: ${seed} If it starts to feel finished, naturally drift to a nearby topic like a friend would.`
    : "Start from anything on the user's mind, and naturally drift when the current thread runs out.";

  const memoryBlock = formatMemoryBlock(memory);
  const reuseHook = buildReuseHookBlock(focusExpression);
  return [BASE_SYSTEM_ROLE, memoryBlock, reuseHook, topicLine]
    .filter(Boolean)
    .join(" ");
}



export function buildExpressionPracticeSystemPrompt(
  context: ExpressionPracticeContext,
  memory?: MemoryInput,
): string {
  const targets = context.targetExpressions
    .slice(0, 3)
    .map((item, index) => {
      const details = [
        item.meaning ? `meaning: ${item.meaning}` : "",
        item.example ? `example: ${item.example}` : "",
      ].filter(Boolean);
      return `${index + 1}. "${item.text}"${details.length ? ` (${details.join("; ")})` : ""}`;
    })
    .join(" ");

  const practiceBlock = [
    "This is a short expression reuse practice, about two minutes.",
    "Your hidden goal is to create natural chances for the learner to reuse these target expressions:",
    targets,
    "Keep chatting like a friend, not an examiner.",
    "Never say 'please use expression #1', 'make a sentence', 'target expression', or anything classroom-like.",
    "Use natural follow-up questions that make the expression useful in context.",
    "Example: if the target is 'I ended up...', ask 'So what did you end up doing?'.",
    "If the learner doesn't use an expression, keep the conversation natural and continue.",
    "If they use one awkwardly, do not correct it during the chat; save feedback for the recap.",
    "Do not mention scores, completion, pass/fail, or judging.",
  ].join(" ");

  const memoryBlock = formatMemoryBlock(memory);
  if (!memoryBlock) {
    return `${BASE_SYSTEM_ROLE} ${practiceBlock}`;
  }
  return `${BASE_SYSTEM_ROLE} ${memoryBlock} ${practiceBlock}`;
}

/**
 * Task-mode system_role: role-play persona + embedded sub-goals for the Coach.
 * The Coach guides toward goals naturally and never announces completion aloud.
 */
export function buildTaskSystemPrompt(
  scenario: TaskScenario,
  memory?: MemoryInput,
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
    "If the learner goes quiet, hesitates, or says they are stuck, gently rescue the moment and always do both: reassure, then give a tiny sentence starter, two easy options, or an easier in-character cue. Do not reply with reassurance only. If they ask in Chinese, acknowledge gently but scaffold them back into one simple English starter. Never correct or point out the struggle as a mistake.",
    "Guide the user toward each sub-goal through realistic role-play dialogue.",
    "Never say things like 'you completed goal 1' or 'task done' — stay in character.",
    "When a sub-goal seems reached, smoothly move the scene forward with another concrete speaking cue.",
    "When the scene feels finished, wrap or drift like a real person in the scene — never announce a learning flow or say 'task complete'.",
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
function splitMemory(memory?: MemoryInput): { summary: MemorySummary; entries: MemoryEntry[] } | null {
  if (!memory) {
    return null;
  }

  if ("summary" in memory) {
    return {
      summary: memory.summary,
      entries: Array.isArray(memory.entries) ? memory.entries : [],
    };
  }

  return { summary: memory, entries: [] };
}

function estimateMemoryTokens(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const nonCjkChars = text.replace(/[\u3400-\u9fff]/g, "").length;
  return Math.ceil(cjkChars * 0.6 + nonCjkChars / 4);
}

function buildEntryLine(entry: MemoryEntry): string {
  const parts = [
    entry.topic ? `topic: ${entry.topic}` : "",
    entry.highlights ? `highlight: ${entry.highlights}` : "",
    entry.mistakes ? `mistake: ${entry.mistakes}` : "",
    entry.storyNotes ? `story: ${entry.storyNotes}` : "",
  ].filter(Boolean);
  return `- ${entry.createdAt.slice(0, 10)} — ${parts.join("; ")}.`;
}

function logMemoryBudget(block: string): void {
  if (typeof console !== "undefined") {
    console.debug("[memory] prompt block estimated tokens:", estimateMemoryTokens(block));
  }
}

export function formatMemoryBlock(memory?: MemoryInput): string {
  const parsed = splitMemory(memory);
  if (!parsed) {
    return "";
  }

  const { summary, entries } = parsed;
  const parts: string[] = [];
  parts.push(`You have spoken with this learner before (level: ${summary.userLevel}).`);

  if (summary.topics.length > 0) {
    parts.push(`They enjoy talking about: ${summary.topics.join(", ")}.`);
  }

  if (summary.frequentMistakes.length > 0) {
    parts.push(`Gently watch for: ${summary.frequentMistakes.join("; ")}.`);
  }

  if (summary.personalFacts.length > 0) {
    parts.push(`Stable personal facts: ${summary.personalFacts.join("; ")}.`);
  }

  if (summary.coachNotes.trim()) {
    parts.push(summary.coachNotes.trim());
  }

  parts.push(
    "Use memory like a friend: mention one relevant old detail only when it naturally fits.",
    "Never say 'Last time you said...' or read memories as a list. Never bring up more than one old thing in one reply.",
  );

  const budget = 500;
  const blockParts = [`Learner memory (for you only): ${parts.join(" ")}`];
  const sortedEntries = [...entries]
    .filter((entry) => entry.topic || entry.highlights || entry.mistakes || entry.storyNotes)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (sortedEntries.length > 0) {
    const header = "Recent conversation memories, newest first:";
    let candidate = `${blockParts.join(" ")} ${header}`;
    if (estimateMemoryTokens(candidate) <= budget) {
      blockParts.push(header);
      for (const entry of sortedEntries) {
        const line = buildEntryLine(entry);
        candidate = `${blockParts.join(" ")} ${line}`;
        if (estimateMemoryTokens(candidate) > budget) {
          break;
        }
        blockParts.push(line);
      }
    }
  }

  const block = blockParts.join(" ");
  logMemoryBudget(block);
  return block;
}
