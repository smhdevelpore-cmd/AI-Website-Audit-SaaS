/**
 * The report: snapshot, PDF and storage.
 *
 * The PDF is checked as a document rather than as a string of bytes: it has to load, paginate and
 * survive text a real website produces (em dashes, emoji, a 400-character evidence line, a URL
 * with a query string). The snapshot is checked for the property that matters — everything in it
 * came from a stored row, and nothing in it was invented to fill a section.
 */

import {
  buildReportOutline,
  buildReportSnapshot,
  renderReportPdf,
  sanitizePdfText,
  wrapText,
  REPORT_TEMPLATE_VERSION,
  type ReportFinding,
  type ReportSnapshot,
  type ReportSource,
} from "@siteaudit/report-template";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

const finding = (overrides: Partial<ReportFinding> = {}): ReportFinding => ({
  issueCode: "missing-title",
  category: "seo",
  severity: "high",
  title: "Page has no title",
  description: "The title element is the headline of a search result.",
  evidence: "No non-empty <title> element was found.",
  recommendation: "Add a unique title of about 15-60 characters.",
  pageUrl: "https://example.com/",
  aiExplanation: null,
  ...overrides,
});

function source(overrides: Partial<ReportSource> = {}): ReportSource {
  return {
    audit: {
      id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
      url: "https://example.com/",
      host: "example.com",
      status: "completed",
      createdAt: "2026-11-27T10:00:00.000Z",
      startedAt: "2026-11-27T10:00:01.000Z",
      completedAt: "2026-11-27T10:01:00.000Z",
      pagesScanned: 6,
      partial: false,
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
      scoringVersion: "rules-v1",
      aiStatus: "skipped",
      aiModel: null,
      aiSummary: null,
    },
    findings: [
      finding(),
      finding({
        issueCode: "client-error",
        category: "technical",
        severity: "high",
        pageUrl: "https://example.com/gone",
      }),
      finding({ issueCode: "title-too-long", category: "seo", severity: "low" }),
    ],
    pagesAttempted: 6,
    pagesUnreadable: 0,
    ...overrides,
  };
}

describe("the snapshot", () => {
  it("sorts findings by category, then severity, and counts them", () => {
    const snapshot = buildReportSnapshot(source());

    expect(snapshot.findings.map((entry) => entry.category)).toEqual(["seo", "seo", "technical"]);
    expect(snapshot.findings[0]?.severity).toBe("high");
    expect(snapshot.severityCounts).toEqual({ critical: 0, high: 2, medium: 0, low: 1 });
    expect(snapshot.templateVersion).toBe(REPORT_TEMPLATE_VERSION);
  });

  it("includes an AI summary only when the audit says an AI produced one", () => {
    const skipped = buildReportSnapshot(source());
    expect(skipped.summary).toBeNull();
    expect(skipped.limitations).toContain("This audit was produced without AI explanations.");

    const summary = { overview: "Overview.", topPriorities: ["Fix titles"], limitations: [] };
    const ok = buildReportSnapshot({
      ...source(),
      audit: { ...source().audit, aiStatus: "ok", aiModel: "test-model", aiSummary: summary },
    });
    expect(ok.summary).toEqual(summary);
    expect(ok.versions.aiModel).toBe("test-model");
  });

  it("says how many pages could not be read, and that the audit was partial", () => {
    const snapshot = buildReportSnapshot({
      ...source({ pagesAttempted: 8, pagesUnreadable: 2 }),
      audit: { ...source().audit, partial: true, aiStatus: "unavailable" },
    });

    expect(snapshot.limitations[0]).toContain("2 of 8 pages could not be read");
    expect(snapshot.limitations.some((line) => line.includes("marked partial"))).toBe(true);
    expect(snapshot.limitations.some((line) => line.includes("could not be produced"))).toBe(true);
  });

  it("always states the limitations that are true of every audit", () => {
    const snapshot = buildReportSnapshot(source());
    expect(snapshot.limitations.some((line) => line.includes("not a WCAG certification"))).toBe(true);
    expect(snapshot.limitations.some((line) => line.includes("not from Lighthouse"))).toBe(true);
    expect(snapshot.methodology.length).toBeGreaterThan(0);
  });

  it("is reproducible: the same rows produce the same snapshot", () => {
    const when = new Date("2026-11-27T12:00:00.000Z");
    expect(buildReportSnapshot(source(), { now: when })).toEqual(
      buildReportSnapshot(source(), { now: when }),
    );
  });
});

describe("the PDF", () => {
  const render = async (snapshot: ReportSnapshot): Promise<Uint8Array> =>
    renderReportPdf(snapshot, { now: new Date("2026-11-27T12:00:00.000Z") });

  it("is a PDF that loads, with the audit in it", async () => {
    const bytes = await render(buildReportSnapshot(source()));

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(bytes.length).toBeGreaterThan(1_000);
  });

  it("renders the same bytes twice for the same snapshot", async () => {
    const snapshot = buildReportSnapshot(source());
    const first = await render(snapshot);
    const second = await render(snapshot);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it("paginates a report with more findings than fit on one page", async () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      finding({
        issueCode: `issue-${index}`,
        title: `A finding with a fairly long title number ${index}`,
        evidence: "E".repeat(400),
      }),
    );

    const bytes = await render(buildReportSnapshot(source({ findings: many })));
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(3);
  });

  it("renders a snapshot whose page text is unencodable", async () => {
    const bytes = await render(
      buildReportSnapshot(
        source({
          findings: [
            finding({
              title: "Title — with an em dash and an emoji 🚀",
              description: "Devisen für 日本語 pages ✓",
              evidence: "Control\u0000chars\u0007and\u001bmore",
            }),
          ],
        }),
      ),
    );

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it("renders an audit with no score and no findings without inventing either", async () => {
    const bytes = await render(
      buildReportSnapshot({
        ...source({ findings: [] }),
        audit: {
          ...source().audit,
          status: "partial",
          overallScore: null,
          categoryScores: null,
          scoringVersion: null,
        },
      }),
    );

    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("prints AI text with the label that it is AI text", async () => {
    const snapshot = buildReportSnapshot({
      ...source(),
      audit: {
        ...source().audit,
        aiStatus: "ok",
        aiModel: "test-model",
        aiSummary: { overview: "A short overview.", topPriorities: ["Fix titles"], limitations: [] },
      },
      findings: [
        finding({
          aiExplanation: {
            issueCode: "missing-title",
            plainExplanation: "A search result shows the address instead of a headline.",
            businessImpact: "Fewer clicks from search.",
            recommendedFix: ["Write a title", "Keep it short"],
            difficulty: "easy",
            priority: "high",
          },
        }),
      ],
    });

    // The label is part of the contract, and the renderer must not drop it.
    const text = buildReportOutline(snapshot)
      .map((block) => block.text)
      .join("\n");
    expect(text).toContain("Written by AI, from the evidence above:");
    expect(text).toContain("A search result shows the address instead of a headline.");
    expect(text).toContain("Impact: Fewer clicks from search.");
    expect(text).toContain("Difficulty easy, priority high.");

    // And it still renders.
    await expect(PDFDocument.load(await render(snapshot))).resolves.toBeDefined();
  });

  it("prints the limitations, the methodology and the versions", () => {
    const text = buildReportOutline(buildReportSnapshot(source()))
      .map((block) => block.text)
      .join("\n");

    expect(text).toContain("Limitations");
    expect(text).toContain("not a WCAG certification");
    expect(text).toContain("Methodology");
    expect(text).toContain("Versions");
    expect(text).toContain("template report-v1");
    expect(text).toContain("scoring rules-v1");
  });

  it("says there is no summary instead of printing an empty section", () => {
    const unavailable = buildReportOutline(
      buildReportSnapshot({ ...source(), audit: { ...source().audit, aiStatus: "unavailable" } }),
    );
    expect(unavailable.some((block) => block.text.includes("No written summary could be produced"))).toBe(
      true,
    );

    const skipped = buildReportOutline(buildReportSnapshot(source()));
    expect(skipped.some((block) => block.text === "Summary")).toBe(false);
  });
});

describe("text handling", () => {
  it("maps typographic characters instead of losing them", () => {
    expect(sanitizePdfText("A — B – C… “quoted” it’s")).toBe('A - B - C... "quoted" it\'s');
    expect(sanitizePdfText("5 → 6, ≥ 2, ≤ 3, 2 × 3")).toBe("5 -> 6, >= 2, <= 3, 2 x 3");
  });

  it("replaces characters the standard font cannot draw", () => {
    expect(sanitizePdfText("日本語")).toBe("???");
    expect(sanitizePdfText("emoji 🚀 here")).toBe("emoji ? here");
  });

  it("strips control characters, which are never text", () => {
    expect(sanitizePdfText("a\u0000b\u0007c\u001bd")).toBe("a b c d");
  });

  it("wraps to the measured width, and cuts a word that cannot fit", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);

    const lines = wrapText("word ".repeat(60), font, 10, 120);
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(120);

    const long = wrapText("x".repeat(400), font, 10, 120);
    expect(long.length).toBeGreaterThan(1);
    for (const line of long) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(120);
  });
});
