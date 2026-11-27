import type { ReactNode } from "react";

/** Title, optional one-line description, optional actions. Every screen starts with this. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
