import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { cx } from "./cx.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";

/**
 * Navigation destinations. "New audit" is deliberately absent: creating an audit enqueues a
 * scan, and there is no queue yet. A menu entry that led to "not built" would be the dead
 * control Design.md §11 forbids, so the item arrives with the feature.
 */
const NAV_ITEMS = [
  { to: "/dashboard", label: "Overview" },
  { to: "/audits", label: "My audits" },
  { to: "/settings", label: "Settings" },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cx(
    "flex items-center rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium",
    isActive ? "bg-tint-brand text-primary-strong" : "text-ink hover:bg-tint-neutral",
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={onNavigate}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <NavLink
      to="/dashboard"
      className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink"
    >
      <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-primary" />
      Site Audit
    </NavLink>
  );
}

/**
 * The authenticated shell: sidebar on desktop, top bar with a drawer on mobile (Design.md §8).
 * The skip link is first in the DOM so a keyboard user can jump past the navigation.
 */
export function AppShell() {
  const { email, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
      >
        Skip to content
      </a>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <Brand />
        <Button variant="secondary" size="sm" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          Menu
        </Button>
      </header>

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
          <Brand />
          <div className="mt-6">
            <Navigation />
          </div>
          <div className="mt-auto border-t border-line pt-4">
            <p className="truncate text-xs text-muted">{email ?? "Signed in"}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              loading={signingOut}
              onClick={handleSignOut}
            >
              Sign out
            </Button>
          </div>
        </aside>

        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          <Outlet />
        </main>
      </div>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <Navigation onNavigate={() => setMenuOpen(false)} />
        <div className="mt-6 border-t border-line pt-4">
          <p className="truncate text-xs text-muted">{email ?? "Signed in"}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            loading={signingOut}
            onClick={() => {
              setMenuOpen(false);
              void handleSignOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
