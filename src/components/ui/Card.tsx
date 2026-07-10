import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "default" | "elevated" | "ghost" | "inset";

const VARIANT_CLASS: Record<CardVariant, string> = {
  // White surface against the warm cream page background gives enough separation —
  // no border needed, keeps the card look from feeling generic/templated.
  default: "bg-surface shadow-card ring-1 ring-border-subtle/80",
  elevated: "bg-surface-raised shadow-elevated ring-1 ring-border-subtle/80",
  ghost: "bg-surface/70 border border-border-subtle/70",
  inset:
    "bg-gradient-to-b from-surface via-surface to-bg-warm border border-border-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: ReactNode;
}

export function Card({ variant = "default", className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-[var(--radius-card)] ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
