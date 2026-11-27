/**
 * API process bootstrap: configuration in, listening socket out.
 *
 * The application itself is built by `createApp` from `app.ts`, which takes its dependencies as
 * arguments. This file is the only place that reads the environment, constructs the real
 * Supabase-backed auth context and connects to Redis.
 *
 * A missing `REDIS_URL` is not fatal: the API still serves health, profile and audit reads, and
 * answers submissions with 503. Pretending to queue a job would be worse than saying no.
 */
import { createBullMqAuditQueue, type AuditQueue } from "@siteaudit/queue";

import { createApp } from "./app.js";
import { buildAuthContext } from "./auth/context.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const auth = buildAuthContext(config);

let queue: AuditQueue | null = null;
if (config.REDIS_URL !== undefined) {
  queue = createBullMqAuditQueue({ url: config.REDIS_URL });
}

const app = createApp({
  auth,
  queue,
  limits: { maxPages: config.AUDIT_MAX_PAGES, dailyLimit: config.AUDIT_DAILY_LIMIT },
});

const server = app.listen(config.PORT, () => {
  console.log(
    `[api] listening on ${config.PORT} (${config.NODE_ENV}, auth ${auth === null ? "not configured" : "ready"}, ` +
      `queue ${queue === null ? "not configured" : "bullmq"})`,
  );
});

/** Finish in-flight requests, then let Redis close: a hard exit can drop a job mid-add. */
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} received, shutting down`);
  server.close();
  if (queue !== null) await queue.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
