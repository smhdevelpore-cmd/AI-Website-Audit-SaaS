import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider.js";
import { redirectAfterSignIn } from "../../auth/session.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { PasswordInput } from "../../components/ui/PasswordInput.js";
import { AuthLayout } from "./AuthLayout.js";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: unknown; notice?: unknown } | null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const notice = typeof state?.notice === "string" ? state.notice : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(redirectAfterSignIn(state?.from), { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Your audits are where you left them."
      footer={
        <>
          No account yet? <Link to="/register">Create one</Link>.
        </>
      }
    >
      {notice === null ? null : (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-tint-success px-3 py-2 text-sm text-success-strong"
        >
          {notice}
        </p>
      )}

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
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" loading={busy} className="w-full">
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-sm">
        <Link to="/forgot-password" className="text-primary-strong underline underline-offset-2">
          Forgot your password?
        </Link>
      </p>
    </AuthLayout>
  );
}
