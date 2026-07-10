import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-surface shadow-[var(--shadow-pop)] hover:bg-accent-hover hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]",
  secondary:
    "bg-surface-raised text-text-secondary border border-border hover:bg-surface hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.94]",
  ghost: "text-text-secondary hover:bg-bg-warm/70 hover:text-text active:scale-[0.94]",
  outline:
    "border border-border bg-surface-raised/80 text-text-secondary hover:bg-surface shadow-card active:scale-[0.94]",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3.5 py-2 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-8 py-3.5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-medium tracking-tight transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
