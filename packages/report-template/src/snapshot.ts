/**
 * The report's input: one serialisable object, built from stored rows and nothing else (TRD §12).
 *
 * The renderer never reads the site, the crawler or the database. It receives this object, and the
 * object is what a future re-render of the same audit will produce again — so a report cannot
 * change because the website did, and cannot contain a number that was not stored.
 *
 * Two things are *generated* here rather than stored, and both are facts about the audit:
 * the limitations list (what was not read, whether explanations exist) and the methodology text.
 * Neither invents a result; both describe the boundaries of the one that exists.
 */

import type { AIRecommendationOutput, AuditSummaryOutput } from "@siteaudit/validation";
import type { AuditCategory, CategoryScore, Severity } from "@siteaudit/shared-types";

/** Bumped when the layout or the set of sections changes. Stored with every rendered PDF. */
export const REPORT_TEMPLATE_VERSION = "report-v2";

export interface ReportFinding {
  readonly issueCode: string;
  readonly category: AuditCategory;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly recommendation: string | null;
  /** The page the finding is about, or null when it is about the site. */
  readonly pageUrl: string | null;
  /** Present only when an AI explanation was produced and stored for this code. */
  readonly aiExplanation: AIRecommendationOutput | null;
}

export type AiStatus = "ok" | "unavailable" | "skipped";
export type MetricsStatus = "ok" | "partial" | "unavailable" | "skipped";

/** One PageSpeed measurement as stored. A null value is an absence with a status, not a zero. */
export interface ReportMetric {
  readonly metricKey: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly status: string;
  readonly reason: string | null;
}

/**
 * The provider block: only present when a provider ran. `status` and `reason` are the provider's
 * facts, so a section can say "PageSpeed was out of quota" instead of showing a table of dashes
 * that a reader would interpret as zeros.
 */
export interface ReportMetrics {
  readonly status: MetricsStatus;
  readonly reason: string | null;
  readonly strategy: string | null;
  readonly providerVersion: string | null;
  readonly measuredAt: string | null;
  readonly metrics: readonly ReportMetric[];
}

export interface ReportAudit {
  readonly id: string;
  readonly url: string;
  readonly host: string;
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly pagesScanned: number;
  readonly partial: boolean;
  readonly overallScore: number | null;
  readonly categoryScores: readonly CategoryScore[] | null;
  readonly scoringVersion: string | null;
  readonly aiStatus: AiStatus;
  readonly aiModel: string | null;
  readonly aiSummary: AuditSummaryOutput | null;
}

export interface ReportSource {
  readonly audit: ReportAudit;
  readonly findings: readonly ReportFinding[];
  /** How many pages were requested and how many could not be read. */
  readonly pagesAttempted: number;
  readonly pagesUnreadable: number;
  readonly branding?: { readonly agencyName: string | null };
  readonly rulesVersion?: string | null;
  /** Absent when the audit has no provider metrics at all, which is different from unavailable. */
  readonly metrics?: ReportMetrics | null;
}

export interface ReportSnapshot {
  readonly templateVersion: string;
  readonly generatedAt: string;
  readonly audit: ReportAudit;
  readonly branding: { readonly agencyName: string | null };
  readonly findings: readonly ReportFinding[];
  /** Findings per severity, in the order the report prints them. */
  readonly severityCounts: Readonly<Record<Severity, number>>;
  /** The model's own words, or null. Never generated here. */
  readonly summary: AuditSummaryOutput | null;
  readonly limitations: readonly string[];
  readonly methodology: readonly string[];
  /** Present only when the provider ran; never fabricated to fill the section. */
  readonly metrics: ReportMetrics | null;
  readonly versions: {
    readonly template: string;
    readonly scoring: string | null;
    readonly rules: string | null;
    readonly aiModel: string | null;
    /** The Lighthouse version that produced the metrics, when there are any. */
    readonly provider: string | null;
  };
}

export const ALWAYS_TRUE_LIMITATIONS: readonly string[] = [
  "Performance figures in this report come from our own crawl of the HTML response, not from Lighthouse.",
  "Accessibility checks are basic, automated signals. This is not a WCAG certification and not a substitute for testing with assistive technology.",
  "The audit covers a bounded set of pages from one starting address. Pages outside that set were not examined.",
  "Findings describe what was served during this audit. A site changes; a re-run measures the current state.",
];

export const METHODOLOGY: readonly string[] = [
  "Pages were fetched with an identifiable user agent, respecting robots.txt, a page limit and a depth limit.",
  "Deterministic rules read the parsed HTML and the response headers. Every finding names the page and the evidence it came from.",
  "Each category starts at 100 and loses points per distinct issue, weighted by severity; an issue that repeats across pages costs more, up to twice its base.",
  "The overall score is the weighted mean of the categories that were checked. A category that was not checked is shown as N/A and its weight is shared by the others.",
  "Written explanations, where present, were produced by an AI model from the findings in this report. They explain; they do not measure, and they cannot change a severity or a score.",
];

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  performance: "Performance",
  seo: "SEO",
  technical: "Technical",
  mobile: "Mobile",
  accessibility: "Accessibility",
  security: "Security",
  links: "Links",
};

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];
const CATEGORY_ORDER: readonly AuditCategory[] = [
  "performance",
  "seo",
  "technical",
  "mobile",
  "accessibility",
  "security",
  "links",
];

/** Deterministic order: category, then severity, then code. Same input, same document. */
export function sortFindings(findings: readonly ReportFinding[]): ReportFinding[] {
  const categoryIndex = (category: AuditCategory): number => CATEGORY_ORDER.indexOf(category);
  return [...findings].sort((a, b) => {
    const byCategory = categoryIndex(a.category) - categoryIndex(b.category);
    if (byCategory !== 0) return byCategory;
    const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.issueCode !== b.issueCode) return a.issueCode < b.issueCode ? -1 : 1;
    return (a.pageUrl ?? "") < (b.pageUrl ?? "") ? -1 : 1;
  });
}

export function severityCounts(findings: readonly ReportFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function limitationsFor(source: ReportSource): string[] {
  const limitations: string[] = [];

  if (source.pagesUnreadable > 0) {
    limitations.push(
      `${source.pagesUnreadable} of ${source.pagesAttempted} pages could not be read. The findings and the score cover the pages that could.`,
    );
  }
  if (source.audit.partial) {
    limitations.push("This audit is marked partial: part of the site could not be examined.");
  }
  if (source.audit.aiStatus === "unavailable") {
    limitations.push(
      "Written explanations could not be produced for this audit. The findings and the score are unaffected.",
    );
  }
  if (source.audit.aiStatus === "skipped") {
    limitations.push("This audit was produced without AI explanations.");
  }

  const metrics = source.metrics ?? null;
  if (metrics === null || metrics.status === "skipped") {
    limitations.push(
      "Performance figures come from our own crawl. No PageSpeed Insights run was made for this audit.",
    );
  } else if (metrics.status === "unavailable") {
    limitations.push(
      `PageSpeed Insights did not return a performance measurement for this audit (${providerReason(metrics.reason)}). No performance metrics are reported.`,
    );
  } else if (metrics.status === "partial") {
    limitations.push(
      "PageSpeed Insights returned only some of its metrics. The missing ones are shown as unavailable rather than as zero.",
    );
  }

  return [...limitations, ...ALWAYS_TRUE_LIMITATIONS];
}

/** Turns a provider code into a phrase a client can read. Never a stack trace, never prose we invent. */
export function providerReason(reason: string | null): string {
  switch (reason) {
    case "quota":
      return "the provider's quota was exhausted";
    case "timeout":
      return "the provider did not answer in time";
    case "invalid_url":
      return "the provider refused the address";
    case "http_error":
      return "the provider returned an error";
    case "malformed_response":
      return "the provider's answer could not be read";
    case "not_configured":
      return "no provider key was configured";
    default:
      return "no reason was recorded";
  }
}

export function buildReportSnapshot(
  source: ReportSource,
  options: { readonly now?: Date } = {},
): ReportSnapshot {
  const findings = sortFindings(source.findings);
  const now = options.now ?? new Date();

  return {
    templateVersion: REPORT_TEMPLATE_VERSION,
    generatedAt: now.toISOString(),
    audit: source.audit,
    branding: { agencyName: source.branding?.agencyName ?? null },
    findings,
    severityCounts: severityCounts(findings),
    // The summary is only included when the audit says an AI produced one.
    summary: source.audit.aiStatus === "ok" ? source.audit.aiSummary : null,
    limitations: limitationsFor(source),
    methodology: METHODOLOGY,
    metrics: source.metrics ?? null,
    versions: {
      template: REPORT_TEMPLATE_VERSION,
      scoring: source.audit.scoringVersion,
      rules: source.rulesVersion ?? null,
      aiModel: source.audit.aiStatus === "ok" ? source.audit.aiModel : null,
      provider: source.metrics?.providerVersion ?? null,
    },
  };
}

/** How many findings the report lists before it says "and N more". */
export const MAX_LISTED_FINDINGS = 120;

export function listedFindings(snapshot: ReportSnapshot): ReportFinding[] {
  return snapshot.findings.slice(0, MAX_LISTED_FINDINGS);
}
