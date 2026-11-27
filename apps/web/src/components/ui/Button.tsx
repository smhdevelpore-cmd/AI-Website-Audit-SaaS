import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "../cx.js";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /**
   * Busy state. The label stays (so the button keeps its accessible name and its width), the
   * control is disabled, and `aria-busy` tells assistive tech why nothing happens yet.
   */
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:brightness-95 active:brightness-90",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-tint-neutral",
  ghost: "bg-transparent text-ink hover:bg-tint-neutral",
  // White on #DC2626 measures 4.83:1, so a destructive action keeps readable text.
  danger: "bg-critical text-white hover:brightness-95 active:brightness-90",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium",
        "transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
