/**
 * The BullMQ adapter against a real Redis.
 *
 * This suite is **opt-in**: it runs only when `REDIS_TEST_URL` points at a Redis the test may
 * write to. The sandbox this was written in has no Redis and no Docker, and a fake would only
 * test the fake — so the honest position is a suite that says "skipped" until someone runs it
 * somewhere real:
 *
 *     REDIS_TEST_URL=redis://localhost:6379/15 npm run test
 *
 * `docker compose up -d redis` in the repository root provides exactly that.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBullMqAuditQueue, type BullMqAuditQueue } from "@siteaudit/queue";

const REDIS_URL = process.env["REDIS_TEST_URL"];
const PREFIX = `siteaudit-test-${Date.now()}`;

describe.skipIf(REDIS_URL === undefined)("BullMQ adapter", () => {
  let queue: BullMqAuditQueue;

  beforeAll(() => {
    queue = createBullMqAuditQueue({ url: REDIS_URL ?? "", prefix: PREFIX });
  });

  afterAll(async () => {
    await queue.close();
  });

  it("answers a health check", async () => {
    expect(await queue.health()).toMatchObject({ status: "ok", provider: "bullmq" });
  });

  it("enqueues once per audit and cancels a waiting job", async () => {
    const auditId = crypto.randomUUID();

    expect(await queue.enqueue(auditId)).toEqual({ jobId: auditId, duplicate: false });
    expect(await queue.enqueue(auditId)).toEqual({ jobId: auditId, duplicate: true });
    expect(await queue.cancel(auditId)).toBe("removed");
    expect(await queue.cancel(auditId)).toBe("not-queued");
  });
});
