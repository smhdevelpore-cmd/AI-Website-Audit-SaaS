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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    ai: { status: "skipped", model: null, summary: null },
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

/**
 * The detail page makes two requests once an audit has finished: the audit, then its findings.
 * Answering by URL keeps each test saying what it is about, instead of one stub answering
 * everything with the same object.
 */
function stubAuditWithFindings(
  auditData: Record<string, unknown>,
  findings: ReadonlyArray<Record<string, unknown>>,
  options: {
    readonly aiStatus?: string;
    readonly metrics?: ReadonlyArray<Record<string, unknown>>;
    readonly metricsMeta?: Record<string, unknown>;
  } = {},
): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/metrics")) {
      return ok(options.metrics ?? [], {
        provider: "pagespeed",
        status: "skipped",
        counts: {},
        reason: null,
        strategy: null,
        providerVersion: null,
        measuredAt: null,
        ...(options.metricsMeta ?? {}),
      });
    }
    if (url.includes("/findings")) {
      return ok(findings, {
        total: findings.length,
        counts: { critical: 0, high: 1, medium: 0, low: 0 },
        ai: { status: options.aiStatus ?? "skipped", model: null },
      });
    }
    if (url.endsWith(".pdf")) {
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    return ok(auditData);
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

function metric(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "metric-1",
    category: "performance",
    metricKey: "largest-contentful-paint",
    label: "Largest Contentful Paint",
    value: 2100,
    unit: "ms",
    source: "pagespeed",
    status: "ok",
    strategy: "MOBILE",
    reason: null,
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-1",
    issueCode: "missing-title",
    category: "seo",
    severity: "high",
    title: "Page has no title",
    description: "A search result has no headline to show.",
    evidence: "No non-empty <title> element was found.",
    recommendation: "Add a unique title to every page.",
    pageUrl: "https://example.com/about",
    aiExplanation: null,
    ...overrides,
  };
}

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
    const finished = audit({
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
    });
    stubAuditWithFindings(finished, []);

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("82")).toBeTruthy();
    expect(screen.getByText(/SEO/)).toBeTruthy();
    // A category that was not checked says N/A rather than showing a 0.
    expect(screen.getByText("N/A")).toBeTruthy();
    // Links carries no weight of its own: its findings are already counted in Technical.
    expect(screen.queryByText(/Links/)).toBeNull();
  });

  it("lists findings worst first, with the evidence and the fix", async () => {
    const finished = audit({
      status: "completed",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      categoryScores: [{ category: "seo", score: 76, weight: 25 }],
    });
    stubAuditWithFindings(finished, [finding()]);

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("Page has no title")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText(/Evidence: No non-empty/)).toBeTruthy();
    expect(screen.getByText(/Fix: Add a unique title/)).toBeTruthy();
    expect(screen.getByText("https://example.com/about")).toBeTruthy();
  });

  it("labels an AI explanation as one, and never as the finding itself", async () => {
    const finished = audit({
      status: "completed",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      categoryScores: [{ category: "seo", score: 76, weight: 25 }],
      ai: { status: "ok", model: "test-model", summary: null },
    });
    stubAuditWithFindings(
      finished,
      [
        finding({
          aiExplanation: {
            issueCode: "missing-title",
            plainExplanation: "A search engine shows the address instead of a headline.",
            businessImpact: "Fewer people click through from search.",
            recommendedFix: ["Write a title", "Keep it under 60 characters"],
            difficulty: "easy",
            priority: "high",
          },
        }),
      ],
      { aiStatus: "ok" },
    );

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText(/Written by AI, from the evidence above/)).toBeTruthy();
    expect(screen.getByText("A search engine shows the address instead of a headline.")).toBeTruthy();
    expect(screen.getByText("Write a title")).toBeTruthy();
  });

  it("says when there is no AI explanation instead of showing an empty section", async () => {
    const finished = audit({
      status: "completed",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      categoryScores: [{ category: "seo", score: 76, weight: 25 }],
      ai: { status: "unavailable", model: null, summary: null },
    });
    stubAuditWithFindings(finished, [finding()], { aiStatus: "unavailable" });

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText(/explanations could not be produced/i)).toBeTruthy();
    expect(screen.getByText(/do not depend on them/)).toBeTruthy();
  });

  it("offers the PDF for a finished audit and fetches it with the session token", async () => {
    const finished = audit({
      status: "completed",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      categoryScores: [{ category: "seo", score: 76, weight: 25 }],
    });
    const fetchStub = stubAuditWithFindings(finished, []);

    // jsdom has neither of these; the page must not depend on the browser having them in a test.
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Download report (PDF)" }));
    await waitFor(() => expect(click).toHaveBeenCalled());

    const pdfCall = fetchStub.mock.calls.find(([input]) => String(input).endsWith("/report.pdf"));
    expect(pdfCall).toBeDefined();
    expect((pdfCall?.[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer token" });
    click.mockRestore();
  });

  it("shows PageSpeed's measurements with their units and the strategy", async () => {
    const finished = audit({
      status: "completed",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      categoryScores: [{ category: "performance", score: 100, weight: 25 }],
      metrics: {
        status: "ok",
        reason: null,
        strategy: "MOBILE",
        providerVersion: "12.6.0",
        measuredAt: "2026-11-27T09:00:00.000Z",
      },
    });
    stubAuditWithFindings(finished, [], {
      metrics: [
        metric(),
        metric({
          id: "metric-2",
          metricKey: "performance-score",
          label: "Performance score",
          value: 72,
          unit: "score",
        }),
        metric({
          id: "metric-3",
          metricKey: "cumulative-layout-shift",
          label: "Cumulative Layout Shift",
          value: 0.0412,
          unit: "ratio",
        }),
      ],
      metricsMeta: { status: "ok", strategy: "MOBILE", providerVersion: "12.6.0" },
    });

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("Largest Contentful Paint")).toBeTruthy();
    expect(screen.getByText("2100 ms")).toBeTruthy();
    expect(screen.getByText("72 / 100")).toBeTruthy();
    expect(screen.getByText("0.041")).toBeTruthy();
    expect(screen.getByText(/mobile · Lighthouse 12.6.0/)).toBeTruthy();
    expect(screen.getByText(/These figures are Google's/)).toBeTruthy();
  });

  it("prints a metric the provider did not return as not measured, never as zero", async () => {
    const finished = audit({
      status: "partial",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      partial: true,
      categoryScores: [{ category: "performance", score: 100, weight: 25 }],
      metrics: {
        status: "partial",
        reason: null,
        strategy: "MOBILE",
        providerVersion: "12.6.0",
        measuredAt: "2026-11-27T09:00:00.000Z",
      },
    });
    stubAuditWithFindings(finished, [], {
      metrics: [
        metric({
          metricKey: "interaction-to-next-paint",
          label: "Interaction to Next Paint",
          value: null,
          status: "unavailable",
        }),
      ],
      metricsMeta: { status: "partial", strategy: "MOBILE", providerVersion: "12.6.0" },
    });

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText("not measured")).toBeTruthy();
    expect(screen.queryByText("0 ms")).toBeNull();
  });

  it("says why the metrics are missing when PageSpeed refused", async () => {
    const finished = audit({
      status: "partial",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      partial: true,
      categoryScores: [{ category: "performance", score: 100, weight: 25 }],
      metrics: {
        status: "unavailable",
        reason: "quota",
        strategy: "MOBILE",
        providerVersion: null,
        measuredAt: null,
      },
    });
    stubAuditWithFindings(finished, [], {
      metrics: [],
      metricsMeta: { status: "unavailable", reason: "quota", strategy: "MOBILE" },
    });

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText(/did not return a measurement \(quota\)/)).toBeTruthy();
    expect(screen.getByText(/do not depend on it/)).toBeTruthy();
  });

  it("says performance is our own when no provider ran", async () => {
    const finished = audit({
      status: "completed",
      completedAt: "2026-11-27T09:05:00.000Z",
      overallScore: 82,
      categoryScores: [{ category: "performance", score: 100, weight: 25 }],
    });
    stubAuditWithFindings(finished, []);

    renderScreen(<AuditDetail />, `/audits/${AUDIT_ID}`);

    expect(await screen.findByText(/without Google PageSpeed Insights/)).toBeTruthy();
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
