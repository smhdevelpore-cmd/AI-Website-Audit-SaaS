import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider.js";
import { describePasswordProblem } from "../../auth/session.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { PasswordInput } from "../../components/ui/PasswordInput.js";
import { AuthLayout } from "./AuthLayout.js";

export function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Carried from the landing page so nobody has to type the address twice. It is echoed, not
  // stored: no scan can be started until the crawler exists.
  const site = searchParams.get("site");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
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
      const { needsConfirmation } = await signUp(email, password, name);
      if (needsConfirmation) {
        setConfirmationSent(true);
        return;
      }
      navigate("/dashboard", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (confirmationSent) {
    return (
      <AuthLayout title="Confirm your email" footer={<Link to="/login">Back to sign in</Link>}>
        <p role="status" className="text-sm text-ink">
          We sent a confirmation link to <strong>{email}</strong>. Open it in this browser, then sign in.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Audits, findings and reports stay tied to this account."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>.
        </>
      }
    >
      {site === null ? null : (
        <p className="mb-4 rounded-[var(--radius-control)] bg-tint-neutral px-3 py-2 text-sm text-ink">
          <span className="text-muted">Address you entered:</span> {site}
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
          label="Your name"
          autoComplete="name"
          required
          hint="Shown on reports as the person who ran the audit."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
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
          autoComplete="new-password"
          required
          hint="At least 8 characters."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" loading={busy} className="w-full">
          {busy ? "Creating account" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
