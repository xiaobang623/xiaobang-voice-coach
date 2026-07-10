import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "default" | "elevated" | "ghost" | "inset";

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "bg-surface border border-border",
  elevated: "bg-surface-raised border border-border shadow-elevated",
  ghost: "bg-surface/70 border border-border-subtle/70",
  inset:
    "bg-surface-muted border border-surface-muted",
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
