/**
 * Pure session helpers, kept out of the components so they can be tested without a DOM.
 */

export type AuthStatus = "unconfigured" | "loading" | "signed-out" | "signed-in";

/**
 * Where to send someone after they sign in.
 *
 * Only same-origin paths are accepted: a `next` parameter taken from a URL and used verbatim
 * is an open redirect, and `//evil.example` is a URL, not a path.
 */
export function redirectAfterSignIn(from: unknown): string {
  const fallback = "/dashboard";
  if (typeof from !== "string") return fallback;
  if (!from.startsWith("/")) return fallback;
  if (from.startsWith("//")) return fallback;
  if (from.startsWith("/login") || from.startsWith("/signup")) return fallback;
  return from;
}

/**
 * Supabase's auth errors are written for developers. These are the same failures written for
 * the person in front of the form — no email enumeration, no internal detail.
 */
export function describeAuthError(message: string | null | undefined): string {
  const text = (message ?? "").toLowerCase();

  if (text.includes("invalid login credentials") || text.includes("invalid_grant")) {
    return "That email and password do not match an account.";
  }
  if (text.includes("email not confirmed")) {
    return "Confirm your email address first — check your inbox for the link.";
  }
  if (text.includes("already registered") || text.includes("already exists")) {
    return "An account with that email already exists. Sign in instead.";
  }
  if (text.includes("password should be") || text.includes("weak password")) {
    return "Choose a longer password, at least 8 characters.";
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return "We could not reach the sign-in service. Check your connection and try again.";
  }
  return "That did not work. Try again, and tell us if it keeps happening.";
}

/** Minimum the API and Supabase agree on; the form uses it for a hint, the server enforces. */
export const MIN_PASSWORD_LENGTH = 8;

export function describePasswordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
