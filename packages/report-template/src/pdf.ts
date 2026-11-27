/**
 * The PDF renderer (PRD FR-15, TRD §12).
 *
 * Renders one `ReportSnapshot` into bytes. No network, no browser, no remote asset: a logo is not
 * fetched (a URL in a report is a request the reader's machine would make, and a redirect in
 * somebody's PDF), and every string is sanitised before it is drawn.
 *
 * Two failure modes are worth naming because they are the ones a real site causes:
 *
 *  - **Text the font cannot encode.** The standard PDF fonts cover Latin-1. A page that titles
 *    itself with an emoji or a CJK name would otherwise throw mid-render, so the text is mapped to
 *    ASCII equivalents and anything left unencodable becomes `?` — the report still renders.
 *  - **A finding with three pages of evidence.** Text wraps by measured width, and a page break is
 *    inserted when the next line would fall off the paper.
 */

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import {
  CATEGORY_LABELS,
  MAX_LISTED_FINDINGS,
  providerReason,
  SEVERITY_LABELS,
  type ReportFinding,
  type ReportMetric,
  type ReportSnapshot,
} from "./snapshot.js";

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const SIZE = {
  title: 22,
  subtitle: 12,
  heading: 14,
  body: 10,
  small: 8,
} as const;

const LINE = {
  title: 28,
  heading: 20,
  body: 14,
  small: 11,
} as const;

/**
 * Typographic characters that have an exact ASCII equivalent, so a report reads the same instead
 * of losing meaning to `?`. Anything outside Latin-1 afterwards becomes `?`.
 */
const ASCII_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2013\u2014\u2015]/g, "-"],
  [/[\u2026]/g, "..."],
  [/[\u2022\u25CF\u25AA]/g, "-"],
  [/[\u2192]/g, "->"],
  [/[\u2190]/g, "<-"],
  [/[\u2264]/g, "<="],
  [/[\u2265]/g, ">="],
  [/[\u00D7]/g, "x"],
  [/[\u00B7\u2219]/g, "."],
  [/[\u00A0\u2007\u202F]/g, " "],
  [/[\u2010\u2011\u2012]/g, "-"],
  [/\u2122/g, "(TM)"],
  [/\u00AE/g, "(R)"],
  [/\u00A9/g, "(c)"],
];

// A control character is precisely what these three patterns are for: the renderer must strip the
// bytes a page can put in a title, so matching them is the point rather than an accident.
/* eslint-disable no-control-regex */
const WIN_ANSI_SAFE = /^[\u0000-\u00FF]*$/;

/**
 * Everything the renderer draws goes through this. Untrusted page text is the input, so the
 * function is deliberately lossy rather than clever: mapped characters where a mapping is exact,
 * `?` where it is not, and control characters removed entirely.
 */
export function sanitizePdfText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of ASCII_MAP) text = text.replace(pattern, replacement);
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  if (!WIN_ANSI_SAFE.test(text)) {
    text = [...text].map((character) => (WIN_ANSI_SAFE.test(character) ? character : "?")).join("");
  }
  return text.replace(/[ \t]+/g, " ").trim();
}
/* eslint-enable no-control-regex */

/** Splits a string into lines that fit `width` at `size` in `font`. Long words are broken. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);

      // A single word wider than the column (a long URL, an unbroken hash) is cut by character.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    if (current !== "") lines.push(current);
    if (paragraph === "") lines.push("");
  }
  return lines;
}

/**
 * The document's visible content, in order, before anything is drawn.
 *
 * Splitting "what the report says" from "where it lands on paper" makes the wording testable: a
 * test can assert that the AI label exists, that a limitation is printed and that nothing is
 * written for an audit without a score — none of which can be read back out of compressed PDF
 * bytes without a text extractor.
 */
export type OutlineStyle = "title" | "heading" | "bold" | "body" | "small";

export interface OutlineBlock {
  readonly style: OutlineStyle;
  readonly text: string;
  readonly indent?: number;
}

/** A stored number with the unit it was measured in. A null value is printed as "not measured". */
export function formatMetric(metric: ReportMetric): string {
  if (metric.value === null) return "not measured";
  const value =
    metric.unit === "ratio"
      ? metric.value.toFixed(3)
      : metric.unit === "score"
        ? String(Math.round(metric.value))
        : Math.round(metric.value);
  switch (metric.unit) {
    case "ms":
      return `${value} ms`;
    case "ratio":
      return `${value}`;
    case "score":
      return `${value} / 100`;
    default:
      return String(value);
  }
}

function metricBlocks(metrics: NonNullable<ReportSnapshot["metrics"]>): OutlineBlock[] {
  const strategy = metrics.strategy === null ? "" : ` (${metrics.strategy.toLowerCase()})`;
  const blocks: OutlineBlock[] = [
    { style: "heading", text: `Performance measured by PageSpeed Insights${strategy}` },
  ];

  if (metrics.status === "unavailable") {
    blocks.push({
      style: "body",
      text: `No performance measurement was returned for this audit: ${providerReason(metrics.reason)}. Nothing is shown rather than a number we did not receive.`,
    });
    return blocks;
  }

  for (const metric of metrics.metrics) {
    blocks.push({
      style: "body",
      text: `${metric.label}: ${formatMetric(metric)}`,
      indent: 8,
    });
  }

  blocks.push({
    style: "small",
    text: "These figures are Google's, from a Lighthouse run against one page. They are not our own measurement and are not part of the score above.",
  });
  return blocks;
}

function findingBlocks(finding: ReportFinding): OutlineBlock[] {
  const blocks: OutlineBlock[] = [
    // A report is printed in black and white as often as not: severity is a word, never a colour.
    { style: "bold", text: `[${SEVERITY_LABELS[finding.severity]}] ${finding.title}`, indent: 8 },
  ];
  if (finding.pageUrl !== null) blocks.push({ style: "small", text: finding.pageUrl, indent: 16 });
  blocks.push({ style: "body", text: finding.description, indent: 16 });
  blocks.push({ style: "body", text: `Evidence: ${finding.evidence}`, indent: 16 });
  if (finding.recommendation !== null) {
    blocks.push({ style: "body", text: `Fix: ${finding.recommendation}`, indent: 16 });
  }
  if (finding.aiExplanation !== null) {
    blocks.push({
      style: "small",
      text: "Written by AI, from the evidence above:",
      indent: 16,
    });
    blocks.push({ style: "body", text: finding.aiExplanation.plainExplanation, indent: 16 });
    blocks.push({ style: "body", text: `Impact: ${finding.aiExplanation.businessImpact}`, indent: 16 });
    for (const step of finding.aiExplanation.recommendedFix) {
      blocks.push({ style: "body", text: `- ${step}`, indent: 24 });
    }
    blocks.push({
      style: "small",
      text: `Difficulty ${finding.aiExplanation.difficulty}, priority ${finding.aiExplanation.priority}.`,
      indent: 16,
    });
  }
  return blocks;
}

export function buildReportOutline(snapshot: ReportSnapshot): OutlineBlock[] {
  const blocks: OutlineBlock[] = [];
  const agency = snapshot.branding.agencyName;
  if (agency !== null && agency !== "") blocks.push({ style: "small", text: agency });

  blocks.push({ style: "title", text: "Website audit" });
  blocks.push({ style: "heading", text: snapshot.audit.host });
  blocks.push({ style: "small", text: `Address: ${snapshot.audit.url}` });
  blocks.push({
    style: "small",
    text: `Audit ${snapshot.audit.id} - requested ${formatDate(snapshot.audit.createdAt)}${
      snapshot.audit.completedAt === null ? "" : ` - finished ${formatDate(snapshot.audit.completedAt)}`
    }`,
  });

  blocks.push({ style: "heading", text: "Score" });
  if (snapshot.audit.overallScore === null) {
    blocks.push({ style: "body", text: "No score was produced for this audit." });
  } else {
    blocks.push({ style: "title", text: `${snapshot.audit.overallScore} out of 100` });
    blocks.push({
      style: "small",
      text: "Weighted across the categories that were checked. A category shown as N/A was not checked, and its weight is shared by the others.",
    });
  }

  for (const entry of (snapshot.audit.categoryScores ?? []).filter((item) => item.weight > 0)) {
    const label = CATEGORY_LABELS[entry.category] ?? entry.category;
    const score = entry.score === null ? "N/A" : String(entry.score);
    blocks.push({ style: "body", text: `${label} (${entry.weight}% of the score): ${score}` });
  }

  if (snapshot.metrics !== null && snapshot.metrics.status !== "skipped") {
    blocks.push(...metricBlocks(snapshot.metrics));
  }

  blocks.push({ style: "heading", text: "Issues by severity" });
  blocks.push({
    style: "body",
    text: (["critical", "high", "medium", "low"] as const)
      .map((severity) => `${SEVERITY_LABELS[severity]}: ${snapshot.severityCounts[severity]}`)
      .join("   "),
  });
  blocks.push({
    style: "small",
    text: `${snapshot.audit.pagesScanned} page(s) read${snapshot.audit.partial ? ", audit marked partial" : ""}.`,
  });

  if (snapshot.summary !== null) {
    blocks.push({ style: "heading", text: "Summary" });
    blocks.push({ style: "body", text: snapshot.summary.overview });
    if (snapshot.summary.topPriorities.length > 0) {
      blocks.push({ style: "bold", text: "Where to start" });
      snapshot.summary.topPriorities.forEach((priority, index) => {
        blocks.push({ style: "body", text: `${index + 1}. ${priority}`, indent: 8 });
      });
    }
    blocks.push({
      style: "small",
      text: "This summary was written by an AI model from the findings below. It explains them; it does not measure, and it cannot change a severity or a score.",
    });
  } else if (snapshot.audit.aiStatus === "unavailable") {
    blocks.push({ style: "heading", text: "Summary" });
    blocks.push({
      style: "body",
      text: "No written summary could be produced for this audit. The findings and the score below do not depend on it.",
    });
  }

  blocks.push({ style: "heading", text: "Findings" });
  const listed = snapshot.findings.slice(0, MAX_LISTED_FINDINGS);
  if (listed.length === 0) {
    blocks.push({ style: "body", text: "No issues were found by the checks that ran." });
  }

  let lastCategory = "";
  for (const finding of listed) {
    if (finding.category !== lastCategory) {
      lastCategory = finding.category;
      blocks.push({ style: "bold", text: CATEGORY_LABELS[finding.category] ?? finding.category });
    }
    blocks.push(...findingBlocks(finding));
  }

  if (snapshot.findings.length > listed.length) {
    blocks.push({
      style: "small",
      text: `and ${snapshot.findings.length - listed.length} more finding(s) not listed in this document.`,
    });
  }

  blocks.push({ style: "heading", text: "Methodology" });
  for (const line of snapshot.methodology) blocks.push({ style: "small", text: line });

  blocks.push({ style: "heading", text: "Limitations" });
  for (const line of snapshot.limitations) blocks.push({ style: "small", text: line });

  blocks.push({ style: "heading", text: "Versions" });
  blocks.push({
    style: "small",
    text: [
      `template ${snapshot.versions.template}`,
      snapshot.versions.rules === null ? null : `rules ${snapshot.versions.rules}`,
      snapshot.versions.scoring === null ? null : `scoring ${snapshot.versions.scoring}`,
      snapshot.versions.aiModel === null ? null : `explanations ${snapshot.versions.aiModel}`,
      snapshot.versions.provider === null ? null : `pagespeed ${snapshot.versions.provider}`,
      `generated ${formatDate(snapshot.generatedAt)}`,
    ]
      .filter((part): part is string => part !== null)
      .join(" - "),
  });

  return blocks;
}

interface Cursor {
  page: PDFPage;
  y: number;
}

export interface RenderOptions {
  /** Injected so a test can render the same document twice and compare the bytes. */
  readonly now?: Date;
}

export async function renderReportPdf(
  snapshot: ReportSnapshot,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  // A fixed creation date keeps the bytes stable for the same snapshot.
  document.setProducer("SiteAudit");
  document.setCreator(`siteaudit/${snapshot.templateVersion}`);
  document.setCreationDate(options.now ?? new Date(snapshot.generatedAt));

  const cursor: Cursor = { page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };

  const newPage = (): void => {
    cursor.page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursor.y = PAGE_HEIGHT - MARGIN;
  };

  const draw = (block: OutlineBlock): void => {
    const clean = sanitizePdfText(block.text);
    if (clean === "") return;

    const spec = {
      title: { size: SIZE.title, lineHeight: LINE.title, font: bold },
      heading: { size: SIZE.heading, lineHeight: LINE.heading, font: bold },
      bold: { size: SIZE.body, lineHeight: LINE.body, font: bold },
      body: { size: SIZE.body, lineHeight: LINE.body, font: regular },
      small: { size: SIZE.small, lineHeight: LINE.small, font: regular },
    }[block.style];

    const indent = block.indent ?? 0;
    if (block.style === "heading") {
      cursor.y -= 8;
      if (cursor.y < MARGIN) newPage();
    }

    for (const line of wrapText(clean, spec.font, spec.size, CONTENT_WIDTH - indent)) {
      if (cursor.y - spec.lineHeight < MARGIN) newPage();
      cursor.page.drawText(line, { x: MARGIN + indent, y: cursor.y, size: spec.size, font: spec.font });
      cursor.y -= spec.lineHeight;
    }

    if (block.style === "title" || block.style === "heading") cursor.y -= 4;
  };

  for (const block of buildReportOutline(snapshot)) draw(block);

  return document.save();
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.toISOString().slice(0, 10)}`;
}
