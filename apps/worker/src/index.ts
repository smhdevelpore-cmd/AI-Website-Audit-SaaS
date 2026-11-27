/**
 * The audit worker (TRD §6, ARD §10).
 *
 * It refuses to start without a queue and without a database, because a worker that is running
 * while unable to do its job is a green light nobody should trust.
 *
 * What it does with a job: validates the target, crawls a bounded set of pages, runs the
 * deterministic rules, scores the result and stores all three. A page it could not read makes the
 * audit `partial`; a site it could not reach fails it, in words, without inventing a score.
 */

import { AUDIT_JOB_ATTEMPTS, createBullMqAuditWorker } from "@siteaudit/queue";
import { assertSafeTarget } from "@siteaudit/validation";

import { loadConfig } from "./config.js";
import { createSupabaseWorkerData } from "./data.js";
import { createScanSteps } from "./scan-steps.js";
import { createProcessor } from "./processor.js";

const config = loadConfig();

function fatal(message: string): never {
  console.error(`[worker] ${message}`);
  process.exit(1);
}

if (config.REDIS_URL === undefined) fatal("REDIS_URL is not set, so there is no queue to consume.");
if (config.SUPABASE_URL === undefined) fatal("SUPABASE_URL is not set, so there is no database to read.");
if (config.SUPABASE_SERVICE_ROLE_KEY === undefined) {
  fatal("SUPABASE_SERVICE_ROLE_KEY is not set; the worker cannot update audit status.");
}

function log(line: string, context: Record<string, unknown> = {}): void {
  // Structured and short: ids and codes, never a URL's query string or a token.
  console.log(JSON.stringify({ at: new Date().toISOString(), process: "worker", line, ...context }));
}

const data = createSupabaseWorkerData({
  url: config.SUPABASE_URL,
  serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
});

const steps = createScanSteps({ data });

const process_ = createProcessor({
  data,
  resolveTarget: (url) => assertSafeTarget(url),
  steps,
  timeoutMs: config.AUDIT_TIMEOUT_MS,
  maxAttempts: AUDIT_JOB_ATTEMPTS,
  log,
});

const worker = createBullMqAuditWorker({
  url: config.REDIS_URL,
  concurrency: config.AUDIT_CONCURRENCY,
  // Optional everywhere: absent means "use the package's default namespace".
  ...(process.env["QUEUE_PREFIX"] === undefined ? {} : { prefix: process.env["QUEUE_PREFIX"] }),
  onError: (job, error) =>
    log("job attempt failed", { auditId: job.auditId, attempt: job.attempt, error: error.message }),
  handle: async (job) => {
    const result = await process_(job);
    log("job finished", { auditId: job.auditId, attempt: job.attempt, ...result });
  },
});

worker.on("ready", () => log("ready", { concurrency: config.AUDIT_CONCURRENCY, steps: steps.length }));
worker.on("error", (error) => log("worker error", { error: error.message }));

async function shutdown(signal: string): Promise<void> {
  log("shutting down", { signal });
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
