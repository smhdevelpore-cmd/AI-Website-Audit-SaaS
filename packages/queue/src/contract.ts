/**
 * The queue contract (TRD §6, ARD §10).
 *
 * One job per audit, named by the audit's id. That single decision gives idempotency for free:
 * enqueueing the same audit twice cannot produce two jobs, because the job id *is* the audit id.
 *
 * Nothing here imports BullMQ, so the API can depend on the interface and be tested without a
 * Redis server, and a deployment without Redis can be refused loudly instead of pretending.
 */

import { z } from "zod";

/** Queue names are visible in Redis; a prefix keeps two environments' keys apart. */
export const AUDIT_QUEUE_NAME = "siteaudit.audit";

export const AUDIT_JOB_NAME = "scan";

/**
 * The only thing a job carries is which row to work on. The row is the source of truth, so a
 * retry re-reads it rather than trusting a stale payload.
 */
export const auditJobDataSchema = z.object({ auditId: z.uuid() }).strict();
export type AuditJobData = z.infer<typeof auditJobDataSchema>;

export function parseAuditJobData(value: unknown): AuditJobData | null {
  const result = auditJobDataSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Retry policy: transient infrastructure failures get three attempts with exponential backoff
 * (2 s, 4 s). A rejected target or a bug does not retry — the caller must be able to tell the
 * difference, which is why the worker classifies before it throws.
 */
export const AUDIT_JOB_ATTEMPTS = 3;
export const AUDIT_JOB_BACKOFF_MS = 2_000;

export interface AuditJobOptions {
  readonly jobId: string;
  readonly attempts: number;
  readonly backoff: { readonly type: "exponential"; readonly delay: number };
  /** Keep recent finished jobs for inspection; history lives in Postgres, not Redis. */
  readonly removeOnComplete: { readonly age: number; readonly count: number };
  readonly removeOnFail: { readonly age: number };
}

export function auditJobOptions(auditId: string): AuditJobOptions {
  return {
    jobId: auditId,
    attempts: AUDIT_JOB_ATTEMPTS,
    backoff: { type: "exponential", delay: AUDIT_JOB_BACKOFF_MS },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 86_400 },
  };
}

export interface EnqueueResult {
  readonly jobId: string;
  /** True when a job for this audit was already waiting, so nothing new was added. */
  readonly duplicate: boolean;
}

/**
 * `removed` — the job was waiting and is gone.
 * `running` — a worker holds it; it cannot be stopped safely from outside.
 * `not-queued` — there was no job to remove.
 */
export type CancelOutcome = "removed" | "running" | "not-queued";

export type QueueProvider = "bullmq" | "memory";

export interface QueueHealth {
  readonly status: "ok" | "unavailable";
  readonly provider: QueueProvider;
  readonly latencyMs: number | null;
  /** For logs. Never includes a URL, a password or any other connection detail. */
  readonly detail: string | null;
}

/**
 * What the API is allowed to ask of a queue. Deliberately small: no "peek", no "count", no
 * "enqueue anything" — a request path needs to add one job, remove one job, and report health.
 */
export interface AuditQueue {
  enqueue(auditId: string): Promise<EnqueueResult>;
  cancel(auditId: string): Promise<CancelOutcome>;
  health(): Promise<QueueHealth>;
  close(): Promise<void>;
}
