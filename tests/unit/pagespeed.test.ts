/**
 * The PageSpeed provider: what it believes, and what it refuses to believe.
 *
 * Two halves, both without a network. The parser is fed the shapes Google actually returns — a
 * complete result, one with InP missing, one with no performance category, an HTML error page —
 * and has to label each metric rather than fill it in. The client is fed HTTP answers and has to
 * turn every one of them into a stated reason.
 */

import {
  createPagespeedClient,
  DEFAULT_ENDPOINT,
  emptyMetrics,
  opportunitiesFrom,
  parsePagespeedResult,
  toMetricRows,
  unavailableReport,
  type PagespeedClient,
  type PerformanceReport,
} from "@siteaudit/pagespeed";
import { describe, expect, it, vi } from "vitest";

interface FixtureOptions {
  readonly score?: number | null;
  readonly lcp?: number | null;
  readonly fcp?: number | null;
  readonly cls?: number | null;
  readonly tbt?: number | null;
  readonly si?: number | null;
  readonly inp?: number | null;
  readonly srr?: number | null;
  readonly opportunities?: boolean;
}

/** A Lighthouse result with the fields we read, and nothing else pretending to be one. */
function lighthouse(options: FixtureOptions = {}): Record<string, unknown> {
  const audit = (value: number | null, extra: Record<string, unknown> = {}) => ({
    numericValue: value,
    score: 0.5,
    ...extra,
  });

  const audits: Record<string, unknown> = {
    "largest-contentful-paint": audit(options.lcp === undefined ? 2400 : options.lcp),
    "first-contentful-paint": audit(options.fcp === undefined ? 1200 : options.fcp),
    "cumulative-layout-shift": audit(options.cls === undefined ? 0.05 : options.cls),
    "total-blocking-time": audit(options.tbt === undefined ? 120 : options.tbt),
    "speed-index": audit(options.si === undefined ? 3100 : options.si),
    "interaction-to-next-paint": audit(options.inp === undefined ? 180 : options.inp),
    "server-response-time": audit(options.srr === undefined ? 240 : options.srr),
  };

  if (options.opportunities === true) {
    audits["render-blocking-resources"] = {
      title: "Eliminate render-blocking resources",
      score: 0.2,
      details: { type: "opportunity", overallSavingsMs: 720 },
    };
    audits["unused-css-rules"] = {
      title: "Reduce unused CSS",
      score: 0.4,
      details: { type: "opportunity", overallSavingsMs: 150 },
    };
    // Already good, per Lighthouse: not a priority.
    audits["uses-text-compression"] = {
      title: "Enable text compression",
      score: 1,
      details: { type: "opportunity", overallSavingsMs: 0 },
    };
  }

  return {
    lighthouseResult: {
      finalUrl: "https://example.com/",
      fetchTime: "2026-11-27T09:58:00.000Z",
      lighthouseVersion: "12.6.0",
      configSettings: { formFactor: "mobile" },
      categories: {
        performance: { id: "performance", score: options.score === undefined ? 0.78 : options.score },
      },
      audits,
    },
  };
}

describe("parsing a PageSpeed result", () => {
  it("reads every metric, with the unit it was measured in", () => {
    const report = parsePagespeedResult(lighthouse(), { strategy: "MOBILE" });

    expect(report).not.toBeNull();
    expect(report?.status).toBe("ok");
    expect(report?.reason).toBeNull();
    expect(report?.strategy).toBe("MOBILE");
    expect(report?.providerVersion).toBe("12.6.0");
    expect(report?.finalUrl).toBe("https://example.com/");
    // The provider's own timestamp, not the moment we asked.
    expect(report?.measuredAt).toBe("2026-11-27T09:58:00.000Z");

    const byKey = new Map(report?.metrics.map((metric) => [metric.key, metric]));
    expect(byKey.get("performance-score")).toMatchObject({ value: 78, unit: "score", status: "ok" });
    expect(byKey.get("largest-contentful-paint")).toMatchObject({ value: 2400, unit: "ms" });
    expect(byKey.get("cumulative-layout-shift")).toMatchObject({ value: 0.05, unit: "ratio" });
    expect(report?.metrics).toHaveLength(8);
  });

  it("stores a metric Lighthouse did not supply as unavailable, with no value", () => {
    const report = parsePagespeedResult(lighthouse({ inp: null }), { strategy: "MOBILE" });

    expect(report?.status).toBe("partial");
    const inp = report?.metrics.find((metric) => metric.key === "interaction-to-next-paint");
    expect(inp).toMatchObject({ value: null, status: "unavailable" });
    // Everything that was measured is still there.
    expect(report?.metrics.filter((metric) => metric.status === "ok")).toHaveLength(7);
  });

  it("treats a result with no performance category as unavailable, not as zero", () => {
    const body = lighthouse();
    (body["lighthouseResult"] as Record<string, unknown>)["categories"] = {};
    (body["lighthouseResult"] as Record<string, unknown>)["audits"] = {};

    const report = parsePagespeedResult(body, { strategy: "DESKTOP" });

    expect(report?.status).toBe("unavailable");
    expect(report?.reason).toBe("malformed_response");
    expect(report?.metrics.every((metric) => metric.value === null)).toBe(true);
  });

  it("rejects a body that is not a Lighthouse result at all", () => {
    expect(parsePagespeedResult("<html>not found</html>", { strategy: "MOBILE" })).toBeNull();
    expect(parsePagespeedResult({}, { strategy: "MOBILE" })).toBeNull();
    expect(parsePagespeedResult(null, { strategy: "MOBILE" })).toBeNull();
  });

  it("keeps the few opportunities worth naming, worst first", () => {
    const report = parsePagespeedResult(lighthouse({ opportunities: true }), { strategy: "MOBILE" });

    expect(report?.opportunities.map((item) => item.id)).toEqual([
      "render-blocking-resources",
      "unused-css-rules",
    ]);
    expect(report?.opportunities[0]).toMatchObject({ savingsMs: 720 });
  });

  it("produces rows the database accepts: an unavailable metric carries no value", () => {
    const rows = toMetricRows(unavailableReport("quota", "MOBILE"));

    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.status === "unavailable" && row.value === null)).toBe(true);
    expect(rows.every((row) => row.source === "pagespeed" && row.category === "performance")).toBe(true);
    expect(rows.every((row) => row.reason === "quota" && row.strategy === "MOBILE")).toBe(true);
  });

  it("sorts nothing into existence: emptyMetrics is all nulls", () => {
    expect(emptyMetrics().every((metric) => metric.value === null)).toBe(true);
    expect(emptyMetrics()).toHaveLength(8);
  });
});

describe("the client", () => {
  const key = "a-google-key";

  function client(
    fetch: typeof globalThis.fetch,
    fetchOptions: { timeoutMs?: number } = {},
  ): PagespeedClient {
    return createPagespeedClient({
      apiKey: key,
      fetch,
      ...(fetchOptions.timeoutMs === undefined ? {} : { timeoutMs: fetchOptions.timeoutMs }),
    });
  }

  const signal = (): AbortSignal => new AbortController().signal;

  it("asks for one strategy and one category, with the key in a header", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(lighthouse()), { status: 200 }));

    const report = await client(fetch as unknown as typeof globalThis.fetch).run(
      "https://example.com/?a=1",
      signal(),
    );

    expect(report.status).toBe("ok");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(DEFAULT_ENDPOINT);
    expect(parsed.searchParams.get("strategy")).toBe("MOBILE");
    expect(parsed.searchParams.get("category")).toBe("performance");
    expect(parsed.searchParams.get("url")).toBe("https://example.com/?a=1");
    // Never in the URL: query strings end up in proxies, logs and error trackers.
    expect(url).not.toContain(key);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(key);
  });

  it("reports an exhausted quota as `quota`", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 429 }));
    const report = await client(fetch as unknown as typeof globalThis.fetch).run(
      "https://example.com/",
      signal(),
    );

    expect(report.status).toBe("unavailable");
    expect(report.reason).toBe("quota");
  });

  it("separates a refused address from a server error", async () => {
    const invalid = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Invalid URL: example.invalid" } }), {
          status: 400,
        }),
    );
    const serverError = vi.fn(async () => new Response("{}", { status: 503 }));

    const refused = await client(invalid as unknown as typeof globalThis.fetch).run(
      "https://example.invalid/",
      signal(),
    );
    const broken = await client(serverError as unknown as typeof globalThis.fetch).run(
      "https://example.com/",
      signal(),
    );

    expect(refused.reason).toBe("invalid_url");
    expect(broken.reason).toBe("http_error");
  });

  it("reports an unreadable body without inventing metrics", async () => {
    const html = vi.fn(async () => new Response("<html>gateway</html>", { status: 200 }));
    const report = await client(html as unknown as typeof globalThis.fetch).run(
      "https://example.com/",
      signal(),
    );

    expect(report.status).toBe("unavailable");
    expect(report.reason).toBe("malformed_response");
    expect(report.metrics.every((metric) => metric.value === null)).toBe(true);
  });

  it("gives up at its own timeout", async () => {
    const hanging = vi.fn(
      async (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const started = Date.now();
    const report = await client(hanging as unknown as typeof globalThis.fetch, {
      timeoutMs: 20,
    }).run("https://example.com/", signal());

    expect(report.reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("stops when the audit's own budget is spent", async () => {
    const controller = new AbortController();
    const hanging = vi.fn(
      async (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = client(hanging as unknown as typeof globalThis.fetch, { timeoutMs: 30_000 }).run(
      "https://example.com/",
      controller.signal,
    );
    controller.abort();

    const report = await pending;
    expect(report.status).toBe("unavailable");
    expect(report.reason).toBe("timeout");
  });
});

describe("opportunities", () => {
  it("skips rows with no title and keeps at most five", () => {
    const audits: Record<string, unknown> = {};
    for (let index = 0; index < 9; index += 1) {
      audits[`opp-${index}`] = {
        title: `Opportunity ${index}`,
        score: 0.1,
        details: { type: "opportunity", overallSavingsMs: index * 100 },
      };
    }
    audits["nameless"] = { score: 0.1, details: { type: "opportunity", overallSavingsMs: 999 } };
    audits["not-an-opportunity"] = { title: "A diagnostic", score: 0.1, details: { type: "table" } };

    const found = opportunitiesFrom(audits);
    expect(found).toHaveLength(5);
    expect(found[0]?.id).toBe("opp-8");
    expect(found.every((item) => item.title !== "")).toBe(true);
  });
});

describe("what a report always contains", () => {
  it("lists every metric key even when the call failed", () => {
    const report: PerformanceReport = unavailableReport("timeout", "DESKTOP");
    expect(report.metrics.map((metric) => metric.key)).toEqual(
      expect.arrayContaining(["performance-score", "largest-contentful-paint"]),
    );
    expect(report.opportunities).toEqual([]);
  });
});
