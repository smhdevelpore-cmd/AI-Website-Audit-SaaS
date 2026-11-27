import { config } from "./config.js";

/**
 * Phase 1 scaffold. Proves validated browser configuration reaches the app; it is not a
 * screen and deliberately has no styling decisions in it. The interface arrives in a later
 * phase, designed against docs/Design.md.
 */
export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>Site Audit web scaffold</h1>
      <p style={{ margin: 0, maxWidth: "60ch" }}>
        The app shell builds, and its configuration validated. No audit screens exist yet.
      </p>
      <p style={{ margin: "0.5rem 0 0", maxWidth: "60ch", color: "#495057" }}>
        API base URL: {config.VITE_API_BASE_URL}
      </p>
    </main>
  );
}
