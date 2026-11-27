import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./AuthProvider.js";

/**
 * Sends anyone without a session to the sign-in screen, remembering where they were going.
 *
 * This is a convenience, not a security boundary: the data behind these screens is protected
 * by RLS and by the API's token check, so a client that skips the guard still sees nothing.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "unconfigured") {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "48rem" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Sign-in is not configured</h1>
        <p>
          This build has no <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code>. Add both to{" "}
          <code>.env</code> and rebuild.
        </p>
      </main>
    );
  }

  if (status === "loading") {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p role="status">Checking your session…</p>
      </main>
    );
  }

  if (status !== "signed-in") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}
