/**
 * One audit, while it happens (TRD §5 `GET /audits/:id`, `DELETE /audits/:id`).
 *
 * This is the page that has to be honest. It polls while the audit is live and stops when it is
 * not, it shows the stage the worker actually reported, and when the audit failed it shows the
 * reason in a sentence rather than an empty results area that implies zero problems.
 */

import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../../lib/api.js";
import { presentCategory, presentFailure, presentStage, presentStatus } from "../../lib/audit-labels.js";
import { useAudit, useCancelAudit } from "../../lib/audits.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton.js";
import { useToast } from "../../components/ui/Toast.js";

function formatDate(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditDetail() {
  const { auditId = "" } = useParams<{ auditId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const query = useAudit(auditId);
  const cancel = useCancelAudit();

  const audit = query.data;
  const score = audit?.overallScore ?? null;
  const weightedCategories = (audit?.categoryScores ?? []).filter((entry) => entry.weight > 0);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Audit" description="Loading this audit…" />
        <div role="status" aria-label="Loading the audit">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <Skeleton className="h-5 w-48" />
            <div className="mt-3">
              <SkeletonText lines={3} />
            </div>
          </div>
          <span className="sr-only">Loading the audit…</span>
        </div>
      </div>
    );
  }

  if (query.isError) {
    const error = query.error;
    const notFound =
      error instanceof ApiError && (error.code === "not_found" || error.code === "audit_not_found");
    if (notFound) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="Audit not found" description="There is no audit with that id on this account." />
          <EmptyState
            title="Nothing to show"
            description="It may have been deleted, or the link may belong to another account."
            action={
              <Link
                to="/audits"
                className="text-sm font-medium text-primary-strong underline underline-offset-2"
              >
                Back to audit history
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Audit" description={`Audit ${auditId}`} />
        <ErrorState
          title="We could not load this audit"
          description={error instanceof ApiError ? error.message : "Something went wrong."}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  // Both earlier branches returned; the query cannot be neither pending, error nor successful.
  if (audit === undefined) return null;

  const status = presentStatus(audit.status);
  const stage = presentStage(audit.stage);
  const live = audit.status === "queued" || audit.status === "running";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={audit.host}
        description={audit.url}
        actions={
          <>
            <Link
              to="/audits"
              className="text-sm font-medium text-primary-strong underline underline-offset-2"
            >
              All audits
            </Link>
            {audit.status === "queued" ? (
              <Button
                variant="secondary"
                size="sm"
                loading={cancel.isPending}
                onClick={() =>
                  cancel.mutate(audit.id, {
                    onSuccess: () => {
                      toast.show({
                        title: "Audit cancelled",
                        description: "Nothing was scanned.",
                        tone: "neutral",
                      });
                      navigate("/audits");
                    },
                    onError: (error: unknown) => {
                      toast.show({
                        title: "That audit could not be cancelled",
                        description:
                          error instanceof ApiError ? error.message : "It may have started already.",
                        tone: "critical",
                      });
                      void query.refetch();
                    },
                  })
                }
              >
                Cancel audit
              </Button>
            ) : null}
          </>
        }
      />

      <section
        aria-labelledby="status-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 id="status-heading" className="sr-only">
          Status
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={status.tone}>{status.label}</Badge>
          {stage === null ? null : <span className="text-sm text-muted">{stage}</span>}
          {live ? (
            <span className="text-xs text-muted" aria-live="polite">
              Updating automatically…
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-ink">{status.description}</p>

        {audit.status === "failed" ? (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-control)] bg-tint-critical px-3 py-2 text-sm text-critical-strong"
          >
            {audit.error?.message ?? presentFailure(audit.error?.code ?? "internal_error")}
          </p>
        ) : null}

        {audit.status === "queued" ? (
          <p className="mt-4 rounded-[var(--radius-control)] bg-tint-neutral px-3 py-2 text-sm text-ink">
            Nothing has been measured yet. The score and findings appear here once the scan produces them —
            this page is not showing zero problems, it is showing no results.
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="details-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 id="details-heading" className="text-base font-semibold text-ink">
          Details
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Client</dt>
            <dd className="text-ink">{audit.clientName ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Project</dt>
            <dd className="text-ink">{audit.projectName ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Pages requested</dt>
            <dd className="text-ink">{audit.maxPages}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Pages scanned</dt>
            <dd className="text-ink">{audit.pagesScanned}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Requested</dt>
            <dd className="text-ink">{formatDate(audit.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Started</dt>
            <dd className="text-ink">{formatDate(audit.startedAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Finished</dt>
            <dd className="text-ink">{formatDate(audit.completedAt)}</dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="results-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 id="results-heading" className="text-base font-semibold text-ink">
          Results
        </h2>
        {score === null ? (
          <p className="mt-2 text-sm text-muted">
            {audit.status === "failed" || audit.status === "cancelled"
              ? "This audit produced no results, so there is nothing to show here."
              : audit.status === "completed" || audit.status === "partial"
                ? "This audit finished without a score, so there is nothing to show here."
                : "Scores appear here when the scan finishes."}
          </p>
        ) : (
          <div className="mt-3">
            <p className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-ink">{score}</span>
              <span className="text-sm text-muted">out of 100</span>
            </p>
            <dl className="mt-4 flex flex-col">
              {weightedCategories.map((entry) => (
                <div
                  key={entry.category}
                  className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0"
                >
                  <dt className="text-sm text-muted">
                    {presentCategory(entry.category)}
                    <span className="ml-1 text-xs">({entry.weight}% of the score)</span>
                  </dt>
                  <dd className="text-sm font-medium text-ink">
                    {entry.score === null ? "N/A" : entry.score}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-muted">
              Weighted across the categories this scan could check. A category shown as N/A was not checked,
              and its weight is shared by the others; link findings count towards Technical.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
