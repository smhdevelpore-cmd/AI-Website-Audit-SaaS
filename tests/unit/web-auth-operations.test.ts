/**
 * The sign-up / sign-in / sign-out / reset operations, driven through a recording fake of the
 * Supabase client.
 *
 * What this proves: the arguments each call sends (endpoint shape, metadata, redirect URL), and
 * that a Supabase error never reaches the screen verbatim. What it cannot prove — and does not
 * claim — is that the hosted Auth service behaves as expected; that check needs a real project
 * (docs/SUPABASE.md §6).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createAuthOperations, resetRedirectUrl } from "../../apps/web/src/auth/operations.js";

interface Call {
  method: string;
  args: unknown[];
}

interface FakeOptions {
  /** Message to fail with, or `null` for success. */
  failWith?: string | null;
  /** Whether signUp returns a session (email confirmation off) or not. */
  sessionOnSignUp?: boolean;
}

function fakeClient(options: FakeOptions = {}): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const error = options.failWith == null ? null : { message: options.failWith };

  const record = (method: string, result: unknown) => {
    return async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  };

  const auth = {
    signInWithPassword: record("signInWithPassword", { data: { session: null }, error }),
    signUp: record("signUp", {
      data: {
        user: { id: "u1" },
        session: (options.sessionOnSignUp ?? false) ? { access_token: "t" } : null,
      },
      error,
    }),
    signOut: record("signOut", { error }),
    resetPasswordForEmail: record("resetPasswordForEmail", { data: {}, error }),
    updateUser: record("updateUser", { data: { user: {} }, error }),
  };

  return { client: { auth } as unknown as SupabaseClient, calls };
}

const ORIGIN = "https://app.example";

describe("signing in", () => {
  it("sends the credentials Supabase expects", async () => {
    const { client, calls } = fakeClient();
    await createAuthOperations(client, ORIGIN).signIn("a@example.com", "secret-password");

    expect(calls).toEqual([
      { method: "signInWithPassword", args: [{ email: "a@example.com", password: "secret-password" }] },
    ]);
  });

  it("replaces Supabase's wording with something a user can act on", async () => {
    const { client } = fakeClient({ failWith: "Invalid login credentials" });
    await expect(createAuthOperations(client, ORIGIN).signIn("a@example.com", "wrong")).rejects.toThrow(
      /do not match an account/i,
    );
  });
});

describe("signing up", () => {
  it("passes the name as user metadata, which the database trigger reads", async () => {
    const { client, calls } = fakeClient({ sessionOnSignUp: true });
    await createAuthOperations(client, ORIGIN).signUp("a@example.com", "secret-password", "Alice Agency");

    expect(calls[0]?.method).toBe("signUp");
    expect(calls[0]?.args[0]).toEqual({
      email: "a@example.com",
      password: "secret-password",
      options: { data: { name: "Alice Agency" } },
    });
  });

  it("reports that a confirmation email is needed when no session comes back", async () => {
    const { client } = fakeClient({ sessionOnSignUp: false });
    await expect(
      createAuthOperations(client, ORIGIN).signUp("a@example.com", "password1", "A"),
    ).resolves.toEqual({
      needsConfirmation: true,
    });

    const confirmed = fakeClient({ sessionOnSignUp: true });
    await expect(
      createAuthOperations(confirmed.client, ORIGIN).signUp("a@example.com", "password1", "A"),
    ).resolves.toEqual({
      needsConfirmation: false,
    });
  });

  it("reports a duplicate address without repeating the raw provider message", async () => {
    const { client } = fakeClient({ failWith: "User already registered" });
    await expect(
      createAuthOperations(client, ORIGIN).signUp("a@example.com", "password1", "A"),
    ).rejects.toThrow(/already exists/i);
  });
});

describe("password recovery", () => {
  it("sends the reset link back to this site's reset page", async () => {
    const { client, calls } = fakeClient();
    await createAuthOperations(client, ORIGIN).requestPasswordReset("a@example.com");

    expect(calls[0]).toEqual({
      method: "resetPasswordForEmail",
      args: ["a@example.com", { redirectTo: "https://app.example/reset-password" }],
    });
  });

  it("normalises a trailing slash on the origin", () => {
    expect(resetRedirectUrl("https://app.example/")).toBe("https://app.example/reset-password");
    expect(resetRedirectUrl("http://localhost:5173")).toBe("http://localhost:5173/reset-password");
  });

  it("sets the new password and signs out afterwards", async () => {
    const { client, calls } = fakeClient();
    await createAuthOperations(client, ORIGIN).updatePassword("a-new-password");
    await createAuthOperations(client, ORIGIN).signOut();

    expect(calls.map((call) => call.method)).toEqual(["updateUser", "signOut"]);
    expect(calls[0]?.args[0]).toEqual({ password: "a-new-password" });
  });

  it("refuses a weak password in Supabase's own words, translated", async () => {
    const { client } = fakeClient({ failWith: "Password should be at least 6 characters" });
    await expect(createAuthOperations(client, ORIGIN).updatePassword("123")).rejects.toThrow(
      /longer password/i,
    );
  });
});
