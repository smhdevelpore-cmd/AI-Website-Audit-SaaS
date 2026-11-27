/**
 * The browser side's testable core: redirect handling, error translation and the API client.
 * The React screens themselves are not rendered here — there is no DOM harness in this project
 * yet, and pretending otherwise would be a test that asserts its own mock.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  describeAuthError,
  describePasswordProblem,
  redirectAfterSignIn,
} from "../../apps/web/src/auth/session.js";
import { ApiError, apiRequest } from "../../apps/web/src/lib/api.js";

describe("redirectAfterSignIn", () => {
  it("keeps a same-origin path the user was trying to reach", () => {
    expect(redirectAfterSignIn("/dashboard")).toBe("/dashboard");
    expect(redirectAfterSignIn("/audits/123?tab=findings")).toBe("/audits/123?tab=findings");
  });

  it("refuses anything that would leave this site", () => {
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "javascript:alert(1)",
      "dashboard",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(redirectAfterSignIn(hostile), String(hostile)).toBe("/dashboard");
    }
  });

  it("does not bounce back to the sign-in screens", () => {
    expect(redirectAfterSignIn("/login")).toBe("/dashboard");
    expect(redirectAfterSignIn("/signup?next=x")).toBe("/dashboard");
  });
});

describe("describeAuthError", () => {
  it("turns Supabase's wording into something a person can act on", () => {
    expect(describeAuthError("Invalid login credentials")).toMatch(/do not match an account/i);
    expect(describeAuthError("Email not confirmed")).toMatch(/confirm your email/i);
    expect(describeAuthError("User already registered")).toMatch(/already exists/i);
    expect(describeAuthError("Password should be at least 6 characters")).toMatch(/longer password/i);
    expect(describeAuthError("email rate limit exceeded")).toMatch(/too many attempts/i);
    expect(describeAuthError("Failed to fetch")).toMatch(/could not reach/i);
  });

  it("says nothing specific for an unrecognised failure", () => {
    const message = describeAuthError("unexpected_failure from provider");
    expect(message).not.toMatch(/provider/);
    expect(message).toMatch(/did not work/i);
    expect(describeAuthError(null)).toMatch(/did not work/i);
  });
});

describe("describePasswordProblem", () => {
  it("requires the documented minimum length", () => {
    expect(describePasswordProblem("short")).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    expect(describePasswordProblem("long-enough-password")).toBeNull();
  });
});

const envelope = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("apiRequest", () => {
  const firstSeen = <T>(list: T[]): T => {
    const value = list[0];
    if (value === undefined) throw new Error("expected a recorded request");
    return value;
  };

  it("sends the access token and returns the unwrapped data", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers ?? {}) });
      return envelope({ success: true, data: { id: "u1" } });
    }) as typeof globalThis.fetch;

    const result = await apiRequest<{ id: string }>("http://api.test/api/v1", "/me", {
      accessToken: "token-123",
      fetch,
    });

    expect(result.data).toEqual({ id: "u1" });
    expect(firstSeen(seen).url).toBe("http://api.test/api/v1/me");
    expect(firstSeen(seen).headers.get("authorization")).toBe("Bearer token-123");
  });

  it("does not send an Authorization header when there is no token", async () => {
    const seen: Headers[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers ?? {}));
      return envelope({ success: true, data: null });
    }) as typeof globalThis.fetch;

    await apiRequest("http://api.test/api/v1", "/me", { accessToken: null, fetch });
    expect(firstSeen(seen).get("authorization")).toBeNull();
  });

  it("raises the API's own error code, not a generic failure", async () => {
    const fetch = (async () =>
      envelope(
        { success: false, error: { code: "unauthenticated", message: "Sign in to continue." } },
        401,
      )) as typeof globalThis.fetch;

    await expect(apiRequest("http://api.test", "/me", { fetch })).rejects.toMatchObject({
      name: "ApiError",
      code: "unauthenticated",
      message: "Sign in to continue.",
    });
  });

  it("keeps field-level details for a form to highlight", async () => {
    const fetch = (async () =>
      envelope(
        {
          success: false,
          error: {
            code: "validation_failed",
            message: "Some values in the request are not valid.",
            details: [{ path: "name", reason: "too_small", message: "Name is required." }],
          },
        },
        400,
      )) as typeof globalThis.fetch;

    try {
      await apiRequest("http://api.test", "/profile", { fetch });
      throw new Error("expected a failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).details[0]).toMatchObject({ path: "name" });
    }
  });

  it("reports an unreachable server as a network error", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;

    await expect(apiRequest("http://api.test", "/me", { fetch })).rejects.toMatchObject({
      code: "network_error",
    });
  });

  it("refuses a response that is not one of the two envelopes", async () => {
    const fetch = (async () =>
      new Response("<html>proxy error</html>", { status: 502 })) as typeof globalThis.fetch;
    await expect(apiRequest("http://api.test", "/me", { fetch })).rejects.toMatchObject({
      code: "internal_error",
    });
  });
});
