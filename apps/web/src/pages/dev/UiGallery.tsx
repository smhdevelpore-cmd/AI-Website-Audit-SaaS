import { useState } from "react";

import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card, CardActions, CardDescription, CardTitle } from "../../components/ui/Card.js";
import { Dialog } from "../../components/ui/Dialog.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Input } from "../../components/ui/Input.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton.js";
import { DataTable } from "../../components/ui/Table.js";
import { useToast } from "../../components/ui/Toast.js";

/**
 * Component gallery for development. Reached only in a dev build (`import.meta.env.DEV` in
 * App.tsx), never shipped, and every row below is labelled as a fixture.
 *
 * This is the one place fake rows are allowed (Design.md §11 "no dead/fake controls" applies to
 * the product, and to a dev-only page whose entire purpose is to render components without
 * data). The heading says so; nothing here appears in the app.
 */

interface FixtureRow {
  domain: string;
  status: "completed" | "partial" | "failed";
  issues: number;
}

const FIXTURE_ROWS: FixtureRow[] = [
  { domain: "fixture-one.example", status: "completed", issues: 12 },
  { domain: "fixture-two.example", status: "partial", issues: 4 },
];

const STATUS_TONE = { completed: "success", partial: "warning", failed: "critical" } as const;

export function UiGallery() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Component gallery"
        description="Development only. Every row and number below is a fixture, not a measurement."
      />

      <section aria-labelledby="buttons-heading" className="flex flex-col gap-3">
        <h2 id="buttons-heading" className="text-sm font-semibold text-ink">
          Buttons
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section aria-labelledby="inputs-heading" className="flex flex-col gap-3">
        <h2 id="inputs-heading" className="text-sm font-semibold text-ink">
          Inputs
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Default" hint="A hint under the field." />
          <Input label="With an error" error="This value is not valid." defaultValue="not a url" />
          <Input label="Required" required />
          <Input label="Disabled" disabled defaultValue="Read only" />
        </div>
      </section>

      <section aria-labelledby="badges-heading" className="flex flex-col gap-3">
        <h2 id="badges-heading" className="text-sm font-semibold text-ink">
          Badges
        </h2>
        <div className="flex flex-wrap gap-2">
          <Badge>Queued</Badge>
          <Badge tone="brand">Running</Badge>
          <Badge tone="success">Completed</Badge>
          <Badge tone="warning">Partial</Badge>
          <Badge tone="critical">Failed</Badge>
        </div>
      </section>

      <section aria-labelledby="cards-heading" className="flex flex-col gap-3">
        <h2 id="cards-heading" className="text-sm font-semibold text-ink">
          Cards
        </h2>
        <Card>
          <CardTitle>Card title</CardTitle>
          <CardDescription>A description line that explains what the card is for.</CardDescription>
          <CardActions>
            <Button size="sm">Action</Button>
            <Button size="sm" variant="secondary">
              Secondary
            </Button>
          </CardActions>
        </Card>
      </section>

      <section aria-labelledby="table-heading" className="flex flex-col gap-3">
        <h2 id="table-heading" className="text-sm font-semibold text-ink">
          Table (fixtures) — becomes cards below 640px
        </h2>
        <DataTable<FixtureRow>
          caption="Fixture audits"
          rows={FIXTURE_ROWS}
          getRowKey={(row) => row.domain}
          emptyMessage="No fixture rows."
          columns={[
            { key: "domain", header: "Domain", cell: (row) => row.domain },
            {
              key: "status",
              header: "Status",
              cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
            },
            { key: "issues", header: "Issues", cell: (row) => row.issues, align: "end" },
          ]}
        />
      </section>

      <section aria-labelledby="states-heading" className="flex flex-col gap-3">
        <h2 id="states-heading" className="text-sm font-semibold text-ink">
          States
        </h2>
        <div
          role="status"
          aria-label="Loading example"
          className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
        >
          <Skeleton className="h-5 w-40" />
          <div className="mt-3">
            <SkeletonText lines={3} />
          </div>
          <span className="sr-only">Loading example</span>
        </div>
        <EmptyState
          title="Empty state"
          description="Nothing to show yet, and here is why."
          action={<Button size="sm">Next step</Button>}
        />
        <ErrorState
          description="Something failed and this is what happened."
          onRetry={() => toast.show({ title: "Retried" })}
        />
      </section>

      <section aria-labelledby="dialogs-heading" className="flex flex-col gap-3">
        <h2 id="dialogs-heading" className="text-sm font-semibold text-ink">
          Dialog and toasts
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button variant="secondary" onClick={() => toast.show({ title: "Saved", tone: "success" })}>
            Show success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.show({ title: "That failed", description: "A description line.", tone: "critical" })
            }
          >
            Show error toast
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Dialog title"
          description="Focus moves into the dialog, Tab stays inside it, Escape closes it."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
            </>
          }
        >
          <Input label="A field inside the dialog" />
        </Dialog>
      </section>
    </div>
  );
}
