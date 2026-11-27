/**
 * The explanation step inside a real audit.
 *
 * The crawl, rules and score are the real ones, against a local fixture site; only the model is a
 * fake. That is the point of the phase: a provider that is good, down or absent changes what the
 * audit *says*, never what it *found*. Each test asserts both halves — the explanations written,
 * and the score and findings untouched.
 */

import { crawlSite } from "@siteaudit/crawler";
import type { SafeTarget } from "@siteaudit/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createScanSteps } from "../../apps/worker/src/scan-steps.js";
import { runAuditJob } from "../../apps/worker/src/run-audit.js";
import { buildAuditReport, buildAuditSnapshot } from "../../apps/api/src/report.js";
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

const HOST = "ai-fixture.test";
const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer((req, res) => {
    const path = req.url ?? "/";
    const origin = `http://${HOST}:${server.port}`;

    if (path === "/robots.txt") {
      text(res, "User-agent: *\nAllow: /\n");
      return;
    }
    if (path === "/") {
      // Missing a meta description and an image alt, and linking to a page that 404s: three
      // different severities for the fake model to write about.
      html(
        res,
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<title>A small shop in Leeds</title>` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<link rel="canonical" href="${origin}/">` +
          `</head><body><h1>Shop</h1><img src="/bag.png">` +
          `<a href="/about">About</a><a href="/gone">Old stock</a></body></html>`,
      );
      return;
    }
    if (path === "/about") {
      html(res, page("About", ["/"]));
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><head><title>Not found</title></head><body>404</body></html>");
  });
});

afterAll(async () => {
  await server.close();
});

let store: InMemoryUserData;
let data: InMemoryWorkerData;

beforeEach(() => {
  store = new InMemoryUserData(() => new Date("2026-11-27T12:00:00.000Z"));
  store.addProfile(ALICE);
  store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${server.port}/` });
  data = new InMemoryWorkerData(store);
});

/** The reply a well-behaved model would give, for whatever codes the rules actually found. */
function replyFor(codes: readonly string[]): string {
  return JSON.stringify({
    summary: {
      overview: "The shop can be found, but search results and screen readers miss key details.",
      topPriorities: ["Write a description for the homepage"],
      limitations: ["The crawl covered a handful of pages."],
    },
    recommendations: codes.map((issueCode) => ({
      issueCode,
      plainExplanation: "This is what the defect means, in plain words.",
      businessImpact: "Some visitors and some search results are worse off because of it.",
      recommendedFix: ["Fix the first thing", "Then the second"],
      difficulty: "easy",
      priority: "high",
    })),
  });
}

type Provider = Parameters<typeof createScanSteps>[0]["ai"];

/** A provider that answers with a recommendation for every code the audit actually produced. */
function goodProvider(seen: string[] = []): NonNullable<Provider> {
  return {
    model: "test-model",
    provider: async ({ user }) => {
      // The prompt is the only place the codes appear, so they are read back out of it: a
      // recommendation for a code the rules did not produce is rejected by design.
      const codes = [...user.matchAll(/"issueCode":\s*"([a-z0-9-]+)"/g)].map((match) => match[1] ?? "");
      seen.push(...codes);
      return replyFor(codes);
    },
  };
}

function deps(ai?: Provider) {
  return {
    data,
    resolveTarget: async (url: string): Promise<SafeTarget> => ({
      url: new URL(url),
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }),
    steps: createScanSteps({
      data,
      ...(ai === undefined ? {} : { ai }),
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

describe("an audit with a working model", () => {
  it("stores explanations beside the findings, and leaves the findings alone", async () => {
    const seen: string[] = [];
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(goodProvider(seen)));

    expect(row().status).toBe("completed");
    expect(row().ai_status).toBe("ok");
    expect(row().ai_model).toBe("test-model");
    expect(row().ai_summary).toMatchObject({ topPriorities: ["Write a description for the homepage"] });

    const findings = data.findings.get(AUDIT_ID) ?? [];
    expect(findings.length).toBeGreaterThan(0);
    // Every finding is still the deterministic one: the model added text, not facts.
    expect(findings.every((finding) => finding.source === "rule")).toBe(true);
    expect(findings.every((finding) => finding.recommendation !== null)).toBe(true);

    const explanations = data.explanations.get(AUDIT_ID);
    expect(explanations).toBeDefined();
    expect(explanations?.recommendations.size).toBeGreaterThan(0);
    // The model is never asked about a code the rules did not produce.
    for (const code of seen) {
      expect(findings.some((finding) => finding.issue_code === code)).toBe(true);
    }
  });

  it("meters the tokens it used, and nothing else", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(goodProvider()));

    const kinds = data.usage.map((entry) => entry.kind);
    expect(kinds).toEqual(["audit", "page", "ai_token"]);
    const tokens = data.usage.find((entry) => entry.kind === "ai_token");
    expect(tokens?.quantity).toBeGreaterThan(0);
  });

  it("puts the explanation in the report, attached to the finding it explains", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps(goodProvider()));

    const snapshot = await buildAuditSnapshot({
      data: store,
      audit: row(),
      agencyName: "Leeds Web Studio",
      now: new Date("2026-11-27T13:00:00.000Z"),
    });

    expect(snapshot.summary).not.toBeNull();
    expect(snapshot.findings.some((finding) => finding.aiExplanation !== null)).toBe(true);
    // The score in the report is the row's score, not a recount.
    expect(snapshot.audit.overallScore).toBe(row().overall_score);
    expect(snapshot.audit.aiStatus).toBe("ok");

    const pdf = await buildAuditReport({
      data: store,
      audit: row(),
      agencyName: "Leeds Web Studio",
      now: new Date("2026-11-27T13:00:00.000Z"),
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("an audit whose model fails", () => {
  it("keeps the findings and the score, and labels the absence", async () => {
    const before = await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());
    const scoreWithoutAi = row().overall_score;
    const findingsWithoutAi = (data.findings.get(AUDIT_ID) ?? []).map((finding) => finding.issue_code);
    expect(before).toEqual({ outcome: "done", status: "completed" });

    // Same audit, a provider that is down.
    store.seedAudit({ id: AUDIT_ID, userId: ALICE, url: `http://${HOST}:${server.port}/` });
    data = new InMemoryWorkerData(store);

    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps({
        model: "test-model",
        provider: async () => {
          throw new Error("provider is down");
        },
      }),
    );

    expect(result).toEqual({ outcome: "done", status: "completed" });
    expect(row().ai_status).toBe("unavailable");
    expect(row().ai_summary).toBeNull();
    expect(data.aiUnavailable).toEqual([AUDIT_ID]);
    expect(data.explanations.has(AUDIT_ID)).toBe(false);

    // The audit is exactly what it was without a model.
    expect(row().overall_score).toBe(scoreWithoutAi);
    expect((data.findings.get(AUDIT_ID) ?? []).map((finding) => finding.issue_code)).toEqual(
      findingsWithoutAi,
    );
    expect(data.usage.some((entry) => entry.kind === "ai_token")).toBe(false);
  });

  it("does not retry the audit because the model failed", async () => {
    let calls = 0;
    const result = await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps({
        model: "test-model",
        provider: async () => {
          calls += 1;
          throw new Error("provider is down");
        },
      }),
    );

    expect(result.outcome).toBe("done");
    // Two attempts is the explanation step's own budget; the audit is not retried a third time.
    expect(calls).toBe(2);
  });

  it("tells the report the explanations are missing rather than showing none", async () => {
    await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps({
        model: "test-model",
        provider: async () => {
          throw new Error("down");
        },
      }),
    );

    const snapshot = await buildAuditSnapshot({ data: store, audit: row(), agencyName: null });
    expect(snapshot.summary).toBeNull();
    expect(snapshot.limitations.some((line) => line.includes("could not be produced"))).toBe(true);
    expect(snapshot.findings.every((finding) => finding.aiExplanation === null)).toBe(true);
  });
});

describe("an audit with no model configured", () => {
  it("reports `skipped`, and says so instead of claiming there was nothing to explain", async () => {
    await runAuditJob({ auditId: AUDIT_ID, attempt: 1 }, deps());

    expect(row().ai_status).toBe("skipped");
    expect(data.explanations.size).toBe(0);
    expect(data.aiUnavailable).toEqual([]);

    const snapshot = await buildAuditSnapshot({ data: store, audit: row(), agencyName: null });
    expect(snapshot.audit.aiStatus).toBe("skipped");
    expect(snapshot.limitations.some((line) => line.includes("without AI explanations"))).toBe(true);
  });
});

describe("what the model is sent", () => {
  it("never receives a page's HTML, only the findings and their evidence", async () => {
    const prompts: string[] = [];
    await runAuditJob(
      { auditId: AUDIT_ID, attempt: 1 },
      deps({
        model: "test-model",
        provider: async ({ user, system }) => {
          prompts.push(user, system);
          const codes = [...user.matchAll(/"issueCode":\s*"([a-z0-9-]+)"/g)].map((match) => match[1] ?? "");
          return replyFor(codes);
        },
      }),
    );

    const prompt = prompts.join("\n");
    // The fixture's own markup and link text never reach the model: only what a rule observed.
    // (A rule may *mention* a tag — "no <h1> element" — but never pastes the page.)
    expect(prompt).not.toContain("<!doctype");
    expect(prompt).not.toContain("charset");
    expect(prompt).not.toContain("Old stock");
    expect(prompt.length).toBeLessThan(20_000);
    // The score travels as context, so a summary can be about the audit it describes.
    expect(prompt).toContain("overall_score");
  });
});
