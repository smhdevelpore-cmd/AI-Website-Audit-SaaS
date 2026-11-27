/**
 * The queue contract and the in-memory implementation.
 *
 * The BullMQ adapter is exercised only when a real Redis is reachable (`REDIS_TEST_URL`); see
 * `tests/integration/queue-bullmq.test.ts`. What is testable without one is everything that
 * decides behaviour: job identity, retry policy, and how a connection string is read.
 */

import {
  AUDIT_JOB_ATTEMPTS,
  MemoryAuditQueue,
  auditJobOptions,
  parseAuditJobData,
  parseRedisUrl,
} from "@siteaudit/queue";
import { describe, expect, it } from "vitest";

import { escapeSearchTerm } from "../../apps/api/src/data/supabase.js";

const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

describe("job identity", () => {
  it("names the job after the audit, so a second enqueue cannot duplicate it", () => {
    expect(auditJobOptions(AUDIT_ID).jobId).toBe(AUDIT_ID);
  });

  it("retries three times with exponential backoff and keeps Redis tidy", () => {
    const options = auditJobOptions(AUDIT_ID);
    expect(options.attempts).toBe(AUDIT_JOB_ATTEMPTS);
    expect(options.backoff).toEqual({ type: "exponential", delay: 2_000 });
    expect(options.removeOnComplete.count).toBeGreaterThan(0);
    expect(options.removeOnFail.age).toBeGreaterThan(options.removeOnComplete.age);
  });

  it("accepts only a uuid and rejects a payload that has more than that", () => {
    expect(parseAuditJobData({ auditId: AUDIT_ID })).toEqual({ auditId: AUDIT_ID });
    expect(parseAuditJobData({ auditId: "not-a-uuid" })).toBeNull();
    expect(parseAuditJobData({})).toBeNull();
    expect(parseAuditJobData(null)).toBeNull();
    expect(parseAuditJobData({ auditId: AUDIT_ID, url: "https://example.com" })).toBeNull();
  });
});

describe("REDIS_URL", () => {
  it("reads host, port and database from a plain URL", () => {
    expect(parseRedisUrl("redis://localhost:6379/2")).toMatchObject({
      host: "localhost",
      port: 6379,
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it("defaults the port and carries credentials through", () => {
    expect(parseRedisUrl("redis://user:p%40ss@cache.internal")).toMatchObject({
      host: "cache.internal",
      port: 6379,
      username: "user",
      password: "p@ss",
    });
  });

  it("turns on TLS for rediss://", () => {
    expect(parseRedisUrl("rediss://cache.example:6380")).toMatchObject({ tls: {} });
  });

  it("refuses anything that is not redis", () => {
    expect(() => parseRedisUrl("http://localhost:6379")).toThrow(/redis:\/\//);
    expect(() => parseRedisUrl("not a url")).toThrow(/not a URL/);
    expect(() => parseRedisUrl("redis://localhost:6379/abc")).toThrow(/database/);
  });
});

describe("MemoryAuditQueue", () => {
  it("adds a job once and reports the duplicate", async () => {
    const queue = new MemoryAuditQueue();

    expect(await queue.enqueue(AUDIT_ID)).toEqual({ jobId: AUDIT_ID, duplicate: false });
    expect(await queue.enqueue(AUDIT_ID)).toEqual({ jobId: AUDIT_ID, duplicate: true });
    expect(queue.snapshot().waiting).toEqual([AUDIT_ID]);
  });

  it("removes a waiting job but refuses one a worker holds", async () => {
    const queue = new MemoryAuditQueue();
    await queue.enqueue(AUDIT_ID);

    expect(queue.take()).toBe(AUDIT_ID);
    expect(await queue.cancel(AUDIT_ID)).toBe("running");
    expect(await queue.cancel("11111111-1111-4111-8111-111111111111")).toBe("not-queued");

    queue.finish(AUDIT_ID);
    expect(await queue.cancel(AUDIT_ID)).toBe("not-queued");
  });

  it("reports health, and reports being unavailable as being unavailable", async () => {
    const queue = new MemoryAuditQueue();
    expect(await queue.health()).toMatchObject({ status: "ok", provider: "memory" });

    queue.setAvailable(false);
    expect(await queue.health()).toMatchObject({ status: "unavailable" });
    await expect(queue.enqueue(AUDIT_ID)).rejects.toThrow(/unavailable/);
  });

  it("refuses work after it is closed", async () => {
    const queue = new MemoryAuditQueue();
    await queue.close();
    await expect(queue.enqueue(AUDIT_ID)).rejects.toThrow(/closed/);
    expect((await queue.health()).status).toBe("unavailable");
  });
});

describe("search terms", () => {
  it("strips the characters PostgREST would read as filter syntax", () => {
    // `,` ends an `or=` condition and `(` `)` group them, so a search box must not be able to
    // inject either; `*` `%` `_` would become wildcards. A dot is literal inside a value, and
    // people search for `example.com`, so it survives.
    expect(escapeSearchTerm("acme, or(id.eq.1)")).toBe("acme  or id.eq.1");
    expect(escapeSearchTerm("50%_off*")).toBe("50  off");
    expect(escapeSearchTerm('say "hi" \\ there')).toBe("say  hi    there");
    expect(escapeSearchTerm("  plain  ")).toBe("plain");
  });

  it("bounds the term's length", () => {
    expect(escapeSearchTerm("a".repeat(500))).toHaveLength(200);
  });
});
