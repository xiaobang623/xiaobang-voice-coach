import type { ReactNode } from "react";

type BadgeTone = "default" | "accent" | "muted";

const TONE_CLASS: Record<BadgeTone, string> = {
  default: "bg-accent-soft text-text-secondary",
  accent: "bg-accent text-surface",
  muted: "bg-bg-warm text-text-muted",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
