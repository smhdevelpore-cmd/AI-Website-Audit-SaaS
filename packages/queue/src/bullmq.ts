/**
 * BullMQ, behind the contract in `contract.ts` (TRD §1 "Jobs: Redis + BullMQ").
 *
 * The API and the worker both build their connection from `REDIS_URL` here, so the rules that
 * are easy to get subtly wrong — which protocol is allowed, non-blocking retry limits, what a
 * health check actually proves — exist once.
 *
 * Not covered by the tests in this repository: a real Redis server. The sandbox has no Redis and
 * no Docker, so the endpoint and worker tests run against `MemoryAuditQueue`. A Redis-backed run
 * is opt-in via `REDIS_TEST_URL` (see `tests/integration/queue-bullmq.test.ts`); anything that
 * needs one is reported as skipped rather than claimed as passing.
 */

import { Queue, UnrecoverableError, Worker } from "bullmq";

import {
  AUDIT_JOB_NAME,
  AUDIT_QUEUE_NAME,
  auditJobOptions,
  parseAuditJobData,
  type AuditQueue,
  type CancelOutcome,
  type EnqueueResult,
  type QueueHealth,
} from "./contract.js";

export interface RedisConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly db?: number;
  readonly tls?: Record<string, never>;
  /** BullMQ requires `null` on connections that may block (workers), or the client gives up. */
  readonly maxRetriesPerRequest: null;
  readonly enableOfflineQueue: boolean;
}

export function parseRedisUrl(raw: string): RedisConnectionOptions {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("REDIS_URL is not a URL.");
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must start with redis:// or rediss://.");
  }

  const dbText = parsed.pathname.replace(/^\//, "");
  const db = dbText === "" ? undefined : Number(dbText);
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error("REDIS_URL has an invalid database number.");
  }

  const username = parsed.username === "" ? undefined : decodeURIComponent(parsed.username);
  const password = parsed.password === "" ? undefined : decodeURIComponent(parsed.password);

  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 6379 : Number(parsed.port),
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
    ...(db === undefined ? {} : { db }),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** How long a request path may wait on Redis before it gives up and says so. */
export const ENQUEUE_TIMEOUT_MS = 2_000;

export interface BullMqOptions {
  readonly url: string;
  /** Keeps two deployments sharing a Redis instance from reading each other's jobs. */
  readonly prefix?: string;
}

export interface BullMqAuditQueue extends AuditQueue {
  /** Exposed for `GET /health`, which reports Redis separately from the queue itself. */
  ping(): Promise<number>;
}

export function createBullMqAuditQueue(options: BullMqOptions): BullMqAuditQueue {
  const connection = parseRedisUrl(options.url);
  const queue = new Queue(AUDIT_QUEUE_NAME, {
    connection,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  });

  async function liveJob(auditId: string): Promise<"waiting" | "active" | "none"> {
    const job = await queue.getJob(auditId);
    if (job === undefined) return "none";
    const state = await job.getState();
    if (state === "active") return "active";
    if (
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      return "waiting";
    }
    return "none";
  }

  const ping = async (): Promise<number> => {
    const started = Date.now();
    // A real round trip, not a cached connection flag: `getJobCounts` fails if Redis is gone,
    // and it is a command this queue already uses rather than a probe only health relies on.
    await withTimeout(queue.getJobCounts(), 1_000, "redis health check");
    return Date.now() - started;
  };

  return {
    async enqueue(auditId: string): Promise<EnqueueResult> {
      // Bounded on purpose. ioredis buffers commands while it reconnects, so a dead Redis would
      // otherwise hold an HTTP request open indefinitely. Timing out here makes the API answer
      // 503 and delete the row it just created, which is the truthful outcome.
      return withTimeout(
        (async () => {
          // `add` with an existing job id is a no-op in BullMQ, but it cannot report that;
          // asking first is what lets the API answer 200 (already queued) instead of a second 201.
          if ((await liveJob(auditId)) !== "none") return { jobId: auditId, duplicate: true };
          await queue.add(AUDIT_JOB_NAME, { auditId }, auditJobOptions(auditId));
          return { jobId: auditId, duplicate: false };
        })(),
        ENQUEUE_TIMEOUT_MS,
        "redis enqueue",
      );
    },

    async cancel(auditId: string): Promise<CancelOutcome> {
      return withTimeout(
        (async (): Promise<CancelOutcome> => {
          const state = await liveJob(auditId);
          if (state === "none") return "not-queued";
          if (state === "active") return "running";
          const job = await queue.getJob(auditId);
          if (job === undefined) return "not-queued";
          try {
            await job.remove();
            return "removed";
          } catch {
            // The worker locked it between the state check and the removal.
            return "running";
          }
        })(),
        ENQUEUE_TIMEOUT_MS,
        "redis cancel",
      );
    },

    ping,

    async health(): Promise<QueueHealth> {
      try {
        const latencyMs = await ping();
        return { status: "ok", provider: "bullmq", latencyMs, detail: null };
      } catch (error) {
        return {
          status: "unavailable",
          provider: "bullmq",
          latencyMs: null,
          detail: error instanceof Error ? error.message.slice(0, 120) : "redis unavailable",
        };
      }
    },

    async close(): Promise<void> {
      await queue.close();
    },
  };
}

export interface AuditWorkerJob {
  readonly auditId: string;
  /** 1 on the first run, 2 after the first retry. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface AuditWorkerOptions extends BullMqOptions {
  readonly concurrency: number;
  /** Must throw to request a retry; must resolve to tell BullMQ the job is done with. */
  readonly handle: (job: AuditWorkerJob) => Promise<void>;
  readonly onError?: (job: AuditWorkerJob, error: Error) => void;
}

export function createBullMqAuditWorker(options: AuditWorkerOptions): Worker {
  const connection = parseRedisUrl(options.url);

  return new Worker(
    AUDIT_QUEUE_NAME,
    async (job) => {
      const data = parseAuditJobData(job.data);
      if (data === null) {
        // A job we cannot read will never become readable. Retrying it three times would only
        // delay the failure and write the same log line thrice.
        throw new UnrecoverableError("job payload is not a valid audit job");
      }
      const described: AuditWorkerJob = {
        auditId: data.auditId,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      };
      try {
        await options.handle(described);
      } catch (error) {
        options.onError?.(described, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
    {
      connection,
      concurrency: options.concurrency,
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    },
  );
}
