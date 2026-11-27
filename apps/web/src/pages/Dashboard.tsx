import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { config } from "../config.js";
import { ApiError, apiRequest } from "../lib/api.js";

interface Profile {
  id: string;
  name: string;
  agencyName: string | null;
  website: string | null;
}

/**
 * The signed-in screen. Everything on it comes from the API, called with the session's own
 * token — no placeholder counts, no sample audits: there are none yet, and a made-up one would
 * be the first lie in the product.
 */
export function Dashboard() {
  const { email, accessToken, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accessToken === null) return;
    let active = true;

    apiRequest<Profile>(config.VITE_API_BASE_URL, "/profile", { accessToken })
      .then((result) => {
        if (active) setProfile(result.data);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : "We could not load your profile.");
      });

    return () => {
      active = false;
    };
  }, [accessToken]);

  return (
    <main
      style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "40rem", lineHeight: 1.6 }}
    >
      <h1 style={{ fontSize: "1.25rem" }}>Your account</h1>

      <p style={{ color: "#3d3d3d" }}>Signed in as {email ?? "an account without a public email"}.</p>

      {error === null ? null : (
        <p role="alert" style={{ color: "#8a1c1c" }}>
          {error}
        </p>
      )}

      <section aria-labelledby="profile-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="profile-heading" style={{ fontSize: "1rem" }}>
          Profile
        </h2>
        {profile === null ? (
          <p role="status">Loading your profile…</p>
        ) : (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: "0.25rem 1rem",
              margin: 0,
            }}
          >
            <dt>Name</dt>
            <dd style={{ margin: 0 }}>{profile.name}</dd>
            <dt>Agency</dt>
            <dd style={{ margin: 0 }}>{profile.agencyName ?? "Not set"}</dd>
            <dt>Website</dt>
            <dd style={{ margin: 0 }}>{profile.website ?? "Not set"}</dd>
          </dl>
        )}
      </section>

      <section aria-labelledby="audits-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="audits-heading" style={{ fontSize: "1rem" }}>
          Audits
        </h2>
        <p style={{ margin: 0 }}>
          No audits yet. Running a scan needs the crawler, which is not built in this phase — so this page
          shows nothing rather than a sample.
        </p>
      </section>

      <p style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </p>
    </main>
  );
}
