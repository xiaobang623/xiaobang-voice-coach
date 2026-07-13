import type { UserPreferences, VoiceOption } from "../types";
import {
  DEFAULT_SPEED_RATIO,
  SPEED_OPTIONS,
} from "./session";

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  // Empty means "follow the active voice model's global default".
  // Once the user explicitly picks a voice, we persist that exact id.
  voiceType: "",
  speedRatio: DEFAULT_SPEED_RATIO,
  showSubtitle: true,
};

export function normalizeUserPreferences(
  raw: unknown,
  allowedVoices?: VoiceOption[],
): UserPreferences {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_USER_PREFERENCES };
  }

  const record = raw as Record<string, unknown>;
  const voiceCandidate =
    typeof record.voiceType === "string" ? record.voiceType.trim() : DEFAULT_USER_PREFERENCES.voiceType;
  // Do not validate against a hard-coded provider here: Doubao / SiliconFlow /
  // local CosyVoice have different voice ids. Validation happens against the
  // active model profile in `pickVoiceType`; unsupported saved ids simply fall
  // back to that model's global default without overwriting the user's choice.
  const voiceType =
    allowedVoices && voiceCandidate
      ? allowedVoices.some((voice) => voice.id === voiceCandidate)
        ? voiceCandidate
        : DEFAULT_USER_PREFERENCES.voiceType
      : voiceCandidate;

  const speedCandidate = Number(record.speedRatio ?? DEFAULT_SPEED_RATIO);
  const speedRatio = SPEED_OPTIONS.some((speed) => speed.ratio === speedCandidate)
    ? speedCandidate
    : DEFAULT_SPEED_RATIO;

  return {
    voiceType,
    speedRatio,
    showSubtitle: record.showSubtitle !== false,
  };
}
