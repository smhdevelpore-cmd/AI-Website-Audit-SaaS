import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The frame shared by sign in, sign up and password recovery: one narrow column, the product
 * name, and a way back to the marketing page.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="px-4 py-6 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-primary" />
          Site Audit
        </Link>
      </div>

      <main
        id="main"
        className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0"
      >
        <div className="w-full max-w-md">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
            {description === undefined ? null : <p className="mt-1 text-sm text-muted">{description}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer === undefined ? null : <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
