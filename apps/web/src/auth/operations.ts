/**
 * The auth operations the screens call, separated from React so they can be tested.
 *
 * These are thin on purpose: they pass the right arguments to `supabase-js` and translate its
 * error strings into something a person can act on (`describeAuthError`). Anything clever here
 * would be cleverness the tests would have to believe.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { describeAuthError } from "./session.js";

export interface AuthOperations {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
}

/** Where the reset email sends the browser back to. */
export function resetRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/reset-password`;
}

export function createAuthOperations(client: SupabaseClient, origin: string): AuthOperations {
  return {
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error !== null) throw new Error(describeAuthError(error.message));
    },

    async signUp(email, password, name) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        // The signup trigger reads `name` from this metadata to name the profile row.
        options: { data: { name } },
      });
      if (error !== null) throw new Error(describeAuthError(error.message));
      // With email confirmation switched on, Supabase returns a user but no session.
      return { needsConfirmation: data.session === null };
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error !== null) throw new Error(describeAuthError(error.message));
    },

    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: resetRedirectUrl(origin),
      });
      if (error !== null) throw new Error(describeAuthError(error.message));
    },

    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error !== null) throw new Error(describeAuthError(error.message));
    },
  };
}
