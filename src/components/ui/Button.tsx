import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-surface hover:opacity-90 active:scale-[0.97]",
  secondary:
    "bg-surface text-text border border-border-strong hover:border-text-muted active:scale-[0.97]",
  ghost: "text-text-secondary hover:text-text active:scale-[0.97]",
  outline: "border border-border bg-surface text-text-secondary hover:border-border-strong active:scale-[0.97]",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-[22px] text-[15px]",
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
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-tight transition-all duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
