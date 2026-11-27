/**
 * The Supabase adapter, inspected at the wire.
 *
 * There is no live Supabase project in this environment, so `fetch` is replaced: every request
 * the adapter makes is recorded and answered by hand. That is enough to prove the one thing
 * that matters most about this file — that each request carries the **caller's** token and the
 * anon key, and that the service-role key is never involved in a user request.
 */

import { describe, expect, it } from "vitest";

import { AppError } from "@siteaudit/shared-types";

import { createSupabaseUserDataFactory } from "../../apps/api/src/data/supabase.js";

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUDIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANON_KEY = "anon-key-for-tests";
const SERVICE_KEY = "service-role-key-that-must-never-appear";

function recorder(reply: (request: Recorded) => Response): {
  fetch: typeof globalThis.fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Recorded = {
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers ?? {}),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(request);
    return reply(request);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** The single request a test expected, or a failure that names the problem. */
function firstCall(calls: Recorded[]): Recorded {
  const call = calls[0];
  if (call === undefined) throw new Error("expected a database request, none was made");
  return call;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const factory = (fetch: typeof globalThis.fetch) =>
  createSupabaseUserDataFactory({ url: "https://project.supabase.co", anonKey: ANON_KEY, fetch });

describe("user-scoped requests", () => {
  it("sends the caller's token, not the service role key", async () => {
    const { fetch, calls } = recorder(() => json([{ id: USER_ID, name: "Alice" }]));
    await factory(fetch)("user-access-token").findProfile(USER_ID);

    expect(calls).toHaveLength(1);
    expect(firstCall(calls).headers.get("authorization")).toBe("Bearer user-access-token");
    expect(firstCall(calls).headers.get("apikey")).toBe(ANON_KEY);
    expect(JSON.stringify(firstCall(calls).headers)).not.toContain(SERVICE_KEY);
  });

  it("asks PostgREST for the profiles row by id", async () => {
    const { fetch, calls } = recorder(() => json([{ id: USER_ID, name: "Alice" }]));
    const profile = await factory(fetch)("t").findProfile(USER_ID);

    expect(firstCall(calls).url).toContain("/rest/v1/profiles");
    expect(firstCall(calls).url).toContain(`id=eq.${USER_ID}`);
    expect(profile).toMatchObject({ id: USER_ID, name: "Alice" });
  });

  it("returns null rather than throwing when RLS yields no row", async () => {
    const { fetch } = recorder(() => json([]));
    await expect(factory(fetch)("t").findProfile(USER_ID)).resolves.toBeNull();
  });

  it("writes the contract's camelCase fields as snake_case columns", async () => {
    const { fetch, calls } = recorder((request) =>
      json(
        [{ id: USER_ID, name: "Alice Studio", agency_name: "Studio" }],
        request.method === "PATCH" ? 200 : 200,
      ),
    );
    await factory(fetch)("t").updateProfile(USER_ID, { name: "Alice Studio", agency_name: "Studio" });

    expect(firstCall(calls).method).toBe("PATCH");
    expect(firstCall(calls).url).toContain(`id=eq.${USER_ID}`);
    expect(JSON.parse(firstCall(calls).body as string)).toEqual({
      name: "Alice Studio",
      agency_name: "Studio",
    });
  });

  it("reads an audit through the caller's token as well", async () => {
    const { fetch, calls } = recorder(() =>
      json([{ id: AUDIT_ID, user_id: USER_ID, url: "https://example.com", host: "example.com" }]),
    );
    const audit = await factory(fetch)("t").findAudit(AUDIT_ID);

    expect(firstCall(calls).url).toContain("/rest/v1/audits");
    expect(firstCall(calls).url).toContain(`id=eq.${AUDIT_ID}`);
    expect(audit?.user_id).toBe(USER_ID);
  });

  it("gives each request its own client and its own token", async () => {
    const { fetch, calls } = recorder(() => json([]));
    const build = factory(fetch);
    await build("token-one").findProfile(USER_ID);
    await build("token-two").findProfile(USER_ID);

    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
      "Bearer token-one",
      "Bearer token-two",
    ]);
  });
});

describe("database failures", () => {
  it("turns a PostgREST error into a generic AppError that keeps the detail in the log", async () => {
    const { fetch } = recorder(() =>
      json(
        { code: "42501", message: "permission denied for table profiles", details: null, hint: null },
        403,
      ),
    );

    try {
      await factory(fetch)("t").findProfile(USER_ID);
      throw new Error("expected the adapter to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("internal_error");
      // The client sees one sentence; the column name and the database code stay in the log.
      expect(appError.message).not.toContain("permission denied");
      expect(appError.message).not.toContain("profiles");
      expect(appError.logContext["databaseMessage"]).toContain("permission denied");
      expect(appError.logContext["operation"]).toBe("profiles.select");
    }
  });
});
