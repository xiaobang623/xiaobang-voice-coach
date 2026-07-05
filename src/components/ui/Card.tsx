import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "default" | "elevated" | "ghost" | "inset";

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "bg-surface border border-border-subtle shadow-card",
  elevated: "bg-surface-raised border border-border-subtle shadow-elevated",
  ghost: "bg-surface/60 border border-border-subtle/60",
  inset:
    "bg-gradient-to-b from-surface via-surface to-bg-warm border border-border-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: ReactNode;
}

export function Card({ variant = "default", className = "", children, ...props }: CardProps) {
  return (
    <div className={`rounded-[var(--radius-card)] ${VARIANT_CLASS[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}
