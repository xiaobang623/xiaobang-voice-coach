import type { ReactNode } from "react";

type BadgeTone = "default" | "accent" | "muted" | "spark";

const TONE_CLASS: Record<BadgeTone, string> = {
  default: "bg-bg-warm text-text-secondary",
  accent: "bg-accent text-surface",
  muted: "bg-bg-warm/70 text-text-muted",
  spark: "bg-spark-soft text-spark-hover",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
