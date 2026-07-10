import type { VoiceOption } from "../types";
import { DEFAULT_VOICE_TYPE, VOICE_OPTIONS } from "./session";

export type VoiceProfileProvider =
  | "doubao"
  | "local-cosyvoice"
  | "siliconflow-cosyvoice"
  | "siliconflow-moss-ttsd";

export interface VoiceProfile {
  provider: VoiceProfileProvider;
  defaultVoice: string;
  voices: VoiceOption[];
}

export const SILICONFLOW_VOICE_OPTIONS: VoiceOption[] = [
  { id: "alex", label: "Alex" },
  { id: "benjamin", label: "Benjamin" },
  { id: "charles", label: "Charles" },
  { id: "david", label: "David" },
  { id: "anna", label: "Anna" },
  { id: "bella", label: "Bella" },
  { id: "claire", label: "Claire" },
  { id: "diana", label: "Diana" },
];

const FALLBACK_COSYVOICE_VOICE_OPTIONS: VoiceOption[] = [
  { id: "xiaobang_default", label: "默认音色" },
];

export interface VoiceBackendConfigPayload {
  backend?: string;
  doubao?: { dialogModel?: string };
  selfhosted?: {
    asrProvider?: string;
    ttsProvider?: string;
    siliconflowTtsVoice?: string;
    whisperModel?: string;
    deepseekModel?: string;
    cosyvoiceModelKey?: string;
  };
}

export const FALLBACK_VOICE_PROFILE: VoiceProfile = {
  provider: "doubao",
  defaultVoice: DEFAULT_VOICE_TYPE,
  voices: [...VOICE_OPTIONS],
};

export function buildVoiceProfileFromConfig(
  config: VoiceBackendConfigPayload | undefined,
): VoiceProfile {
  if (config?.backend !== "selfhosted") {
    return {
      provider: "doubao",
      defaultVoice: DEFAULT_VOICE_TYPE,
      voices: [...VOICE_OPTIONS],
    };
  }

  const ttsProvider = config.selfhosted?.ttsProvider ?? "local-cosyvoice";

  if (ttsProvider === "siliconflow-cosyvoice" || ttsProvider === "siliconflow-moss-ttsd") {
    const defaultVoice = config.selfhosted?.siliconflowTtsVoice?.trim() || "diana";
    return {
      provider: ttsProvider,
      defaultVoice,
      voices: [...SILICONFLOW_VOICE_OPTIONS],
    };
  }

  return {
    provider: "local-cosyvoice",
    defaultVoice: FALLBACK_COSYVOICE_VOICE_OPTIONS[0].id,
    voices: [...FALLBACK_COSYVOICE_VOICE_OPTIONS],
  };
}

export function resolveVoiceProfileFromApiPayload(payload: {
  backend?: string;
  voiceProfile?: unknown;
  config?: VoiceBackendConfigPayload;
}): VoiceProfile {
  const config =
    payload.config ??
    (payload.backend ? { backend: payload.backend } : undefined);

  if (config?.backend === "selfhosted") {
    const profile = buildVoiceProfileFromConfig(config);
    if (profile.provider === "local-cosyvoice" && payload.voiceProfile) {
      const enriched = normalizeVoiceProfile(payload.voiceProfile);
      if (enriched.voices.length > 0) {
        return enriched;
      }
    }
    return profile;
  }

  if (payload.voiceProfile) {
    return normalizeVoiceProfile(payload.voiceProfile);
  }

  return buildVoiceProfileFromConfig(config);
}

export function normalizeVoiceProfile(raw: unknown): VoiceProfile {
  if (!raw || typeof raw !== "object") {
    return { ...FALLBACK_VOICE_PROFILE, voices: [...FALLBACK_VOICE_PROFILE.voices] };
  }

  const record = raw as Record<string, unknown>;
  const provider =
    record.provider === "local-cosyvoice" ||
    record.provider === "siliconflow-cosyvoice" ||
    record.provider === "siliconflow-moss-ttsd"
      ? record.provider
      : "doubao";

  const voices = Array.isArray(record.voices)
    ? record.voices
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const voice = item as Record<string, unknown>;
          const id = typeof voice.id === "string" ? voice.id.trim() : "";
          const label = typeof voice.label === "string" ? voice.label.trim() : "";
          if (!id || !label) {
            return null;
          }
          return { id, label } satisfies VoiceOption;
        })
        .filter((item): item is VoiceOption => item !== null)
    : [];

  const fallbackVoices =
    provider === "doubao"
      ? VOICE_OPTIONS
      : provider.startsWith("siliconflow-")
        ? SILICONFLOW_VOICE_OPTIONS
        : FALLBACK_COSYVOICE_VOICE_OPTIONS;

  const resolvedVoices = voices.length > 0 ? voices : fallbackVoices;
  const defaultCandidate =
    typeof record.defaultVoice === "string" ? record.defaultVoice.trim() : "";
  const defaultVoice = resolvedVoices.some((voice) => voice.id === defaultCandidate)
    ? defaultCandidate
    : (resolvedVoices[0]?.id ?? FALLBACK_VOICE_PROFILE.defaultVoice);

  return {
    provider,
    defaultVoice,
    voices: resolvedVoices,
  };
}

export function pickVoiceType(
  voiceType: string | undefined,
  profile: VoiceProfile,
): string {
  if (voiceType && profile.voices.some((voice) => voice.id === voiceType)) {
    return voiceType;
  }
  return profile.defaultVoice;
}

export function showsVoicePicker(profile: VoiceProfile): boolean {
  return profile.provider !== "local-cosyvoice";
}
