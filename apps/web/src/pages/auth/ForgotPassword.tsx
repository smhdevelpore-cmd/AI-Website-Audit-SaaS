import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { AuthLayout } from "./AuthLayout.js";

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
    <AuthLayout
      title="Reset your password"
      description="We will email you a link that signs you in once, so you can set a new password."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {sent ? (
        <p role="status" className="text-sm text-ink">
          If that address has an account, a reset link is on its way. The link expires after a short while.
        </p>
      ) : (
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
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" loading={busy} className="w-full">
              {busy ? "Sending" : "Send reset link"}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
