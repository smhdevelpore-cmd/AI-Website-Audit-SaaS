/**
 * The browser's session, held in one place.
 *
 * `supabase-js` persists the session and refreshes the access token in the background; this
 * provider starts it, mirrors its state into React and exposes the operations the screens need.
 * The anon key is the only credential here — the service-role key must never appear in a
 * `VITE_` variable, and `packages/config` refuses a build that contains one.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { config } from "../config.js";
import { createAuthOperations, type AuthOperations } from "./operations.js";
import type { AuthStatus } from "./session.js";

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

  /**
   * The operations themselves live in `operations.ts`, where they are tested. A build with no
   * Supabase configuration gets a set of failures that say so, rather than a null check at
   * every call site.
   */
  const operations = useMemo<AuthOperations>(() => {
    if (client === null) {
      const unavailable = (): never => {
        throw new Error("Sign-in is not configured for this build.");
      };
      return {
        signIn: async () => unavailable(),
        signUp: async () => unavailable(),
        signOut: async () => unavailable(),
        requestPasswordReset: async () => unavailable(),
        updatePassword: async () => unavailable(),
      };
    }
    return createAuthOperations(client, window.location.origin);
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email,
      accessToken,

      signIn: (address, password) => operations.signIn(address, password),
      signUp: (address, password, name) => operations.signUp(address, password, name),
      signOut: () => operations.signOut(),
      requestPasswordReset: (address) => operations.requestPasswordReset(address),
      updatePassword: (password) => operations.updatePassword(password),
    }),
    [status, email, accessToken, operations],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
