/**
 * The scan pipeline (TRD §6), as a list of steps.
 *
 * Phase 4 ships the runner and the contract, and an **empty** step list. That is not a stub to
 * be filled in later by rewriting everything: it is the seam the crawler, the provider, the rule
 * engine and the scorer plug into, one step each, in the order the TRD names them.
 *
 * Because the list is empty, an audit submitted today cannot complete — and it does not pretend
 * to. The runner records `scanner_not_ready` and the UI says so in a sentence a person can act
 * on. Nothing is measured until a real step exists to measure it.
 */

import type { AuditStage } from "@siteaudit/shared-types";
import type { SafeTarget } from "@siteaudit/validation";

import type { WorkerAudit } from "./data.js";

export interface ScanContext {
  readonly audit: WorkerAudit;
  /** Validated addresses. A step connects to these, never re-resolves. */
  readonly target: SafeTarget;
  /** Aborted when the audit's total time budget is spent. */
  readonly signal: AbortSignal;
}

/**
 * `continue` — the step did its work and the pipeline moves on.
 * `{ status }` — the step decided this audit is finished (`completed`, or `partial` when a
 * module failed and the results cover only what succeeded).
 */
export type ScanStepResult =
  "continue" | { readonly status: "completed" | "partial"; readonly pagesScanned: number };

export interface ScanStep {
  /** Written to `audits.stage` before the step runs, so the UI can say what is happening. */
  readonly stage: AuditStage;
  run(context: ScanContext): Promise<ScanStepResult>;
}

/** The registry for this build. Phase 5 fills it; tests pass their own. */
export const SCAN_STEPS: readonly ScanStep[] = [];
