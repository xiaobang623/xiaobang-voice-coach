const VOICE_STYLE: Record<string, { bg: string; initial: string }> = {
  zh_female_vv_jupiter_bigtts: { bg: "bg-rose-200/70", initial: "V" },
  zh_female_xiaohe_jupiter_bigtts: { bg: "bg-sky-200/70", initial: "何" },
  zh_male_yunzhou_jupiter_bigtts: { bg: "bg-amber-200/70", initial: "舟" },
  zh_male_xiaotian_jupiter_bigtts: { bg: "bg-emerald-200/70", initial: "天" },
};

export function VoiceAvatar({
  voiceId,
  label,
  size = "md",
}: {
  voiceId: string;
  label: string;
  size?: "sm" | "md";
}) {
  const style = VOICE_STYLE[voiceId] ?? {
    bg: "bg-accent-soft",
    initial: label.charAt(0).toUpperCase(),
  };
  const sizeClass = size === "sm" ? "h-6 w-6 text-[11px]" : "h-7 w-7 text-xs";

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-medium text-text-secondary ${style.bg} ${sizeClass}`}
      aria-hidden="true"
    >
      {style.initial}
    </span>
  );
}
