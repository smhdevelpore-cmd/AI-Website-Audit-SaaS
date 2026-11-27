import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { describePasswordProblem } from "../auth/session.js";
import { AuthLayout, FormError, fieldStyle, labelStyle } from "./layout.js";

/**
 * Reached from the emailed link. `supabase-js` reads the recovery token out of the URL and
 * turns it into a session, which is the session this form then uses to set a new password.
 */
export function ResetPassword() {
  const { updatePassword, status, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = describePasswordProblem(password);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      await signOut();
      navigate("/login", { replace: true, state: { notice: "Password changed. Sign in with the new one." } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password">
      <FormError message={error} />
      {status === "signed-in" ? (
        <form onSubmit={onSubmit} noValidate>
          <label style={labelStyle}>
            New password
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={fieldStyle}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </button>
        </form>
      ) : (
        <p>
          Open the reset link from your email in this browser. If it has expired, request another from{" "}
          <a href="/forgot-password">the reset page</a>.
        </p>
      )}
    </AuthLayout>
  );
}
