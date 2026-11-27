/**
 * The bridge from BullMQ jobs to `runAuditJob`.
 *
 * BullMQ retries by *throwing*, and this is the only place that decides whether a result found
 * in the database should be turned into a throw. The runner has already classified the failure,
 * so: `retry` throws (BullMQ backs off and re-runs), anything else resolves (the job is done).
 */

import type { WorkerData } from "./data.js";
import { runAuditJob, type RunAuditDeps, type RunAuditResult } from "./run-audit.js";

export interface ProcessorDeps extends Omit<RunAuditDeps, "data" | "maxAttempts"> {
  readonly data: WorkerData;
  readonly maxAttempts: number;
  readonly log?: (line: string, context: Record<string, unknown>) => void;
}

export function createProcessor(deps: ProcessorDeps) {
  return async (job: { auditId: string; attempt: number; maxAttempts: number }): Promise<RunAuditResult> => {
    const result = await runAuditJob(
      { auditId: job.auditId, attempt: job.attempt },
      { ...deps, maxAttempts: Math.max(job.maxAttempts, 1) },
    );

    if (result.outcome === "retry") {
      // Message only: the row already carries the sanitized sentence, and BullMQ stores this
      // string in Redis for operators, not for users.
      throw new Error(`retrying audit (${result.reason})`);
    }
    return result;
  };
}
