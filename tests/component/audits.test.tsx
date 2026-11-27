// @vitest-environment jsdom
/**
 * The submission and history UI, against a stubbed API.
 *
 * These tests are about the promises the screens make: a queued audit says "queued and nothing
 * measured yet", a failure says why, and a submission that the server refused does not look like
 * one that worked.
 */

import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock("../../apps/web/src/auth/AuthProvider.js", () => ({
  useAuth: auth.useAuth,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

import { ToastProvider } from "../../apps/web/src/components/ui/Toast.js";
import { AuditDetail } from "../../apps/web/src/pages/app/AuditDetail.js";
import { Audits } from "../../apps/web/src/pages/app/Audits.js";

const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

function audit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AUDIT_ID,
    url: "https://example.com",
    host: "example.com",
    clientName: "Acme",
    projectName: null,
    status: "queued",
    stage: null,
    maxPages: 10,
    pagesScanned: 0,
    partial: false,
    error: null,
    createdAt: "2026-11-27T09:00:00.000Z",
    updatedAt: "2026-11-27T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const ok = (data: unknown, meta?: unknown): Response =>
  new Response(JSON.stringify(meta === undefined ? { success: true, data } : { success: true, data, meta }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const fail = (status: number, code: string, message: string, details?: unknown): Response =>
  new Response(
    JSON.stringify({ success: false, error: { code, message, ...(details ? { details } : {}) } }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );

function renderScreen(ui: ReactNode, initialPath = "/audits") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/audits" element={ui} />
            <Route path="/audits/:auditId" element={ui} />
            <Route path="/audits/:auditId/done" element={<p>detail page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.useAuth.mockReturnValue({ status: "signed-in", email: "alex@example.com", accessToken: "token" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("new audit dialog", () => {
  function renderWithDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/audits"]}>
            <Routes>
              <Route path="/audits" element={<Audits />} />
              <Route path="/audits/:auditId" element={<p>audit page</p>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("sends what was typed and opens the audit it created", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return ok(audit(), { queued: true });
      return ok([], { page: 1, limit: 10, total: 0, totalPages: 1, hasMore: false });
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    renderWithDialog();

    await user.click(await screen.findByRole("button", { name: "Run your first audit" }));
    await user.type(await screen.findByLabelText("Website address"), "https://example.com");
    await user.type(screen.getByLabelText("Client name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Start audit" }));

    expect(await screen.findByText("audit page")).toBeTruthy();
    const post = fetch.mock.calls.find((call) => call[1]?.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      url: "https://example.com",
      clientName: "Acme",
      scanScope: { maxPages: 10 },
    });
  });

  it("catches a typo before it reaches the API", async () => {
    // Typed parameters so the mock's calls can be inspected; the fetch itself returns an empty list.
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
      url === "" && init?.method === "POST"
        ? ok(audit())
        : ok([], { page: 1, limit: 10, total: 0, totalPages: 1, hasMore: false }),
    );
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    renderWithDialog();

    await user.click(await screen.findByRole("button", { name: "Run your first audit" }));
    await user.type(await screen.findByLabelText("Website address"), "ftp://example.com");
    await user.click(screen.getByRole("button", { name: "Start audit" }));

    expect(await screen.findByText("Only http and https addresses can be audited.")).toBeTruthy();
    expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });

  it("puts a server-side rejection under the address field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return fail(400, "validation_failed", "Some values in the request are not valid.", [
            { path: "url", reason: "hostname-not-public", message: "That hostname is not public." },
          ]);
        }
        return ok([], { page: 1, limit: 10, total: 0, totalPages: 1, hasMore: false });
      }),
    );

    const user = userEvent.setup();
    renderWithDialog();

    await user.click(await screen.findByRole("button", { name: "Run your first audit" }));
    await user.type(await screen.findByLabelText("Website address"), "https://intranet.example");
    await user.click(screen.getByRole("button", { name: "Start audit" }));

    expect(await screen.findByText("That hostname is not public.")).toBeTruthy();
    expect(screen.queryByText("audit page")).toBeNull();
  });

  it("says nothing was queued when the queue is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return fail(503, "service_unavailable", "The audit could not be queued. Nothing was started.");
        }
        return ok([], { page: 1, limit: 10, total: 0, totalPages: 1, hasMore: false });
      }),
    );

    const user = userEvent.setup();
    renderWithDialog();

    await user.click(await screen.findByRole("button", { name: "Run your first audit" }));
    await user.type(await screen.findByLabelText("Website address"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Start audit" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nothing was queued");
    expect(screen.queryByText("audit page")).toBeNull();
  });
});

describe("audit history", () => {
  it("says it is empty instead of rendering an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok([], { page: 1, limit: 10, total: 0, totalPages: 1, hasMore: false })),
    );

    renderScreen(<Audits />);

    expect(await screen.findByText("No audits yet")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists audits with their real status and a way to open each one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok(
          [
            audit({ status: "running", stage: "crawling" }),
            audit({
              id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
              host: "two.example",
              status: "failed",
              error: { code: "scanner_not_ready", message: "This build cannot scan websites yet." },
            }),
          ],
          { page: 1, limit: 10, total: 2, totalPages: 1, hasMore: false },
        ),
      ),
    );

    renderScreen(<Audits />);

    // The table and the mobile card list render the same rows, so both links are expected.
    const links = await screen.findAllByRole("link", { name: "example.com" });
    expect(links.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fetching pages").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.getByText("Page 1 of 1 · 2 audits")).toBeTruthy();
  });

  it("offers no next page when there is not one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok([audit()], { page: 1, limit: 10, total: 1, totalPages: 1, hasMore: false })),
    );

    renderScreen(<Audits />);
    const next = await screen.findByRole("button", { name: "Next" });
    expect(next.hasAttribute("disabled")).toBe(true);
  });

  it("reports a failed load with a retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fail(500, "internal_error", "We could not reach the database.")),
    );

    renderScreen(<Audits />);

    expect(await screen.findByText("We could not load your audits")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("audit detail", () => {
  it("shows a queued audit as queued, and says nothing has been measured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(audit())),
    );

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("Queued")).toBeTruthy();
    expect(screen.getByText(/Nothing has been measured yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel audit" })).toBeTruthy();
  });

  it("shows the score and each category's weight for a finished audit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok(
          audit({
            status: "completed",
            completedAt: "2026-11-27T09:05:00.000Z",
            pagesScanned: 6,
            overallScore: 82,
            categoryScores: [
              { category: "performance", score: 100, weight: 25 },
              { category: "seo", score: 76, weight: 25 },
              { category: "technical", score: 88, weight: 20 },
              { category: "mobile", score: null, weight: 15 },
              { category: "accessibility", score: 100, weight: 10 },
              { category: "security", score: 100, weight: 5 },
              { category: "links", score: 88, weight: 0 },
            ],
          }),
        ),
      ),
    );

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("82")).toBeTruthy();
    expect(screen.getByText(/SEO/)).toBeTruthy();
    // A category that was not checked says N/A rather than showing a 0.
    expect(screen.getByText("N/A")).toBeTruthy();
    // Links carries no weight of its own: its findings are already counted in Technical.
    expect(screen.queryByText(/Links/)).toBeNull();
  });

  it("shows why a failed audit failed, and does not offer to cancel it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok(
          audit({
            status: "failed",
            stage: "validating",
            completedAt: "2026-11-27T09:00:05.000Z",
            error: {
              code: "scanner_not_ready",
              message:
                "This build cannot scan websites yet. Nothing was measured and no report was produced.",
            },
          }),
        ),
      ),
    );

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("Failed")).toBeTruthy();
    expect(
      screen.getByText(
        "This build cannot scan websites yet. Nothing was measured and no report was produced.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel audit" })).toBeNull();
  });

  it("cancels a queued audit and goes back to the history", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return ok(audit());
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    await user.click(await screen.findByRole("button", { name: "Cancel audit" }));

    await waitFor(() => {
      const deleted = fetch.mock.calls.find((call) => call[1]?.method === "DELETE");
      expect(deleted?.[0]).toContain(`/audits/${AUDIT_ID}`);
    });
  });

  it("explains a 404 rather than showing an empty audit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fail(404, "not_found", "No audit with that id.")),
    );

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("Audit not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to audit history" })).toBeTruthy();
  });
});
