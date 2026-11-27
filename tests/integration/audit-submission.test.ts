/**
 * Audit submission, listing, polling and cancellation, over real HTTP.
 *
 * The token verifier is the production one (real HS256 signatures). The data layer is an
 * in-memory `UserData` that applies the same ownership and ordering rules as the RLS policies,
 * and the queue is `MemoryAuditQueue`. Real PostgreSQL is covered by `rls.test.ts`; a real Redis
 * is not available in this environment, which is why the queue here is in-process and why the
 * BullMQ adapter has its own opt-in test.
 */

import { createTokenVerifier } from "../../apps/api/src/auth/token.js";
import { createApp } from "../../apps/api/src/app.js";
import type { AuditLimits } from "../../apps/api/src/limits.js";
import type { AuditQueue } from "@siteaudit/queue";
import { MemoryAuditQueue } from "@siteaudit/queue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAuditJob } from "../../apps/worker/src/run-audit.js";
import { InMemoryUserData } from "../support/audit-store.js";
import { startServer, type TestServer } from "../support/http.js";
import { ALICE, BOB, TEST_SECRET, bearer, signTestToken } from "../support/tokens.js";
import { InMemoryWorkerData } from "../support/worker-data.js";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const now = () => NOW;

interface Envelope<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Array<{ path: string; reason: string }> };
}

interface AuditBody {
  id: string;
  url: string;
  host: string;
  status: string;
  stage: string | null;
  maxPages: number;
  clientName: string | null;
  projectName: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
}

let store: InMemoryUserData;
let queue: MemoryAuditQueue;
let server: TestServer;
let aliceToken: string;

const json = async <T>(response: Response): Promise<Envelope<T>> => (await response.json()) as Envelope<T>;

async function boot(
  options: { queue?: AuditQueue | null; limits?: Partial<AuditLimits> } = {},
): Promise<void> {
  store = new InMemoryUserData(now);
  store.addProfile(ALICE, "Alice");
  store.addProfile(BOB, "Bob");
  queue = new MemoryAuditQueue();

  const app = createApp({
    auth: {
      verifyToken: createTokenVerifier({ key: TEST_SECRET, algorithms: ["HS256"] }),
      createUserData: () => store,
    },
    queue: options.queue === undefined ? queue : options.queue,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    now,
  });

  server = await startServer(app);
  aliceToken = await signTestToken(ALICE);
}

const submit = (body: unknown, token: string = aliceToken): Promise<Response> =>
  fetch(`${server.url}/api/v1/audits`, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(token) },
    body: JSON.stringify(body),
  });

const get = (path: string, token: string = aliceToken): Promise<Response> =>
  fetch(`${server.url}/api/v1/audits${path}`, { headers: bearer(token) });

const del = (path: string, token: string = aliceToken): Promise<Response> =>
  fetch(`${server.url}/api/v1/audits${path}`, { method: "DELETE", headers: bearer(token) });

beforeEach(async () => {
  await boot();
});

afterEach(async () => {
  await server.close();
});

describe("POST /audits", () => {
  it("persists a queued audit, enqueues exactly one job and returns promptly", async () => {
    const response = await submit({
      url: "https://example.com/pricing",
      clientName: "Acme",
      projectName: "Q4 refresh",
      scanScope: { maxPages: 5 },
    });
    const body = await json<AuditBody>(response);

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.meta).toMatchObject({ queued: true });
    expect(body.data).toMatchObject({
      url: "https://example.com/pricing",
      host: "example.com",
      status: "queued",
      stage: null,
      maxPages: 5,
      clientName: "Acme",
      projectName: "Q4 refresh",
      error: null,
    });
    expect(response.headers.get("location")).toBe(`/api/v1/audits/${body.data?.id ?? ""}`);

    // The row exists, owned by the caller, and the job names it.
    const rows = store.rowsFor(ALICE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(body.data?.id);
    expect(queue.snapshot().waiting).toEqual([body.data?.id]);
  });

  it("caps pages at the deployment limit, whatever the client asks for", async () => {
    await boot({ limits: { maxPages: 5 } });
    const response = await submit({ url: "https://example.com", scanScope: { maxPages: 20 } });
    const body = await json<AuditBody>(response);
    expect(body.data?.maxPages).toBe(5);
    expect(store.rowsFor(ALICE)[0]?.max_pages).toBe(5);
  });

  it("rejects an unsafe address before anything is stored", async () => {
    const response = await submit({ url: "http://127.0.0.1/admin" });
    const body = await json(response);
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("validation_failed");
    expect(body.error?.details?.[0]?.path).toBe("url");
    expect(store.audits.size).toBe(0);
    expect(queue.calls).toHaveLength(0);
  });

  it("requires a token", async () => {
    const response = await fetch(`${server.url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(response.status).toBe(401);
    expect(store.audits.size).toBe(0);
  });

  it("answers a double submission with the audit that already exists", async () => {
    const first = await json<AuditBody>(await submit({ url: "https://example.com" }));
    const second = await submit({ url: "https://example.com" });

    expect(second.status).toBe(200);
    const body = await json<AuditBody>(second);
    expect(body.meta).toMatchObject({ duplicate: true });
    expect(body.data?.id).toBe(first.data?.id);
    expect(store.rowsFor(ALICE)).toHaveLength(1);
    expect(queue.calls).toHaveLength(1);
  });

  it("refuses over the usage limit without creating a row", async () => {
    await boot({ limits: { dailyLimit: 1 } });
    store.seedAudit({ userId: ALICE, url: "https://earlier.example", status: "completed" });

    const response = await submit({ url: "https://example.com" });
    const body = await json(response);

    expect(response.status).toBe(429);
    expect(body.error?.code).toBe("limit_exceeded");
    expect(body.error?.message).toContain("1 audits");
    expect(store.rowsFor(ALICE)).toHaveLength(1);
  });

  it("deletes the row when the queue refuses the job, rather than leaving it queued", async () => {
    queue.setAvailable(false);

    const response = await submit({ url: "https://example.com" });
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body.error?.code).toBe("service_unavailable");
    expect(store.audits.size).toBe(0);
  });

  it("refuses honestly when this deployment has no queue at all", async () => {
    await boot({ queue: null });

    const response = await submit({ url: "https://example.com" });
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body.error?.code).toBe("service_unavailable");
    expect(store.audits.size).toBe(0);
  });
});

describe("GET /audits", () => {
  it("lists only the caller's audits, newest first, with pagination metadata", async () => {
    store.seedAudit({ userId: ALICE, url: "https://one.example", createdAt: "2026-11-27T09:00:00.000Z" });
    store.seedAudit({ userId: ALICE, url: "https://two.example", createdAt: "2026-11-27T10:00:00.000Z" });
    store.seedAudit({ userId: ALICE, url: "https://three.example", createdAt: "2026-11-27T11:00:00.000Z" });
    store.seedAudit({ userId: BOB, url: "https://bob.example" });

    const response = await get("?page=1&limit=2");
    const body = await json<AuditBody[]>(response);

    expect(response.status).toBe(200);
    expect(body.data?.map((row) => row.url)).toEqual(["https://three.example", "https://two.example"]);
    expect(body.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2, hasMore: true });
  });

  it("filters by status and searches address, host and labels", async () => {
    store.seedAudit({
      userId: ALICE,
      url: "https://acme.example/pricing",
      status: "completed",
      clientName: "Acme",
    });
    store.seedAudit({ userId: ALICE, url: "https://other.example/blog", status: "queued" });

    const queued = await json<AuditBody[]>(await get("?status=queued"));
    expect(queued.data).toHaveLength(1);
    expect(queued.data?.[0]?.status).toBe("queued");

    const searched = await json<AuditBody[]>(await get("?search=acme"));
    expect(searched.data).toHaveLength(1);
    expect(searched.data?.[0]?.url).toBe("https://acme.example/pricing");
  });

  it("rejects a page size beyond the maximum instead of obeying it", async () => {
    const response = await get("?limit=5000");
    const body = await json(response);
    expect(response.status).toBe(400);
    expect(body.error?.details?.[0]?.path).toBe("limit");
  });
});

describe("GET /audits/:id", () => {
  it("returns the caller's audit and is never cached", async () => {
    const seeded = store.seedAudit({
      userId: ALICE,
      url: "https://example.com",
      status: "running",
      stage: "crawling",
    });
    const response = await get(`/${seeded.id}`);
    const body = await json<AuditBody>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toMatchObject({ id: seeded.id, status: "running", stage: "crawling" });
  });

  it("answers the same 404 for someone else's audit and for an id that does not exist", async () => {
    const seeded = store.seedAudit({ userId: BOB, url: "https://bob.example" });

    const foreign = await get(`/${seeded.id}`);
    const missing = await get("/99999999-9999-4999-8999-999999999999");

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await json(foreign)).toEqual(await json(missing));
  });

  it("never returns a stored error message", async () => {
    const seeded = store.seedAudit({
      userId: ALICE,
      url: "https://example.com",
      status: "failed",
      errorCode: "internal_error",
    });
    store.audits.set(seeded.id, {
      ...seeded,
      error_message: "connect ECONNREFUSED 10.0.0.7:5432",
    });

    const body = await json<AuditBody>(await get(`/${seeded.id}`));
    expect(body.data?.error?.code).toBe("internal_error");
    expect(body.data?.error?.message).not.toContain("ECONNREFUSED");
    expect(body.data?.error?.message).not.toContain("10.0.0.7");
  });
});

describe("DELETE /audits/:id", () => {
  it("cancels a queued audit and removes its job", async () => {
    const seeded = store.seedAudit({ userId: ALICE, url: "https://example.com" });
    await queue.enqueue(seeded.id);

    const response = await del(`/${seeded.id}`);

    expect(response.status).toBe(204);
    expect(store.audits.has(seeded.id)).toBe(false);
    expect(queue.snapshot().waiting).toHaveLength(0);
  });

  it("refuses to cancel an audit that has started", async () => {
    const seeded = store.seedAudit({
      userId: ALICE,
      url: "https://example.com",
      status: "running",
      stage: "crawling",
    });
    const response = await del(`/${seeded.id}`);
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("audit_not_cancellable");
    expect(store.audits.has(seeded.id)).toBe(true);
  });

  it("refuses when the worker already holds the job, even if the row still says queued", async () => {
    const seeded = store.seedAudit({ userId: ALICE, url: "https://example.com" });
    await queue.enqueue(seeded.id);
    expect(queue.take()).toBe(seeded.id);

    const response = await del(`/${seeded.id}`);
    expect(response.status).toBe(409);
    expect(store.audits.has(seeded.id)).toBe(true);
  });

  it("answers 404 for another tenant's audit and deletes nothing", async () => {
    const seeded = store.seedAudit({ userId: BOB, url: "https://bob.example" });
    const response = await del(`/${seeded.id}`);

    expect(response.status).toBe(404);
    expect(store.audits.has(seeded.id)).toBe(true);
  });
});

describe("GET /health", () => {
  it("reports the queue as ok when Redis would answer", async () => {
    const response = await fetch(`${server.url}/health`);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ status: "ok", checks: { auth: "ready", queue: "ok" } });
  });

  it("reports 503 when the queue is down, because submissions cannot work", async () => {
    queue.setAvailable(false);
    const response = await fetch(`${server.url}/health`);
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body.data).toMatchObject({ status: "degraded", checks: { queue: "unavailable" } });
  });
});

describe("submission to outcome", () => {
  it("carries a submitted audit from queued to a truthful failure", async () => {
    const submitted = await json<AuditBody>(await submit({ url: "https://example.com" }));
    const auditId = submitted.data?.id ?? "";

    // What a worker does with the job the API just enqueued.
    const workerData = new InMemoryWorkerData(store);
    const result = await runAuditJob(
      { auditId, attempt: 1 },
      {
        data: workerData,
        resolveTarget: async (url) => ({
          url: new URL(url),
          addresses: [{ address: "93.184.216.34", family: 4 }],
        }),
        steps: [],
        timeoutMs: 1_000,
        maxAttempts: 3,
      },
    );
    queue.finish(auditId);

    expect(result).toEqual({ outcome: "done", status: "failed" });

    const body = await json<AuditBody>(await get(`/${auditId}`));
    expect(body.data?.status).toBe("failed");
    expect(body.data?.stage).toBe("validating");
    expect(body.data?.error?.code).toBe("scanner_not_ready");
    expect(body.data?.error?.message).toContain("cannot scan websites yet");
    // The meter was written by the worker, which is the process that holds the service role.
    expect(workerData.usage).toEqual([{ userId: ALICE, auditId, kind: "audit", quantity: 1 }]);
  });
});
