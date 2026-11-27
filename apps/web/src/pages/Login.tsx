import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { redirectAfterSignIn } from "../auth/session.js";
import { AuthLayout, FormError, fieldStyle, labelStyle } from "./layout.js";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const state = location.state as { from?: unknown; notice?: unknown } | null;
  const from = state?.from;
  const notice = typeof state?.notice === "string" ? state.notice : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(redirectAfterSignIn(from), { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in">
      <FormError message={error} />
      {notice === null ? null : <p role="status">{notice}</p>}
      <form onSubmit={onSubmit} noValidate>
        <label style={labelStyle}>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={fieldStyle}
          />
        </label>
        <label style={labelStyle}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={fieldStyle}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        No account yet? <Link to="/signup">Create one</Link>.
      </p>
    </AuthLayout>
  );
}
