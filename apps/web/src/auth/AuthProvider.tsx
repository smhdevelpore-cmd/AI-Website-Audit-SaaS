/**
 * The browser's session, held in one place.
 *
 * `supabase-js` persists the session and refreshes the access token in the background; this
 * provider starts it, mirrors its state into React and exposes the operations the screens need.
 * The anon key is the only credential here — the service-role key must never appear in a
 * `VITE_` variable, and `packages/config` refuses a build that contains one.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { config } from "../config.js";
import { describeAuthError, type AuthStatus } from "./session.js";

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly email: string | null;
  readonly accessToken: string | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to whether Supabase wants an email confirmation before the account can be used. */
  readonly signUp: (email: string, password: string, name: string) => Promise<{ needsConfirmation: boolean }>;
  readonly signOut: () => Promise<void>;
  readonly requestPasswordReset: (email: string) => Promise<void>;
  readonly updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildClient(): SupabaseClient | null {
  const url = config.VITE_SUPABASE_URL;
  const anonKey = config.VITE_SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined) return null;

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo(buildClient, []);
  const [status, setStatus] = useState<AuthStatus>(client === null ? "unconfigured" : "loading");
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    if (client === null) return;

    let active = true;

    const applySession = (
      session: { user?: { email?: string | null } | null; access_token?: string } | null,
    ) => {
      if (!active) return;
      if (session === null || session.access_token === undefined) {
        setEmail(null);
        setAccessToken(null);
        setStatus("signed-out");
        return;
      }
      setEmail(session.user?.email ?? null);
      setAccessToken(session.access_token);
      setStatus("signed-in");
    };

    void client.auth.getSession().then(({ data, error }) => {
      if (error !== null) {
        applySession(null);
        return;
      }
      applySession(data.session);
    });

    // Fires on sign-in, sign-out, token refresh and password recovery. The refreshed token has
    // to reach React state, or the next API call would carry an expired one.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const requireClient = useCallback((): SupabaseClient => {
    if (client === null) {
      throw new Error("Sign-in is not configured for this build.");
    }
    return client;
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email,
      accessToken,

      async signIn(address, password) {
        const { error } = await requireClient().auth.signInWithPassword({ email: address, password });
        if (error !== null) throw new Error(describeAuthError(error.message));
      },

      async signUp(address, password, name) {
        const { data, error } = await requireClient().auth.signUp({
          email: address,
          password,
          options: { data: { name } },
        });
        if (error !== null) throw new Error(describeAuthError(error.message));
        // With email confirmation on, Supabase returns a user but no session.
        return { needsConfirmation: data.session === null };
      },

      async signOut() {
        const { error } = await requireClient().auth.signOut();
        if (error !== null) throw new Error(describeAuthError(error.message));
      },

      async requestPasswordReset(address) {
        const { error } = await requireClient().auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error !== null) throw new Error(describeAuthError(error.message));
      },

      async updatePassword(password) {
        const { error } = await requireClient().auth.updateUser({ password });
        if (error !== null) throw new Error(describeAuthError(error.message));
      },
    }),
    [status, email, accessToken, requireClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
