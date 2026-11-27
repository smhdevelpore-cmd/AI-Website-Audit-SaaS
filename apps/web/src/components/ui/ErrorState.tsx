import type { ReactNode } from "react";

/**
 * Something failed. The message says what happened in the user's terms and, when a retry is
 * possible, offers exactly one way to retry it.
 */
export function ErrorState({
  title = "That did not load",
  description,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  description: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-critical/40 bg-tint-critical px-6 py-8 text-center"
    >
      <h2 className="text-base font-semibold text-critical-strong">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink">{description}</p>
      {onRetry === undefined ? null : (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-control)] border border-critical-strong px-3 text-sm font-medium text-critical-strong"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
