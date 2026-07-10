const VOICE_INITIAL: Record<string, string> = {
  zh_female_vv_jupiter_bigtts: "V",
  zh_female_xiaohe_jupiter_bigtts: "何",
  zh_male_yunzhou_jupiter_bigtts: "舟",
  zh_male_xiaotian_jupiter_bigtts: "天",
  alex: "A",
  benjamin: "B",
  charles: "C",
  david: "D",
  anna: "A",
  bella: "B",
  claire: "C",
  diana: "D",
  xiaobang_default: "默",
};

/** Tonal steps within the app's own warm palette — deterministic per voice, no rainbow hues. */
const AVATAR_TONES = [
  "bg-bg-warm text-text-secondary",
  "bg-surface-raised text-text ring-1 ring-inset ring-border-subtle",
  "bg-accent-soft text-accent",
  "bg-surface-raised text-text-secondary ring-1 ring-inset ring-border",
  "bg-bg-warm/70 text-text-muted",
] as const;

function toneForVoice(voiceId: string): string {
  let hash = 0;
  for (let i = 0; i < voiceId.length; i += 1) {
    hash = (hash * 31 + voiceId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function VoiceAvatar({
  voiceId,
  label,
  size = "md",
}: {
  voiceId: string;
  label: string;
  size?: "sm" | "md";
}) {
  const initial = VOICE_INITIAL[voiceId] ?? label.charAt(0).toUpperCase();
  const tone = toneForVoice(voiceId);
  const sizeClass = size === "sm" ? "h-6 w-6 text-[11px]" : "h-7 w-7 text-xs";

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${tone} ${sizeClass}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
