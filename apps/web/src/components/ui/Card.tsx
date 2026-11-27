import type { ReactNode } from "react";

import { cx } from "../cx.js";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, as: Tag = "h3" }: { children: ReactNode; as?: "h2" | "h3" | "h4" }) {
  return <Tag className="text-base font-semibold text-ink">{children}</Tag>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-muted">{children}</p>;
}

export function CardActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>;
}
