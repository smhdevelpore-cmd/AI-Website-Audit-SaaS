import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider.js";
import { describePasswordProblem } from "../../auth/session.js";
import { Button } from "../../components/ui/Button.js";
import { PasswordInput } from "../../components/ui/PasswordInput.js";
import { AuthLayout } from "./AuthLayout.js";

/**
 * Reached from the emailed link. `supabase-js` turns the recovery token in the URL into a
 * session, which is the session this form then uses to set a new password.
 */
export function ResetPassword() {
  const { updatePassword, signOut, status } = useAuth();
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
    <AuthLayout title="Choose a new password" footer={<Link to="/login">Back to sign in</Link>}>
      {status === "signed-in" ? (
        <>
          {error === null ? null : (
            <p
              role="alert"
              className="mb-4 rounded-[var(--radius-control)] bg-tint-critical px-3 py-2 text-sm font-medium text-critical-strong"
            >
              {error}
            </p>
          )}
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <PasswordInput
              label="New password"
              autoComplete="new-password"
              required
              hint="At least 8 characters."
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" loading={busy} className="w-full">
              {busy ? "Saving" : "Save new password"}
            </Button>
          </form>
        </>
      ) : (
        <p className="text-sm text-ink">
          Open the reset link from your email in this browser. If it has expired,{" "}
          <Link to="/forgot-password" className="text-primary-strong underline underline-offset-2">
            request another one
          </Link>
          .
        </p>
      )}
    </AuthLayout>
  );
}
