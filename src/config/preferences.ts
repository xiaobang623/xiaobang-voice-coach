import type { UserPreferences } from "../types";
import {
  DEFAULT_SPEED_RATIO,
  DEFAULT_VOICE_TYPE,
  SPEED_OPTIONS,
  VOICE_OPTIONS,
} from "./session";

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  voiceType: DEFAULT_VOICE_TYPE,
  speedRatio: DEFAULT_SPEED_RATIO,
  showSubtitle: true,
};

export function normalizeUserPreferences(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_USER_PREFERENCES };
  }

  const record = raw as Record<string, unknown>;
  const voiceCandidate = String(record.voiceType ?? DEFAULT_VOICE_TYPE);
  const voiceType = VOICE_OPTIONS.some((voice) => voice.id === voiceCandidate)
    ? voiceCandidate
    : DEFAULT_VOICE_TYPE;

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
