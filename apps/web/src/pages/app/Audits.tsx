import { EmptyState } from "../../components/ui/EmptyState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

/**
 * Audit history shell (Design.md §4). Search, pagination and row actions arrive with the rows:
 * on an empty list they would be controls that do nothing.
 */
export function Audits() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My audits" description="Every scan you have run, newest first." />
      <EmptyState
        title="Nothing here yet"
        description="This is where each audit will list its domain, client, score, issue count, status and date, with a way to open the report."
      />
    </div>
  );
}
