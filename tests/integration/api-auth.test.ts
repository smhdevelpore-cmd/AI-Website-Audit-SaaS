/**
 * The API's auth and ownership behaviour, over real HTTP.
 *
 * The token verifier is the production one (real HS256 signatures). The data layer is a fake
 * that implements `UserData`, so these tests are about what the API decides — who may read
 * which row, which status a refusal gets, what a response is allowed to contain — and the
 * database side is covered by tests/integration/rls.test.ts.
 */

import { once } from "node:events";
import type { Server } from "node:http";

import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../apps/api/src/app.js";
import { createTokenVerifier } from "../../apps/api/src/auth/token.js";
import type {
  AuditRow,
  ProfilePatch,
  ProfileRow,
  UserData,
  UserDataFactory,
} from "../../apps/api/src/data/types.js";

const SECRET = new TextEncoder().encode("a-test-secret-long-enough-for-hs256-signing");
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const ALICE_AUDIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB_AUDIT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const AUDIT_BASE: Omit<AuditRow, "id" | "user_id" | "url" | "host"> = {
  client_name: null,
  project_name: null,
  status: "completed",
  stage: null,
  max_pages: 25,
  pages_scanned: 7,
  was_partial: false,
  scoring_version: "1.0.0",
  overall_score: null,
  category_scores: null,
  error_code: null,
  error_message: null,
  ai_status: "skipped",
  ai_model: null,
  ai_summary: null,
  started_at: "2026-11-27T10:00:00.000Z",
  completed_at: "2026-11-27T10:01:00.000Z",
  created_at: "2026-11-27T09:59:00.000Z",
  updated_at: "2026-11-27T10:01:00.000Z",
};

function profileRow(id: string, name: string): ProfileRow {
  return {
    id,
    name,
    agency_name: null,
    website: null,
    timezone: null,
    logo_url: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  };
}

function auditRow(id: string, userId: string, url: string): AuditRow {
  return { ...AUDIT_BASE, id, user_id: userId, url, host: new URL(url).host };
}

/** Records what the routes asked for, so a test can assert on the request and not just the reply. */
class FakeData implements UserData {
  readonly profiles = new Map<string, ProfileRow>([
    [ALICE, profileRow(ALICE, "Alice")],
    [BOB, profileRow(BOB, "Bob")],
  ]);

  readonly audits = new Map<string, AuditRow>([
    [ALICE_AUDIT, auditRow(ALICE_AUDIT, ALICE, "https://alice.example")],
    [BOB_AUDIT, auditRow(BOB_AUDIT, BOB, "https://bob.example")],
  ]);

  readonly patches: Array<{ userId: string; patch: ProfilePatch }> = [];
  readonly auditLookups: string[] = [];

  async findProfile(userId: string): Promise<ProfileRow | null> {
    return this.profiles.get(userId) ?? null;
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow | null> {
    this.patches.push({ userId, patch });
    const current = this.profiles.get(userId);
    if (current === undefined) return null;
    const updated = { ...current, ...patch, updated_at: "2026-11-27T12:00:00.000Z" };
    this.profiles.set(userId, updated);
    return updated;
  }

  async findAudit(auditId: string): Promise<AuditRow | null> {
    this.auditLookups.push(auditId);
    return this.audits.get(auditId) ?? null;
  }

  // The write path is exercised in tests/integration/audit-submission.test.ts; this suite is
  // about reads and refusals, so these only need to exist.
  async createAudit(): Promise<AuditRow> {
    throw new Error("not used in this suite");
  }

  async listAudits(): Promise<{ rows: AuditRow[]; total: number }> {
    throw new Error("not used in this suite");
  }

  async listFindings(): Promise<readonly []> {
    return [];
  }

  async listPageSummaries(): Promise<readonly []> {
    return [];
  }

  async countAuditsSince(): Promise<number> {
    throw new Error("not used in this suite");
  }

  async findActiveAudit(): Promise<AuditRow | null> {
    throw new Error("not used in this suite");
  }

  async deleteAudit(): Promise<boolean> {
    throw new Error("not used in this suite");
  }
}

const fake = new FakeData();
const tokensSeen: string[] = [];

const createUserData: UserDataFactory = (accessToken) => {
  tokensSeen.push(accessToken);
  return fake;
};

async function signFor(userId: string, options: { expiresInSeconds?: number } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: userId, role: "authenticated", email: `${userId.slice(0, 4)}@example.com` })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300))
    .sign(SECRET);
}

/** `Response.json()` is typed `unknown` under the Node types; this is the envelope we expect. */
interface JsonBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Array<{ path: string; reason: string; message: string }>;
  };
}

const readJson = async (response: Response): Promise<JsonBody> => (await response.json()) as JsonBody;

let server: Server;
let baseUrl: string;
let aliceToken: string;
let bobToken: string;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

beforeAll(async () => {
  const app = createApp({
    auth: { verifyToken: createTokenVerifier({ key: SECRET, algorithms: ["HS256"] }), createUserData },
  });
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  aliceToken = await signFor(ALICE);
  bobToken = await signFor(BOB);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

describe("requests without a usable token", () => {
  it("answers 401 for a missing Authorization header", async () => {
    const response = await call("/api/v1/profile");
    expect(response.status).toBe(401);
    const body = await readJson(response);
    expect(body).toMatchObject({
      success: false,
      error: { code: "unauthenticated", message: "Sign in to continue." },
    });
  });

  it("answers 401 for a malformed header, a wrong scheme and a forged token", async () => {
    for (const header of ["", "Bearer", "Basic dXNlcjpwdw==", "Bearer not-a-jwt", `Bearer ${aliceToken}x`]) {
      const response = await call("/api/v1/profile", { headers: { authorization: header } });
      expect(response.status, header).toBe(401);
      expect((await readJson(response)).error?.code).toBe("unauthenticated");
    }
  });

  it("answers 401 for an expired token", async () => {
    const expired = await signFor(ALICE, { expiresInSeconds: -120 });
    const response = await call("/api/v1/me", { headers: { authorization: `Bearer ${expired}` } });
    expect(response.status).toBe(401);
    expect((await readJson(response)).error?.message).toMatch(/expired/i);
  });
});

describe("the authenticated caller", () => {
  it("reports who the token belongs to, not who the client claims to be", async () => {
    const response = await call("/api/v1/me", { headers: { authorization: `Bearer ${aliceToken}` } });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data?.["id"]).toBe(ALICE);
    expect(body.data?.["email"]).toBe("1111@example.com");
  });

  it("passes the caller's own token to the data layer", async () => {
    tokensSeen.length = 0;
    await call("/api/v1/me", { headers: { authorization: `Bearer ${bobToken}` } });
    expect(tokensSeen).toEqual([bobToken]);
  });
});

describe("profile", () => {
  it("returns the caller's profile in camelCase without internal columns", async () => {
    const response = await call("/api/v1/profile", { headers: { authorization: `Bearer ${aliceToken}` } });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data).toEqual({
      id: ALICE,
      name: "Alice",
      agencyName: null,
      website: null,
      timezone: null,
      logoUrl: null,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("agency_name");
  });

  it("updates only the caller's row, mapping the contract's field names to columns", async () => {
    fake.patches.length = 0;
    const response = await call("/api/v1/profile", {
      method: "PATCH",
      headers: { authorization: `Bearer ${aliceToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice Studio", agencyName: "Studio", timezone: "Europe/Berlin" }),
    });
    expect(response.status).toBe(200);
    expect(fake.patches).toEqual([
      { userId: ALICE, patch: { name: "Alice Studio", agency_name: "Studio", timezone: "Europe/Berlin" } },
    ]);
    expect((await readJson(response)).data?.["name"]).toBe("Alice Studio");
  });

  it("drops fields the contract does not have, including a forged id", async () => {
    fake.patches.length = 0;
    const response = await call("/api/v1/profile", {
      method: "PATCH",
      headers: { authorization: `Bearer ${aliceToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice", id: BOB, created_at: "1999-01-01", updated_at: "1999-01-01" }),
    });
    expect(response.status).toBe(200);
    expect(fake.patches[0]).toEqual({ userId: ALICE, patch: { name: "Alice" } });
  });

  it("rejects an invalid body with a field path", async () => {
    const response = await call("/api/v1/profile", {
      method: "PATCH",
      headers: { authorization: `Bearer ${aliceToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(body.error?.code).toBe("validation_failed");
    expect(body.error?.details?.[0]?.path).toBe("name");
  });

  it("answers 404 when the profile row is missing", async () => {
    const stranger = "33333333-3333-4333-8333-333333333333";
    const token = await signFor(stranger);
    const response = await call("/api/v1/profile", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(404);
    expect((await readJson(response)).error?.code).toBe("not_found");
  });
});

describe("audit ownership", () => {
  it("returns an audit the caller owns", async () => {
    const response = await call(`/api/v1/audits/${ALICE_AUDIT}`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data).toMatchObject({ id: ALICE_AUDIT, url: "https://alice.example", status: "completed" });
    expect(JSON.stringify(body)).not.toContain("user_id");
  });

  it("answers 404 — not 403 — for someone else's audit, exactly like an unknown id", async () => {
    const other = await call(`/api/v1/audits/${BOB_AUDIT}`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const missing = await call(`/api/v1/audits/99999999-9999-4999-8999-999999999999`, {
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    // Byte-identical: a difference here would tell an attacker which ids exist.
    expect(await other.text()).toBe(await missing.text());
  });

  it("refuses a row the database should not have returned (defence in depth)", async () => {
    // Simulates an RLS policy that leaked: the row exists but belongs to someone else.
    fake.audits.set(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      auditRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", BOB, "https://bob.example/x"),
    );
    const response = await call("/api/v1/audits/cccccccc-cccc-4ccc-8ccc-cccccccccccc", {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(response.status).toBe(404);
    expect((await readJson(response)).error?.code).toBe("not_found");
  });

  it("does not ask the database about a malformed id", async () => {
    fake.auditLookups.length = 0;
    const response = await call("/api/v1/audits/not-a-uuid", {
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(response.status).toBe(404);
    expect(fake.auditLookups).toEqual([]);
  });

  it("requires a token before any lookup happens", async () => {
    fake.auditLookups.length = 0;
    const response = await call(`/api/v1/audits/${ALICE_AUDIT}`);
    expect(response.status).toBe(401);
    expect(fake.auditLookups).toEqual([]);
  });
});

describe("when Supabase is not configured", () => {
  let bare: Server;
  let bareUrl: string;

  beforeAll(async () => {
    bare = createApp({ auth: null }).listen(0);
    await once(bare, "listening");
    const address = bare.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    bareUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      bare.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });

  it("says so instead of pretending to check a token", async () => {
    const response = await fetch(`${bareUrl}/api/v1/profile`, {
      headers: { authorization: `Bearer ${await signFor(ALICE)}` },
    });
    expect(response.status).toBe(503);
    expect((await readJson(response)).error?.code).toBe("service_unavailable");
  });

  it("still serves health and the contract probe", async () => {
    const health = await fetch(`${bareUrl}/health`);
    expect((await readJson(health)).data).toMatchObject({
      status: "degraded",
      checks: { auth: "absent", queue: "absent" },
    });

    const probe = await fetch(`${bareUrl}/api/v1/audits/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(probe.status).toBe(200);
    expect((await readJson(probe)).data?.["queued"]).toBe(false);
  });

  it("does not leak the framework name", async () => {
    const response = await fetch(`${bareUrl}/health`);
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});
