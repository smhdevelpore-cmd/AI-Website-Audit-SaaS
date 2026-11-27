/**
 * An in-process queue with the same semantics as the Redis one.
 *
 * It exists for two reasons, both of which are about honesty rather than convenience:
 *
 *  1. Tests can drive the whole handshake — submit, queue, consume, finish — without a Redis
 *     server, and without mocking the code under test.
 *  2. A deployment with no Redis can still boot the API and answer `503` truthfully, because
 *     `queue: null` is a supported state rather than a crash.
 *
 * It is never selected automatically in production: `apps/api/src/index.ts` builds a BullMQ
 * queue when `REDIS_URL` is set and passes `null` when it is not.
 */

import type { AuditQueue, CancelOutcome, EnqueueResult, QueueHealth } from "./contract.js";

type JobState = "waiting" | "active";

export interface MemoryQueueSnapshot {
  readonly waiting: readonly string[];
  readonly active: readonly string[];
}

export class MemoryAuditQueue implements AuditQueue {
  private readonly jobs = new Map<string, JobState>();
  /** Every enqueue call, in order, including duplicates. Tests assert on attempts, not guesses. */
  readonly calls: string[] = [];
  private available = true;
  private closed = false;

  /**
   * Turns the queue "off" the way a dead Redis would be off: enqueue and health both fail.
   * Tests use it to prove the API does not leave a queued row behind.
   */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  enqueue(auditId: string): Promise<EnqueueResult> {
    this.calls.push(auditId);
    if (this.closed) return Promise.reject(new Error("queue is closed"));
    if (!this.available) return Promise.reject(new Error("queue is unavailable"));

    const state = this.jobs.get(auditId);
    if (state !== undefined) return Promise.resolve({ jobId: auditId, duplicate: true });

    this.jobs.set(auditId, "waiting");
    return Promise.resolve({ jobId: auditId, duplicate: false });
  }

  cancel(auditId: string): Promise<CancelOutcome> {
    const state = this.jobs.get(auditId);
    if (state === undefined) return Promise.resolve("not-queued");
    if (state === "active") return Promise.resolve("running");
    this.jobs.delete(auditId);
    return Promise.resolve("removed");
  }

  health(): Promise<QueueHealth> {
    if (this.closed) {
      return Promise.resolve({
        status: "unavailable",
        provider: "memory",
        latencyMs: null,
        detail: "closed",
      });
    }
    return Promise.resolve({
      status: this.available ? "ok" : "unavailable",
      provider: "memory",
      latencyMs: 0,
      detail: this.available ? null : "not available",
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.jobs.clear();
    return Promise.resolve();
  }

  /* --------------------------------------------------------------- harness */

  /** Next waiting audit, marked active — what a worker would receive. */
  take(): string | null {
    for (const [auditId, state] of this.jobs) {
      if (state === "waiting") {
        this.jobs.set(auditId, "active");
        return auditId;
      }
    }
    return null;
  }

  /** A worker finished or gave up on one job. */
  finish(auditId: string): void {
    this.jobs.delete(auditId);
  }

  snapshot(): MemoryQueueSnapshot {
    const waiting: string[] = [];
    const active: string[] = [];
    for (const [auditId, state] of this.jobs) {
      (state === "waiting" ? waiting : active).push(auditId);
    }
    return { waiting, active };
  }
}
