/**
 * How an audit's machine-readable state becomes words (Design.md §7: never colour alone).
 *
 * Every status and every stage has a label, and every failure code has a sentence. Nothing here
 * is derived from the stored `error_message`: the API already replaced that with a generated
 * sentence, and this map is the client-side fallback for a code this build does not know yet.
 */

import type { AuditStatus } from "@siteaudit/shared-types";

import type { BadgeTone } from "../components/ui/Badge.js";

export interface StatusPresentation {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly description: string;
}

const STATUS: Readonly<Record<AuditStatus, StatusPresentation>> = {
  queued: {
    label: "Queued",
    tone: "neutral",
    description: "Waiting for a worker to pick this audit up.",
  },
  running: {
    label: "Running",
    tone: "brand",
    description: "A worker is scanning this site now.",
  },
  completed: {
    label: "Completed",
    tone: "success",
    description: "Every module finished and the results cover the whole scan.",
  },
  partial: {
    label: "Partial",
    tone: "warning",
    description: "Part of the scan could not run, so the results cover only what did.",
  },
  failed: {
    label: "Failed",
    tone: "critical",
    description: "The scan stopped before it produced results.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    description: "This audit was stopped before it started.",
  },
};

export function presentStatus(status: string): StatusPresentation {
  return (
    (STATUS as Record<string, StatusPresentation | undefined>)[status] ?? {
      label: status,
      tone: "neutral",
      description: "This audit is in a state this build does not recognise.",
    }
  );
}

const STAGES: Readonly<Record<string, string>> = {
  validating: "Checking the address",
  crawling: "Fetching pages",
  performance: "Measuring performance",
  rules: "Checking rules",
  links: "Checking links",
  scoring: "Scoring",
  ai: "Writing explanations",
  persisting: "Saving results",
};

export function presentStage(stage: string | null): string | null {
  if (stage === null) return null;
  return STAGES[stage] ?? stage;
}

/** The sentence shown under a failed audit, when the API did not supply one. */
export function presentFailure(code: string): string {
  switch (code) {
    case "target_not_allowed":
      return "That address is not a public website this service is allowed to scan.";
    case "target_unreachable":
      return "The website could not be reached, so nothing was measured.";
    case "scanner_not_ready":
      return "This build cannot scan websites yet. Nothing was measured and no report was produced.";
    case "queue_unavailable":
      return "The audit could not be queued, so it never started.";
    default:
      return "The scan stopped because of an internal error. No results were produced.";
  }
}
