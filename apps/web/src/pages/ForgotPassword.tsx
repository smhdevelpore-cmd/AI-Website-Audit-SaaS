import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { AuthLayout, FormError, fieldStyle, labelStyle } from "./layout.js";

export function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      // The same answer whether or not the address has an account: telling the difference
      // would let anyone check who has signed up.
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password">
      <FormError message={error} />
      {sent ? (
        <p role="status">
          If that address has an account, a reset link is on its way. The link expires after a short while.
        </p>
      ) : (
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
          <button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
