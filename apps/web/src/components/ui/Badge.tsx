import type { ReactNode } from "react";

import { cx } from "../cx.js";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "critical";

const TONES: Record<BadgeTone, string> = {
  // Each pair is a tinted background with a text-safe foreground; the word inside carries the
  // meaning, so nothing here relies on colour alone (Design.md §7).
  neutral: "bg-tint-neutral text-ink",
  brand: "bg-tint-brand text-primary-strong",
  success: "bg-tint-success text-success-strong",
  warning: "bg-tint-warning text-warning-strong",
  critical: "bg-tint-critical text-critical-strong",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
