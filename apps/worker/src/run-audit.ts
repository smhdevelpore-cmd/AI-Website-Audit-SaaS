/**
 * Running one audit job (TRD §6).
 *
 * The rules this file exists to keep:
 *
 *  - **A job is not the truth, the row is.** Every run re-reads the audit. If it is already
 *    terminal, the run is a no-op: a retried job must never reopen a finished audit.
 *  - **Retries are for infrastructure, not for the target.** A DB blip is retried; a private
 *    address, a dead domain or a bug in a step is not. The distinction is made here, before
 *    BullMQ sees a throw, because a worker that retries everything makes a broken site look
 *    like a flaky server for six seconds and then fails anyway.
 *  - **Every message is generated from a code.** No exception text reaches the row, the API or
 *    the browser: it can carry a URL, a token, or a hostname someone is scanning.
 *  - **One terminal write.** `finish` is conditional on `completed_at is null`.
 */

import { isTerminalAuditStatus, type AuditFailureCode, type AuditStage } from "@siteaudit/shared-types";
import { UnsafeTargetError, type SafeTarget } from "@siteaudit/validation";

import type { WorkerData } from "./data.js";
import type { ScanStep, ScanStepResult } from "./pipeline.js";

export interface RunAuditDeps {
  readonly data: WorkerData;
  /** `assertSafeTarget` in production; tests inject a resolver instead of touching DNS. */
  readonly resolveTarget: (url: string) => Promise<SafeTarget>;
  readonly steps: readonly ScanStep[];
  /** Whole-run budget (TRD §7 "connect/read/total timeouts"). */
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly log?: (line: string, context: Record<string, unknown>) => void;
}

export interface AuditJob {
  readonly auditId: string;
  /** 1 on the first run. */
  readonly attempt: number;
}

export type RunAuditResult =
  | { readonly outcome: "done"; readonly status: "failed" | "cancelled" | "completed" | "partial" }
  | { readonly outcome: "skipped"; readonly reason: "missing" | "already-finished" | "not-queued" }
  | { readonly outcome: "retry"; readonly reason: string };

/** Signals "let BullMQ retry"; the DB has already been left in a resumable state. */
class RetryableFailure extends Error {
  readonly code: AuditFailureCode;
  constructor(code: AuditFailureCode, message: string) {
    super(message);
    this.name = "RetryableFailure";
    this.code = code;
  }
}

/**
 * A total time budget. The signal is a courtesy for steps that can honour it; the race is the
 * guarantee, because a step that ignores the signal must not hold the job open forever.
 */
async function withBudget<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RetryableFailure("internal_error", "audit timed out"));
    }, timeoutMs);
  });

  const running = work(controller.signal);
  // The race may settle first; the step's own rejection must not become an unhandled one.
  running.catch(() => undefined);

  try {
    return await Promise.race([running, timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runAuditJob(job: AuditJob, deps: RunAuditDeps): Promise<RunAuditResult> {
  const log = deps.log ?? (() => undefined);
  const { auditId } = job;

  try {
    return await runOnce(job, deps);
  } catch (error) {
    if (!(error instanceof RetryableFailure)) {
      // A bug, not an infrastructure blip. Retrying it would repeat the bug three times.
      log("audit failed with an unexpected error", { auditId, attempt: job.attempt });
      await deps.data
        .finish(auditId, { status: "failed", code: "internal_error" })
        .catch((finishError: unknown) => {
          log("could not record the failure", { auditId, error: String(finishError) });
        });
      return { outcome: "done", status: "failed" };
    }

    if (job.attempt < deps.maxAttempts) {
      log("audit will be retried", { auditId, attempt: job.attempt, code: error.code });
      return { outcome: "retry", reason: error.message };
    }

    log("audit failed after its last attempt", { auditId, attempt: job.attempt, code: error.code });
    await deps.data.finish(auditId, { status: "failed", code: error.code });
    return { outcome: "done", status: "failed" };
  }
}

/**
 * Database failures are infrastructure failures: the audit has not been judged, so the job is
 * retried rather than failed. Everything else is left alone to be classified by the caller.
 */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RetryableFailure || error instanceof UnsafeTargetError) throw error;
    throw new RetryableFailure("internal_error", "database operation failed");
  }
}

async function runOnce(job: AuditJob, deps: RunAuditDeps): Promise<RunAuditResult> {
  const { auditId } = job;

  const audit = await guarded(() => deps.data.loadAudit(auditId));
  if (audit === null) return { outcome: "skipped", reason: "missing" };
  if (isTerminalAuditStatus(audit.status)) return { outcome: "skipped", reason: "already-finished" };

  // `fresh` keeps the original start time across a retry instead of resetting it.
  const started = await guarded(() =>
    deps.data.markRunning(auditId, "validating", { fresh: audit.status !== "running" }),
  );
  if (!started) return { outcome: "skipped", reason: "not-queued" };

  await deps.data
    .recordUsage({ userId: audit.user_id, auditId, kind: "audit", quantity: 1 })
    // A meter that blocks a scan is worse than a missing row; the log is the record.
    .catch((error: unknown) =>
      (deps.log ?? (() => undefined))("usage record failed", { auditId, error: String(error) }),
    );

  let target: SafeTarget;
  try {
    target = await deps.resolveTarget(audit.url);
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      if (error.reason === "dns-failed") {
        // A resolver blip and a domain that does not exist look the same from here. One retry
        // tells them apart; the last attempt is final.
        throw new RetryableFailure("target_unreachable", "dns lookup failed");
      }
      await deps.data.finish(auditId, { status: "failed", code: "target_not_allowed" });
      return { outcome: "done", status: "failed" };
    }
    throw new RetryableFailure("internal_error", "target validation failed");
  }

  if (deps.steps.length === 0) {
    // This build has no crawler. Say so once, in words, instead of leaving the audit queued
    // forever or inventing a score.
    (deps.log ?? (() => undefined))("audit cannot be scanned: no pipeline steps", { auditId });
    await deps.data.finish(auditId, { status: "failed", code: "scanner_not_ready" });
    return { outcome: "done", status: "failed" };
  }

  const outcome = await withBudget(async (signal) => {
    for (const step of deps.steps) {
      signal.throwIfAborted();
      await guarded(() => deps.data.setStage(auditId, step.stage));
      let result: ScanStepResult;
      try {
        result = await step.run({ audit, target, signal });
      } catch {
        // A step does I/O (crawl, provider, AI). Those failures are the ones the TRD retries;
        // a deterministic bug will fail the same way three times and then be reported.
        throw new RetryableFailure("internal_error", `step ${step.stage} failed`);
      }
      if (result !== "continue") {
        await deps.data.finish(auditId, { status: result.status, pagesScanned: result.pagesScanned });
        return result.status;
      }
    }
    return null;
  }, deps.timeoutMs);

  if (outcome === null) {
    // Every step said "continue" and none produced a result: the pipeline is misassembled.
    (deps.log ?? (() => undefined))("pipeline ended without a result", { auditId });
    await deps.data.finish(auditId, { status: "failed", code: "internal_error" });
    return { outcome: "done", status: "failed" };
  }

  return { outcome: "done", status: outcome };
}

/** Exported for the worker bootstrap, which needs the same stage list for its logs. */
export type { AuditStage };
