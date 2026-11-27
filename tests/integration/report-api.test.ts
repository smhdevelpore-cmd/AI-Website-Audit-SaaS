/**
 * Findings and the PDF, over real HTTP.
 *
 * The data layer is the in-memory store that implements `UserData`, seeded with rows exactly as a
 * finished audit would leave them. So these tests are about the decisions the API makes: what a
 * caller may read, the order a person reads it in, the headers of a download, and whether the
 * document that comes back is built from the stored score rather than from anything recalculated.
 */

import { once } from "node:events";
import type { Server } from "node:http";

import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../apps/api/src/app.js";
import { createTokenVerifier } from "../../apps/api/src/auth/token.js";
import type { UserData, UserDataFactory } from "../../apps/api/src/data/types.js";
import { reportFilename } from "../../apps/api/src/report.js";
import { InMemoryUserData } from "../support/audit-store.js";
import { ALICE, BOB, TEST_SECRET, bearer, signTestToken } from "../support/tokens.js";

const AUDIT_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const RUNNING_ID = "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b";
const ALICE_AUDIT = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c";

let store: InMemoryUserData;
let server: Server;
let baseUrl: string;
let aliceToken: string;
let bobToken: string;

function seedFinishedAudit(id = AUDIT_ID): void {
  store.seedAudit({
    id,
    userId: ALICE,
    url: "https://example.com/",
    status: "completed",
    overallScore: 82,
    scoringVersion: "rules-v1",
    pagesScanned: 6,
    completedAt: "2026-11-27T10:01:00.000Z",
    categoryScores: [
      { category: "seo", score: 76, weight: 25 },
      { category: "technical", score: 88, weight: 20 },
      { category: "mobile", score: null, weight: 15 },
    ],
  });

  store.seedPage(id, "https://example.com/");
  for (let index = 0; index < 5; index += 1) store.seedPage(id, `https://example.com/page-${index}`);
  store.seedPage(id, "https://example.com/paper", "non_html");

  store.seedFinding(id, {
    issueCode: "missing-meta-description",
    category: "seo",
    severity: "medium",
    pageUrl: "https://example.com/",
  });
  store.seedFinding(id, {
    issueCode: "insecure-http",
    category: "security",
    severity: "critical",
    pageUrl: null,
  });
  store.seedFinding(id, {
    issueCode: "images-missing-alt",
    category: "accessibility",
    severity: "low",
    pageUrl: "https://example.com/page-1",
    aiExplanation: {
      issueCode: "images-missing-alt",
      plainExplanation: "A screen reader cannot describe these images.",
      businessImpact: "Some visitors cannot tell what the images show.",
      recommendedFix: ["Describe each image in its alt text"],
      difficulty: "easy",
      priority: "low",
    },
  });
}

async function call(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...bearer(token), ...init.headers } });
}

beforeAll(async () => {
  const createUserData: UserDataFactory = (): UserData => store as unknown as UserData;
  const app = createApp({
    auth: { verifyToken: createTokenVerifier({ key: TEST_SECRET, algorithms: ["HS256"] }), createUserData },
    now: () => new Date("2026-11-27T12:00:00.000Z"),
  });
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  aliceToken = await signTestToken(ALICE);
  bobToken = await signTestToken(BOB);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

beforeEach(() => {
  store = new InMemoryUserData(() => new Date("2026-11-27T12:00:00.000Z"));
  store.addProfile(ALICE);
  store.addProfile(BOB);
  seedFinishedAudit();
  store.seedAudit({ id: RUNNING_ID, userId: ALICE, url: "https://still-running.example/" });
  store.audits.set(RUNNING_ID, { ...store.audits.get(RUNNING_ID)!, status: "running" });
  store.seedAudit({ id: ALICE_AUDIT, userId: BOB, url: "https://bob.example/" });
});

describe("GET /audits/:id/findings", () => {
  it("lists findings worst first, with the page each one is about", async () => {
    const response = await call(`/api/v1/audits/${AUDIT_ID}/findings`, aliceToken);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: Array<{ issueCode: string; severity: string; pageUrl: string | null; aiExplanation: unknown }>;
      meta: { total: number; counts: Record<string, number>; ai: { status: string } };
    };

    expect(body.data.map((finding) => finding.severity)).toEqual(["critical", "medium", "low"]);
    expect(body.data[0]?.pageUrl).toBeNull();
    expect(body.data[1]?.pageUrl).toBe("https://example.com/");
    expect(body.meta.total).toBe(3);
    expect(body.meta.counts).toEqual({ critical: 1, high: 0, medium: 1, low: 1 });
    expect(body.meta.ai.status).toBe("skipped");
  });

  it("carries the AI explanation where there is one, and nothing where there is not", async () => {
    const response = await call(`/api/v1/audits/${AUDIT_ID}/findings`, aliceToken);
    const body = (await response.json()) as {
      data: Array<{ issueCode: string; aiExplanation: { plainExplanation: string } | null }>;
    };

    const withAi = body.data.find((finding) => finding.issueCode === "images-missing-alt");
    expect(withAi?.aiExplanation?.plainExplanation).toBe("A screen reader cannot describe these images.");
    expect(body.data.find((finding) => finding.issueCode === "insecure-http")?.aiExplanation).toBeNull();
  });

  it("answers 404 for someone else's audit, the same as for one that does not exist", async () => {
    // `ALICE_AUDIT` belongs to Bob: Alice must not be able to read its findings.
    const notMine = await call(`/api/v1/audits/${ALICE_AUDIT}/findings`, aliceToken);
    const missing = await call(`/api/v1/audits/ffffffff-ffff-4fff-8fff-ffffffffffff/findings`, aliceToken);

    expect(notMine.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await notMine.json()).toEqual(await missing.json());
  });

  it("requires a token", async () => {
    const response = await fetch(`${baseUrl}/api/v1/audits/${AUDIT_ID}/findings`);
    expect(response.status).toBe(401);
  });
});

describe("GET /audits/:id/report.pdf", () => {
  it("returns a PDF for a finished audit, as an attachment", async () => {
    const response = await call(`/api/v1/audits/${AUDIT_ID}/report.pdf`, aliceToken);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audit-example.com-2026-11-27.pdf"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("refuses an audit that has not finished, rather than reporting half of one", async () => {
    const response = await call(`/api/v1/audits/${RUNNING_ID}/report.pdf`, aliceToken);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("report_not_ready");
  });

  it("answers 404 for someone else's audit", async () => {
    const response = await call(`/api/v1/audits/${AUDIT_ID}/report.pdf`, bobToken);
    expect(response.status).toBe(404);
  });

  it("renders the same bytes twice for the same rows", async () => {
    const first = new Uint8Array(
      await (await call(`/api/v1/audits/${AUDIT_ID}/report.pdf`, aliceToken)).arrayBuffer(),
    );
    const second = new Uint8Array(
      await (await call(`/api/v1/audits/${AUDIT_ID}/report.pdf`, aliceToken)).arrayBuffer(),
    );

    // The creation date is injected, so a re-render of unchanged rows is byte-identical.
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("puts the stored score in the document, not a recount", async () => {
    const audit = store.audits.get(AUDIT_ID);
    if (audit === undefined) throw new Error("fixture missing");

    const { buildAuditSnapshot } = await import("../../apps/api/src/report.js");
    const snapshot = await buildAuditSnapshot({
      data: store,
      audit,
      agencyName: "Leeds Web Studio",
      now: new Date("2026-11-27T12:00:00.000Z"),
    });

    expect(snapshot.audit.overallScore).toBe(82);
    expect(snapshot.audit.categoryScores?.find((entry) => entry.category === "mobile")?.score).toBeNull();
    expect(snapshot.findings).toHaveLength(3);
    expect(snapshot.severityCounts).toEqual({ critical: 1, high: 0, medium: 1, low: 1 });
    // One page of the seven could not be read, and the report says so.
    expect(snapshot.limitations[0]).toContain("1 of 7 pages could not be read");
    expect(snapshot.branding.agencyName).toBe("Leeds Web Studio");
  });
});

describe("reportFilename", () => {
  it("never lets a host put punctuation into a header", () => {
    const evil = reportFilename('evil.example"\r\nX: y', "2026-11-27T10:00:00.000Z");
    expect(evil).toMatch(/^audit-evil\.example[-A-Za-z]*-2026-11-27\.pdf$/);
    // Nothing that could end a header line or open a quoted string survives.
    expect(evil).not.toMatch(/["\r\n:]/);
    expect(reportFilename("", null)).toBe("audit-site-1970-01-01.pdf");
  });
});
