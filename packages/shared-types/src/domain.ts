/**
 * Domain contracts shared by API, worker and web (ARD §7).
 *
 * Values are declared once as readonly const arrays so the Zod layer in
 * `@siteaudit/validation` builds its enums from the same source. A literal list that exists
 * twice becomes two lists that disagree.
 */

export const DOMAIN_SCHEMA_VERSION = 1;

export const AUDIT_STATUSES = ["queued", "running", "completed", "partial", "failed", "cancelled"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** Statuses that will not change again without a new request. */
export const TERMINAL_AUDIT_STATUSES = ["completed", "partial", "failed", "cancelled"] as const;

export const AUDIT_STAGES = [
  "validating",
  "crawling",
  "performance",
  "rules",
  "links",
  "scoring",
  "ai",
  "persisting",
] as const;
export type AuditStage = (typeof AUDIT_STAGES)[number];

export const AUDIT_CATEGORIES = [
  "performance",
  "seo",
  "technical",
  "mobile",
  "accessibility",
  "security",
  "links",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** How a measurement came to exist. Never upgraded silently, in the API or the report. */
export const FINDING_CONFIDENCES = ["observed", "inferred", "untestable"] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const FINDING_SOURCES = ["rule", "provider"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export const FINDING_STATUSES = ["open", "resolved", "ignored"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Units a metric can carry. `none` is a bare count or flag, not a missing unit. */
export const METRIC_UNITS = ["ms", "score", "ratio", "count", "bytes", "none"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/** Where a measurement came from. A provider number is never presented as our own check. */
export const METRIC_SOURCES = ["pagespeed", "crawler", "rule"] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

/** Provider status; a missing number keeps the reason it is missing. */
export const METRIC_STATUSES = ["ok", "unavailable", "partial"] as const;
export type MetricStatus = (typeof METRIC_STATUSES)[number];

export const REPORT_STATUSES = ["queued", "rendering", "ready", "failed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** What a usage record meters (TRD §14). Append-only: a meter that can be edited is not one. */
export const USAGE_KINDS = ["audit", "page", "provider_call", "ai_token", "report", "storage_byte"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export interface Finding {
  id: string;
  auditId: string;
  issueCode: string;
  category: AuditCategory;
  title: string;
  severity: Severity;
  description: string;
  pageUrl?: string;
  evidence: string;
  recommendation?: string;
  source: FindingSource;
  confidence: FindingConfidence;
  status: FindingStatus;
}

/**
 * One measured value. `null` means unavailable, which is not zero: PRD FR-13 requires
 * unavailable data to stay unavailable and be renormalised, never scored as a failure.
 */
export interface Metric {
  category: AuditCategory;
  /** Provider or rule identifier, e.g. `lighthouse.lcp`. */
  key: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  /** Where it came from: PageSpeed, our own crawl, or a deterministic rule. */
  source: MetricSource;
  /** Provider status, so a missing number keeps its reason. */
  status: MetricStatus;
}

export interface ScanSummary {
  pagesScanned: number;
  pagesRequested: number;
  /** True when a module failed and the totals cover only what succeeded. */
  partial: boolean;
  durationMs: number;
}

export interface CategoryScore {
  category: AuditCategory;
  /** null is N/A, not zero: the weight is redistributed across available categories. */
  score: number | null;
  weight: number;
}

export interface AuditSummary {
  overview: string;
  topPriorities: string[];
  limitations: string[];
}

/** Output of the explanation step (TRD §11). Never a source of measurements. */
export interface AIRecommendation {
  issueCode: string;
  plainExplanation: string;
  businessImpact: string;
  recommendedFix: string[];
  difficulty: Difficulty;
  priority: Priority;
}
