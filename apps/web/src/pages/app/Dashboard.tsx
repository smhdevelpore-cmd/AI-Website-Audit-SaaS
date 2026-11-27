/**
 * The overview.
 *
 * It shows the five most recent audits as the API returns them — no counts, no averages, no
 * scores, because there are none to show yet. The empty state is the same one from Phase 3,
 * now with the action that can actually change it.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider.js";
import { NewAuditDialog } from "../../components/NewAuditDialog.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton.js";
import { ApiError } from "../../lib/api.js";
import { presentStage, presentStatus } from "../../lib/audit-labels.js";
import { useAudits } from "../../lib/audits.js";
import { useProfile } from "../../lib/useProfile.js";

export function Dashboard() {
  const { email } = useAuth();
  const profile = useProfile();
  const audits = useAudits({ page: 1, limit: 5 });
  const [dialogOpen, setDialogOpen] = useState(false);

  const recent = audits.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="What your audits found, at a glance."
        actions={<Button onClick={() => setDialogOpen(true)}>New audit</Button>}
      />

      {audits.isPending ? (
        <div role="status" aria-label="Loading your audits">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <Skeleton className="h-5 w-40" />
            <div className="mt-3">
              <SkeletonText lines={2} />
            </div>
          </div>
          <span className="sr-only">Loading your audits…</span>
        </div>
      ) : null}

      {audits.isError ? (
        <ErrorState
          title="We could not load your audits"
          description={audits.error instanceof ApiError ? audits.error.message : "Something went wrong."}
          onRetry={() => void audits.refetch()}
        />
      ) : null}

      {audits.isSuccess && recent.length === 0 ? (
        <EmptyState
          title="No audits yet"
          description={
            <>
              Submit an address and its status appears here while the scan runs. Nothing has run for{" "}
              <strong>
                {profile.state.status === "ready" ? profile.state.profile.name : "this account"}
              </strong>{" "}
              yet.
            </>
          }
          action={<Button onClick={() => setDialogOpen(true)}>Run your first audit</Button>}
        />
      ) : null}

      {recent.length > 0 ? (
        <section
          aria-labelledby="recent-heading"
          className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-heading" className="text-base font-semibold text-ink">
              Recent audits
            </h2>
            <Link
              to="/audits"
              className="text-sm font-medium text-primary-strong underline underline-offset-2"
            >
              See all
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {recent.map((audit) => {
              const status = presentStatus(audit.status);
              const stage = presentStage(audit.stage);
              return (
                <li key={audit.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <Link
                      to={`/audits/${audit.id}`}
                      className="font-medium text-ink underline underline-offset-2 hover:text-primary-strong"
                    >
                      {audit.host}
                    </Link>
                    <p className="text-xs text-muted">
                      {new Date(audit.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {audit.clientName === null ? "" : ` · ${audit.clientName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {stage === null ? null : <span className="text-xs text-muted">{stage}</span>}
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
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

      <NewAuditDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
