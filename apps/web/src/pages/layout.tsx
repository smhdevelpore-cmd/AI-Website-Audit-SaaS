/** Shared shell for the auth screens. Neutral colours only: the palette is still an open
 *  question in docs/Design.md §2 (the documented primary measures 2.74:1 with white text), so
 *  this phase ships legible defaults rather than inventing a visual identity. */
import type { ReactNode } from "react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "26rem", lineHeight: 1.5 }}
    >
      <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>{title}</h1>
      {children}
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" style={{ color: "#8a1c1c", margin: "0 0 1rem" }}>
      {message}
    </p>
  );
}

export const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "0.4rem",
  marginTop: "0.2rem",
} as const;
export const labelStyle = { display: "block", marginBottom: "0.75rem", fontSize: "0.9rem" } as const;
