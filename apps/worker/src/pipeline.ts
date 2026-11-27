/**
 * The scan pipeline (TRD §6), as a list of steps.
 *
 * A step declares the stage it runs in, does one module's work, and either says "continue" or
 * finishes the audit. The runner owns status, timing and failure classification; a step owns
 * exactly one thing — which is what makes `crawling` testable without a rule engine and `rules`
 * testable without a network.
 *
 * Two errors are distinguished, and the distinction is the whole retry policy:
 *
 *  - a step that throws anything other than `FatalScanError` is an unexpected failure, retried;
 *  - a step that throws `FatalScanError` has judged the target, and the audit fails with that code
 *    immediately. Retrying "the site is down" three times makes a broken site look flaky.
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
  /**
   * Per-run scratch space, created fresh for each job. It is how `crawling` hands its summary to
   * `rules` without writing the whole crawl into the database and reading it back.
   */
  readonly state: Map<string, unknown>;
}

/**
 * A failure the target is responsible for: unreachable, or nothing a rule can be run on. The audit
 * is finished with the code and is not retried.
 */
export class FatalScanError extends Error {
  readonly code: "target_unreachable" | "target_not_allowed" | "internal_error";
  constructor(code: FatalScanError["code"], message: string) {
    super(message);
    this.name = "FatalScanError";
    this.code = code;
  }
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

/** The steps this build runs, built by `createScanSteps` with its data and crawler. */
