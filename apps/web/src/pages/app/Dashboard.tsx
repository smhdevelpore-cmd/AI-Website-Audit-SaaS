import { Link } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton.js";
import { useProfile } from "../../lib/useProfile.js";

/**
 * The overview. There are no audits yet — and no endpoint that could list them — so this screen
 * shows an empty state rather than four cards of zeros, which would read as measurements.
 */
export function Dashboard() {
  const { email } = useAuth();
  const { state, reload } = useProfile();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" description="What your audits found, at a glance." />

      {state.status === "loading" ? (
        <div role="status" aria-label="Loading your account">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <Skeleton className="h-5 w-40" />
            <div className="mt-3">
              <SkeletonText lines={2} />
            </div>
          </div>
          <span className="sr-only">Loading your account…</span>
        </div>
      ) : null}

      {state.status === "error" ? (
        <ErrorState title="We could not load your account" description={state.message} onRetry={reload} />
      ) : null}

      {state.status === "ready" ? (
        <EmptyState
          title="No audits yet"
          description={
            <>
              When a scan finishes, its overall score, issue count and status appear here, with the full
              findings behind it. Nothing has run for <strong>{state.profile.name}</strong> yet.
            </>
          }
          action={
            <Link
              to="/audits"
              className="text-sm font-medium text-primary-strong underline underline-offset-2"
            >
              See audit history
            </Link>
          }
        />
      ) : null}

      <section
        aria-labelledby="account-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 id="account-heading" className="text-base font-semibold text-ink">
          Account
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Email</dt>
          <dd className="text-ink">{email ?? "Not available in this session"}</dd>
          <dt className="text-muted">Profile</dt>
          <dd className="text-ink">
            <Link to="/settings" className="text-primary-strong underline underline-offset-2">
              Edit your details
            </Link>
          </dd>
        </dl>
      </section>
    </div>
  );
}
