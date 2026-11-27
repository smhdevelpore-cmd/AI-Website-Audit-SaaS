/**
 * Audit history (PRD FR-16, Design.md §4).
 *
 * Search, a status filter, pagination and row actions are all backed by the API and all do
 * something: they are the same query the endpoint accepts. When the list is empty the controls
 * are hidden rather than shown disabled — a filter over nothing is noise.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import type { AuditStatus } from "@siteaudit/shared-types";

import { presentStage, presentStatus } from "../../lib/audit-labels.js";
import { useAudits, useCancelAudit, type Audit } from "../../lib/audits.js";
import { ApiError } from "../../lib/api.js";
import { NewAuditDialog } from "../../components/NewAuditDialog.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Input } from "../../components/ui/Input.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton.js";
import { DataTable, type Column } from "../../components/ui/Table.js";
import { useToast } from "../../components/ui/Toast.js";

const PAGE_SIZE = 10;
const STATUS_FILTERS: ReadonlyArray<{ value: "" | AuditStatus; label: string }> = [
  { value: "", label: "Any status" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

function shortDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Audits() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | AuditStatus>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const query = useAudits({
    page,
    limit: PAGE_SIZE,
    ...(status === "" ? {} : { status }),
    ...(search === "" ? {} : { search }),
  });

  const cancel = useCancelAudit();
  const toast = useToast();

  const columns: Array<Column<Audit>> = [
    {
      key: "site",
      header: "Site",
      cell: (audit) => (
        <Link
          to={`/audits/${audit.id}`}
          className="font-medium text-primary-strong underline underline-offset-2"
        >
          {audit.host}
        </Link>
      ),
    },
    {
      key: "client",
      header: "Client",
      cell: (audit) => audit.clientName ?? "—",
    },
    {
      key: "status",
      header: "Status",
      cell: (audit) => {
        const status = presentStatus(audit.status);
        const stage = presentStage(audit.stage);
        return (
          <span className="flex flex-col gap-1">
            <Badge tone={status.tone}>{status.label}</Badge>
            {stage === null ? null : <span className="text-xs text-muted">{stage}</span>}
          </span>
        );
      },
    },
    {
      key: "pages",
      header: "Pages",
      align: "end",
      cell: (audit) => `${audit.pagesScanned} / ${audit.maxPages}`,
    },
    {
      key: "created",
      header: "Requested",
      cell: (audit) => <span className="whitespace-nowrap">{shortDate(audit.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "end",
      cell: (audit) =>
        audit.status === "queued" ? (
          <Button
            variant="ghost"
            size="sm"
            loading={cancel.isPending && cancel.variables === audit.id}
            onClick={() =>
              cancel.mutate(audit.id, {
                onSuccess: () =>
                  toast.show({
                    title: "Audit cancelled",
                    description: "Nothing was scanned.",
                    tone: "neutral",
                  }),
                onError: (error: unknown) =>
                  toast.show({
                    title: "That audit could not be cancelled",
                    description: error instanceof ApiError ? error.message : "It may have started already.",
                    tone: "critical",
                  }),
              })
            }
          >
            Cancel
          </Button>
        ) : (
          <Link
            to={`/audits/${audit.id}`}
            className="text-sm text-primary-strong underline underline-offset-2"
          >
            Open
          </Link>
        ),
    },
  ];

  const total = query.data?.meta.total ?? 0;
  const meta = query.data?.meta;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My audits"
        description="Every scan you have run, newest first."
        actions={<Button onClick={() => setDialogOpen(true)}>New audit</Button>}
      />

      {query.isPending ? (
        <div role="status" aria-label="Loading your audits">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4">
              <SkeletonText lines={4} />
            </div>
          </div>
          <span className="sr-only">Loading your audits…</span>
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          title="We could not load your audits"
          description={query.error instanceof ApiError ? query.error.message : "Something went wrong."}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.isSuccess && total === 0 && search === "" && status === "" ? (
        <EmptyState
          title="No audits yet"
          description="Submit an address and this page will show the scan's status while it runs, then its results."
          action={<Button onClick={() => setDialogOpen(true)}>Run your first audit</Button>}
        />
      ) : null}

      {query.isSuccess && (total > 0 || search !== "" || status !== "") ? (
        <>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput);
            }}
          >
            <div className="flex-1">
              <Input
                label="Search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Address, client or project"
                hint="Matches the address, the client name and the project name."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="status-filter" className="text-sm font-medium text-ink">
                Status
              </label>
              <select
                id="status-filter"
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value as "" | AuditStatus);
                }}
                className="h-11 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink"
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>

          {total === 0 ? (
            <EmptyState
              title="No audits match that"
              description="Try a different search term, or clear the filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setSearchInput("");
                    setStatus("");
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <DataTable
              caption="Your audits"
              columns={columns}
              rows={query.data?.rows ?? []}
              getRowKey={(audit) => audit.id}
              emptyMessage="No audits on this page."
            />
          )}

          {meta === undefined ? null : (
            <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Page {meta.page} of {meta.totalPages} · {meta.total} {meta.total === 1 ? "audit" : "audits"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!meta.hasMore}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          )}
        </>
      ) : null}

      <NewAuditDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
