import type { SpeedOption, VoiceOption } from "../types";

/**
 * S2S-Omni (O2.0) official voices for volc.speech.dialog.
 * Docs: https://www.volcengine.com/docs/6561/1594356 — only these four work
 * with model 1.2.1.1; other voice_type ids silently fall back to vv.
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "zh_female_vv_jupiter_bigtts", label: "Vivi", emoji: "🌸" },
  { id: "zh_female_xiaohe_jupiter_bigtts", label: "小何", emoji: "👩" },
  { id: "zh_male_yunzhou_jupiter_bigtts", label: "云舟（男）", emoji: "🧑" },
  { id: "zh_male_xiaotian_jupiter_bigtts", label: "小天（男）", emoji: "👦" },
];

export const DEFAULT_VOICE_TYPE = "zh_female_vv_jupiter_bigtts";

/** Speed presets. ratio -> Doubao `speed_ratio` (range 0.8–2.0, default 1.0). */
export const SPEED_OPTIONS: SpeedOption[] = [
  { id: "slow", label: "慢", ratio: 0.85 },
  { id: "normal", label: "正常", ratio: 1.0 },
  { id: "fast", label: "快", ratio: 1.3 },
];

export const DEFAULT_SPEED_RATIO = 1.0;

/** Base persona for the Coach. Topic-specific guidance is appended per session. */
const BASE_SYSTEM_ROLE =
  "You are a friendly English speaking coach. Keep responses natural and conversational.";

/**
 * Merge the base persona with the selected topic's promptSeed so the Coach's
 * first line sticks to the chosen topic. No seed => free-talk / general opener.
 */
export function buildSystemPrompt(promptSeed?: string): string {
  const seed = promptSeed?.trim();
  if (!seed) {
    return `${BASE_SYSTEM_ROLE} Open by warmly greeting the user and inviting them to chat about anything on their mind.`;
  }
  return `${BASE_SYSTEM_ROLE} For this session, ${seed}`;
}
