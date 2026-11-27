import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { describePasswordProblem } from "../auth/session.js";
import { AuthLayout, FormError, fieldStyle, labelStyle } from "./layout.js";

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const problem = describePasswordProblem(password);
    if (problem !== null) {
      setError(problem);
      return;
    }

    setBusy(true);
    try {
      const { needsConfirmation } = await signUp(email, password, name);
      if (needsConfirmation) {
        setNotice("Check your inbox for a confirmation link, then sign in.");
        return;
      }
      navigate("/dashboard", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create an account">
      <FormError message={error} />
      {notice === null ? null : <p role="status">{notice}</p>}
      <form onSubmit={onSubmit} noValidate>
        <label style={labelStyle}>
          Your name
          <input
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={fieldStyle}
          />
        </label>
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
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={fieldStyle}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
        Already have an account? <Link to="/login">Sign in</Link>.
      </p>
    </AuthLayout>
  );
}
