import type { ReactNode } from "react";

/**
 * Nothing to show yet — said plainly, with the next honest step if there is one.
 * `action` is optional precisely so a state with no usable action renders no button.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted">{description}</p>
      {action === undefined ? null : <div className="mt-5">{action}</div>}
    </div>
  );
}
