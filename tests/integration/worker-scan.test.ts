/**
 * A whole audit, end to end, against a local fixture site.
 *
 * The real crawler, the real parser, the real rules and the real scorer all run: the only things
 * replaced are the DNS answer and the address policy, because the site is on 127.0.0.1. That makes
 * this the test that proves the phase's done-when — a fixture site produces stable findings and a
 * reproducible score — rather than a test of four fakes agreeing with each other.
 *
 * What is written is checked as the worker would write it: pages with their final URLs, findings
 * with their page ids, a score with its version, and a terminal status that matches what happened.
 */

import { crawlSite } from "@siteaudit/crawler";
import type { SafeTarget } from "@siteaudit/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createScanSteps } from "../../apps/worker/src/scan-steps.js";
import { runAuditJob } from "../../apps/worker/src/run-audit.js";
import { InMemoryUserData } from "../support/audit-store.js";
import {
  allowLoopback,
  fixtureResolver,
  html,
  notFound,
  page,
  startFixtureServer,
  text,
  type FixtureServer,
} from "../support/fixture-server.js";
import { ALICE } from "../support/tokens.js";
import { InMemoryWorkerData } from "../support/worker-data.js";

const HOST = "fixture.test";
const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const AGENT_URL = `http://${HOST}:1/`;

let server: FixtureServer;

/** The homepage: readable, but missing a description and an image alt, and linking to a 404. */
function home(origin: string): string {
  return (
    `<!doctype html><html lang="en"><head>` +
    `<meta charset="utf-8"><title>A plumber in Leeds with an emergency callout</title>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<link rel="canonical" href="${origin}/">` +
    `</head><body><h1>Plumbing in Leeds</h1><h2>Boilers</h2>` +
    `<img src="/van.png">` +
    `<a href="/about">About us</a><a href="/gone">Old prices</a>` +
    `</body></html>`
  );
}

beforeAll(async () => {
  server = await startFixtureServer((req, res) => {
    const path = req.url ?? "/";
    const origin = `http://${HOST}:${server.port}`;

    if (path === "/robots.txt") {
      text(res, `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`);
      return;
    }
    if (path === "/sitemap.xml") {
      text(res, `<urlset><url><loc>${origin}/about</loc></url></urlset>`, "application/xml");
      return;
    }
    if (path === "/") {
      html(res, home(origin), 200, { "content-type": "text/html; charset=utf-8" });
      return;
    }
    if (path === "/about") {
      html(res, page("About us", ["/"]), 200, { "x-content-type-options": "nosniff" });
      return;
    }
    // `/gone` is a real 404: a page-shaped URL that answers with an error.
    notFound(res);
  });
});

afterAll(async () => {
  await server.close();
});

let store: InMemoryUserData;
let data: InMemoryWorkerData;

function steps(crawl = crawlSite) {
  return createScanSteps({
    data,
    crawl: (options) =>
      crawl({
        ...options,
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [server.port],
      }),
  });
}

function deps(overrides: { readonly steps?: ReturnType<typeof steps> } = {}) {
  return {
    data,
    resolveTarget: async (url: string): Promise<SafeTarget> => ({
      url: new URL(url),
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }),
    steps: overrides.steps ?? steps(),
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

describe("a scan of a working site", () => {
  it("completes, stores pages, findings and a score", async () => {
    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(result).toEqual({ outcome: "done", status: "completed" });
    expect(row()).toMatchObject({
      status: "completed",
      scoring_version: "rules-v1",
      was_partial: false,
      error_code: null,
    });
    expect(row().completed_at).not.toBeNull();
    expect(row().overall_score).toBeGreaterThan(0);
    expect(row().overall_score).toBeLessThanOrEqual(100);
  });

  it("records the stages in the order the TRD names them", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    // `validating` is written by `markRunning`; the stages below are the steps, in order.
    expect(data.stages.map((entry) => entry.stage)).toEqual(["crawling", "rules", "scoring"]);
  });

  it("stores every page it fetched, with the URL the content came from", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    const pages = data.pages.get(AUDIT_ID) ?? [];
    const urls = pages.map((p) => p.url).sort();
    expect(urls).toEqual([
      `http://${HOST}:${server.port}/`,
      `http://${HOST}:${server.port}/about`,
      `http://${HOST}:${server.port}/gone`,
    ]);
    expect(pages.every((p) => p.final_url === p.url)).toBe(true);
    expect(pages.every((p) => p.audit_id === AUDIT_ID)).toBe(true);
    expect(pages.find((p) => p.url.endsWith("/"))?.title).toBe(
      "A plumber in Leeds with an emergency callout",
    );
    expect(row().pages_scanned).toBe(3);
  });

  it("stores findings with the page they belong to", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    const findings = data.findings.get(AUDIT_ID) ?? [];
    const homeId = `page:http://${HOST}:${server.port}/`;
    const goneId = `page:http://${HOST}:${server.port}/gone`;
    const at = (code: string, pageId: string | null) =>
      findings.find((finding) => finding.issue_code === code && finding.page_id === pageId);

    expect(at("missing-meta-description", homeId)).toBeDefined();
    expect(at("images-missing-alt", homeId)?.severity).toBe("medium");
    // The 404 is a page finding; the link to it is a link finding on the page that links.
    expect(at("client-error", goneId)?.severity).toBe("high");
    expect(at("broken-internal-link", homeId)?.evidence).toContain(`http://${HOST}:${server.port}/gone`);
    // Site-wide findings have no page at all, which is what makes them site-wide. The fixture is
    // served over http, so the security finding here is the scheme rather than a missing header.
    expect(at("insecure-http", null)?.severity).toBe("critical");
    expect(findings.every((finding) => finding.source === "rule")).toBe(true);
  });

  it("writes a score whose parts add up to the stored overall", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    const scores = data.scores.get(AUDIT_ID);
    expect(scores).toBeDefined();
    expect(scores?.overall).toBe(row().overall_score);
    expect(scores?.categories).toHaveLength(7);
    expect(scores?.categories.find((entry) => entry.category === "performance")).toMatchObject({
      weight: 25,
    });
    expect(scores?.categories.find((entry) => entry.category === "links")?.weight).toBe(0);
  });

  it("meters the pages it asked for", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(data.usage).toEqual([
      { userId: ALICE, auditId: AUDIT_ID, kind: "audit", quantity: 1 },
      { userId: ALICE, auditId: AUDIT_ID, kind: "page", quantity: 3 },
    ]);
  });

  it("produces the same score on a second run", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());
    const first = row().overall_score;

    // A fresh row for a second audit of the same site: the score must not wobble.
    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${server.port}/` });
    data = new InMemoryWorkerData(store);
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(row().overall_score).toBe(first);
  });
});

describe("a scan that cannot produce results", () => {
  it("fails the audit, without retrying, when the start page cannot be read", async () => {
    // A port nothing is listening on: the crawl reports `connection_failed` for the start page.
    const closed = await startFixtureServer(() => undefined);
    await closed.close();

    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${closed.port}/` });

    const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(result).toEqual({ outcome: "done", status: "failed" });
    expect(row()).toMatchObject({ status: "failed", error_code: "target_unreachable" });
    expect(row().overall_score).toBeNull();
    expect(data.scores.has(AUDIT_ID)).toBe(false);
    expect(data.findings.has(AUDIT_ID)).toBe(false);
  });

  it("marks the audit partial when one page cannot be read", async () => {
    const mixed = await startFixtureServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/") {
        html(res, page("Mixed site", ["/about", "/paper"]));
        return;
      }
      if (path === "/about") {
        html(res, page("About"));
        return;
      }
      // Not HTML: the crawler refuses to parse it, and the page is recorded as a failure.
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4");
    });

    try {
      store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${mixed.port}/` });
      const mixedSteps = createScanSteps({
        data,
        crawl: (options) =>
          crawlSite({
            ...options,
            resolver: fixtureResolver(HOST),
            assertAddress: allowLoopback,
            allowedPorts: [mixed.port],
          }),
      });

      const result = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps({ steps: mixedSteps }));

      expect(result).toEqual({ outcome: "done", status: "partial" });
      expect(row()).toMatchObject({ status: "partial", was_partial: true });
      // A partial audit still has a score: the pages that worked were measured.
      expect(row().overall_score).not.toBeNull();
      expect(data.pages.get(AUDIT_ID)?.find((p) => p.url.endsWith("/paper"))?.fetch_error).toBe("non_html");
    } finally {
      await mixed.close();
    }
  });
});

describe("the target gate", () => {
  it("never reaches the network for a rejected target", async () => {
    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: AGENT_URL });
    let looked = 0;

    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      {
        ...deps(),
        resolveTarget: async () => {
          looked += 1;
          throw new Error("should not resolve");
        },
      },
    );

    expect(looked).toBe(1);
    expect(result).toEqual({ outcome: "done", status: "failed" });
    expect(data.pages.has(AUDIT_ID)).toBe(false);
  });
});
