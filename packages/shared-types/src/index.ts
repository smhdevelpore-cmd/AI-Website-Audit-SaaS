/**
 * Domain types shared by API, worker and web (ARD §7). Types only plus version constants:
 * a shared type package that also holds behaviour becomes a second, hidden service.
 */

export const DOMAIN_SCHEMA_VERSION = 0;

export type AuditStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export type AuditStage =
  "validating" | "crawling" | "performance" | "rules" | "links" | "scoring" | "ai" | "persisting";

export type AuditCategory =
  "performance" | "seo" | "technical" | "mobile" | "accessibility" | "security" | "links";

/** How a measurement came to exist. Mirrors the report vocabulary: never upgraded silently. */
export type FindingConfidence = "observed" | "inferred" | "untestable";

export type Severity = "critical" | "high" | "medium" | "low";

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
  source: "rule" | "provider";
  confidence: FindingConfidence;
}
