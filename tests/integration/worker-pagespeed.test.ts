/**
 * The performance provider inside a real audit.
 *
 * Crawl, rules and score are the real ones against a local fixture site; only PageSpeed is a fake.
 * That is the acceptance for this phase: a provider that answers, answers partially, or refuses
 * changes what the audit *reports*, never what it found or how it scored.
 */

import { crawlSite } from "@siteaudit/crawler";
import type { PagespeedClient, PerformanceReport } from "@siteaudit/pagespeed";
import { emptyMetrics, parsePagespeedResult, unavailableReport } from "@siteaudit/pagespeed";
import type { SafeTarget } from "@siteaudit/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createScanSteps } from "../../apps/worker/src/scan-steps.js";
import { runAuditJob } from "../../apps/worker/src/run-audit.js";
import { buildAuditSnapshot } from "../../apps/api/src/report.js";
import { InMemoryUserData } from "../support/audit-store.js";
import {
  allowLoopback,
  fixtureResolver,
  html,
  page,
  startFixtureServer,
  text,
  type FixtureServer,
} from "../support/fixture-server.js";
import { ALICE } from "../support/tokens.js";
import { InMemoryWorkerData } from "../support/worker-data.js";

const HOST = "metrics-fixture.test";
const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/robots.txt") {
      text(res, "User-agent: *\nAllow: /\n");
      return;
    }
    if (path === "/") {
      html(
        res,
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<title>A bike shop in York</title>` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `</head><body><h1>Bikes</h1><img src="/bike.png"></body></html>`,
      );
      return;
    }
    if (path === "/about") {
      html(res, page("About", ["/"]));
      return;
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><head><title>Not found</title></head></html>");
  });
});

afterAll(async () => {
  await server.close();
});

let store: InMemoryUserData;
let data: InMemoryWorkerData;

/** A complete Lighthouse answer, built here so no test reaches Google. */
function report(overrides: Partial<PerformanceReport> = {}): PerformanceReport {
  const parsed = parsePagespeedResult(
    {
      lighthouseResult: {
        finalUrl: `http://${HOST}/`,
        fetchTime: "2026-11-27T11:00:00.000Z",
        lighthouseVersion: "12.6.0",
        categories: { performance: { score: 0.72 } },
        audits: {
          "largest-contentful-paint": { numericValue: 2100 },
          "first-contentful-paint": { numericValue: 1300 },
          "cumulative-layout-shift": { numericValue: 0.04 },
          "total-blocking-time": { numericValue: 90 },
          "speed-index": { numericValue: 2900 },
          "interaction-to-next-paint": { numericValue: 160 },
          "server-response-time": { numericValue: 210 },
        },
      },
    },
    { strategy: "MOBILE" },
  );
  if (parsed === null) throw new Error("the fixture is not a Lighthouse result");
  return { ...parsed, ...overrides };
}

function client(reportValue: PerformanceReport | (() => Promise<PerformanceReport>)): PagespeedClient {
  return {
    run: async () => (typeof reportValue === "function" ? reportValue() : reportValue),
  };
}

function deps(pagespeed?: PagespeedClient) {
  return {
    data,
    resolveTarget: async (url: string): Promise<SafeTarget> => ({
      url: new URL(url),
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }),
    steps: createScanSteps({
      data,
      ...(pagespeed === undefined ? {} : { pagespeed: { client: pagespeed } }),
      crawl: (options) =>
        crawlSite({
          ...options,
          resolver: fixtureResolver(HOST),
          assertAddress: allowLoopback,
          allowedPorts: [server.port],
        }),
    }),
    timeoutMs: 10_000,
    maxAttempts: 1,
  };
}

function row() {
  const found = store.audits.get(AUDIT_ID);
  if (found === undefined) throw new Error("the audit vanished");
  return found;
}

beforeEach(() => {
  store = new InMemoryUserData(() => new Date("2026-11-27T12:00:00.000Z"));
  store.addProfile(ALICE);
  store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${server.port}/` });
  data = new InMemoryWorkerData(store);
});

describe("an audit with a provider that answers", () => {
  it("stores every metric with its source, strategy and version", async () => {
    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(client(report())));

    expect(result).toEqual({ outcome: "done", status: "completed" });
    expect(row().metrics_status).toBe("ok");
    expect(row().metrics_strategy).toBe("MOBILE");
    expect(row().metrics_provider_version).toBe("12.6.0");
    expect(row().metrics_reason).toBeNull();

    const metrics = store.metrics.get(AUDIT_ID) ?? [];
    expect(metrics).toHaveLength(8);
    expect(metrics.every((metric) => metric.source === "pagespeed")).toBe(true);
    expect(metrics.every((metric) => metric.status === "ok")).toBe(true);
    expect(metrics.find((metric) => metric.metric_key === "performance-score")?.value).toBe(72);
    expect(metrics.find((metric) => metric.metric_key === "largest-contentful-paint")).toMatchObject({
      value: 2100,
      unit: "ms",
    });
    // The provider's timestamp, not ours.
    expect(metrics[0]?.measured_at).toBe("2026-11-27T11:00:00.000Z");
  });

  it("meters the provider call, separately from pages and audits", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(client(report())));

    const kinds = data.usage.map((entry) => entry.kind);
    expect(kinds).toContain("provider_call");
    expect(data.usage.filter((entry) => entry.kind === "provider_call")).toHaveLength(1);
  });

  it("does not let the provider's numbers reach the score", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());
    const scoreWithoutProvider = row().overall_score;
    const findingsWithoutProvider = (data.findings.get(AUDIT_ID) ?? []).map((finding) => finding.issue_code);

    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${server.port}/` });
    data = new InMemoryWorkerData(store);
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(client(report({}))));

    expect(row().overall_score).toBe(scoreWithoutProvider);
    expect((data.findings.get(AUDIT_ID) ?? []).map((finding) => finding.issue_code)).toEqual(
      findingsWithoutProvider,
    );
    // The score is still the rules' number, with the rules' version beside it.
    expect(row().scoring_version).toBe("rules-v1");
  });
});

describe("an audit with a provider that refuses", () => {
  it("stores the refusal, marks the audit partial, and keeps the result intact", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());
    const scoreWithoutProvider = row().overall_score;
    const findingsWithoutProvider = (data.findings.get(AUDIT_ID) ?? []).map((f) => f.issue_code);

    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${server.port}/` });
    data = new InMemoryWorkerData(store);

    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps(client(unavailableReport("quota", "MOBILE"))),
    );

    expect(result).toEqual({ outcome: "done", status: "partial" });
    expect(row()).toMatchObject({ status: "partial", was_partial: true });
    expect(row()).toMatchObject({ metrics_status: "unavailable", metrics_reason: "quota" });

    // The absence is recorded per metric, with no numbers to mistake for zeros.
    const metrics = store.metrics.get(AUDIT_ID) ?? [];
    expect(metrics).toHaveLength(8);
    expect(metrics.every((metric) => metric.status === "unavailable" && metric.value === null)).toBe(true);

    // And the deterministic result is exactly what it was.
    expect(row().overall_score).toBe(scoreWithoutProvider);
    expect((data.findings.get(AUDIT_ID) ?? []).map((f) => f.issue_code)).toEqual(findingsWithoutProvider);
  });

  it("survives a client that throws, because a third party's bad day is not our failure", async () => {
    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps(client(async () => Promise.reject(new Error("socket hang up")))),
    );

    expect(result.outcome).toBe("done");
    expect(row().status).toBe("partial");
    expect(row().metrics_status).toBe("unavailable");
    expect(row().overall_score).not.toBeNull();
  });

  it("marks an audit partial when only some metrics came back", async () => {
    const partial = report();
    const metrics = partial.metrics.map((metric) =>
      metric.key === "interaction-to-next-paint"
        ? { ...metric, value: null, status: "unavailable" as const }
        : metric,
    );

    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps(client({ ...partial, status: "partial", metrics })),
    );

    expect(result).toEqual({ outcome: "done", status: "partial" });
    expect(row()).toMatchObject({ metrics_status: "partial" });
    const stored = store.metrics.get(AUDIT_ID) ?? [];
    expect(stored.find((metric) => metric.metric_key === "interaction-to-next-paint")?.value).toBeNull();
  });
});

describe("an audit with no provider configured", () => {
  it("says `skipped`, and is a complete audit rather than a partial one", async () => {
    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(result).toEqual({ outcome: "done", status: "completed" });
    expect(row().metrics_status).toBe("skipped");
    expect(row().metrics_reason).toBeNull();
    expect(store.metrics.get(AUDIT_ID) ?? []).toHaveLength(0);
    expect(data.usage.some((entry) => entry.kind === "provider_call")).toBe(false);
  });
});

describe("what the report says", () => {
  it("prints the provider's numbers as the provider's, and only when there are any", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(client(report())));

    const snapshot = await buildAuditSnapshot({ data: store, audit: row(), agencyName: null });

    expect(snapshot.metrics?.status).toBe("ok");
    expect(snapshot.metrics?.strategy).toBe("MOBILE");
    expect(snapshot.metrics?.providerVersion).toBe("12.6.0");
    expect(snapshot.metrics?.metrics.find((metric) => metric.metricKey === "performance-score")?.value).toBe(
      72,
    );
    // A provider ran, so no limitation claims it did not.
    expect(snapshot.limitations.some((line) => line.includes("No PageSpeed Insights run"))).toBe(false);
  });

  it("says why the numbers are missing when the provider refused", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(client(unavailableReport("quota", "MOBILE"))));

    const snapshot = await buildAuditSnapshot({ data: store, audit: row(), agencyName: null });
    expect(snapshot.metrics?.status).toBe("unavailable");
    expect(snapshot.limitations.some((line) => line.includes("quota was exhausted"))).toBe(true);
  });

  it("prints no provider section at all when no provider ran", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    const snapshot = await buildAuditSnapshot({ data: store, audit: row(), agencyName: null });
    expect(snapshot.metrics).toBeNull();
    expect(snapshot.limitations.some((line) => line.includes("No PageSpeed Insights run was made"))).toBe(
      true,
    );
  });

  it("carries an all-unavailable fixture without inventing a value", async () => {
    const empty = {
      ...report(),
      status: "unavailable" as const,
      reason: "timeout" as const,
      metrics: emptyMetrics(),
    };
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(client(empty)));

    const snapshot = await buildAuditSnapshot({ data: store, audit: row(), agencyName: null });
    expect(snapshot.metrics?.metrics.every((metric) => metric.value === null)).toBe(true);
  });
});
