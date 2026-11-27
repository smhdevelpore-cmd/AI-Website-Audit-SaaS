/**
 * The data access boundary.
 *
 * The API talks to these small interfaces, never to `@supabase/supabase-js` directly. That is
 * what lets the route tests run without a database, and it keeps one rule visible in the type
 * system: every call carries the caller's own token, so RLS — not application code — is what
 * separates tenants.
 */

import {
  AUDIT_CATEGORIES,
  SEVERITIES,
  publicAuditFailureMessage,
  type CategoryScore,
} from "@siteaudit/shared-types";
import {
  aiRecommendationSchema,
  auditSummarySchema,
  type AIRecommendationOutput,
  type AuditSummaryOutput,
} from "@siteaudit/validation";

export interface ProfileRow {
  id: string;
  name: string;
  agency_name: string | null;
  website: string | null;
  timezone: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfilePatch = Partial<
  Pick<ProfileRow, "name" | "agency_name" | "website" | "timezone" | "logo_url">
>;

export interface AuditRow {
  id: string;
  user_id: string;
  url: string;
  host: string;
  client_name: string | null;
  project_name: string | null;
  status: string;
  stage: string | null;
  max_pages: number;
  pages_scanned: number;
  was_partial: boolean;
  scoring_version: string | null;
  overall_score: number | null;
  category_scores: CategoryScore[] | null;
  error_code: string | null;
  error_message: string | null;
  /** `ok` = explanations produced; `unavailable` = the provider failed; `skipped` = no key. */
  ai_status: string;
  ai_model: string | null;
  ai_summary: AuditSummaryOutput | null;
  /**
   * The performance provider's own status, separate from the audit's: a scan can succeed while
   * PageSpeed is out of quota, and the report has to be able to say exactly that.
   */
  metrics_status: string;
  metrics_reason: string | null;
  metrics_strategy: string | null;
  metrics_provider_version: string | null;
  metrics_measured_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What a caller asks for when creating an audit. The server fills in status and timestamps. */
export interface NewAuditRow {
  readonly url: string;
  readonly host: string;
  readonly clientName: string | null;
  readonly projectName: string | null;
  readonly maxPages: number;
}

export interface AuditListQuery {
  readonly page: number;
  readonly limit: number;
  readonly status?: string;
  readonly search?: string;
}

export interface AuditListResult {
  readonly rows: readonly AuditRow[];
  /** Total matching rows, so the client can paginate without guessing. */
  readonly total: number;
}

/**
 * One stored finding, joined to the page it belongs to.
 *
 * `page` is the embedded `audit_pages(url)` selection: null for a site-wide finding, and also
 * null if the page row is gone (the column is `on delete cascade`, so in practice never).
 */
export interface FindingRow {
  id: string;
  audit_id: string;
  page_id: string | null;
  issue_code: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  evidence: string;
  recommendation: string | null;
  source: string;
  status: string;
  ai_explanation: AIRecommendationOutput | null;
  page: { url: string } | null;
}

/**
 * One stored measurement. `value` is null exactly when the provider supplied nothing, and the
 * database refuses any other combination of `status` and `value`.
 */
export interface MetricRow {
  id: string;
  audit_id: string;
  page_id: string | null;
  category: string;
  metric_key: string;
  label: string;
  value: number | null;
  unit: string;
  source: string;
  status: string;
  strategy: string | null;
  provider_version: string | null;
  measured_at: string | null;
  reason: string | null;
}

/** The two columns a report needs from `audit_pages`: what was asked for, and what failed. */
export interface PageRowSummary {
  url: string;
  fetch_error: string | null;
}

/**
 * Everything the API may do with one user's rows. There is no `list all` and no lookup by
 * anything but the caller's own identifiers: a method that could reach another tenant must not
 * exist, because code cannot call an interface method that was never declared.
 */
export interface UserData {
  findProfile(userId: string): Promise<ProfileRow | null>;
  /** `null` when the row does not exist or is not the caller's (RLS returns no row either way). */
  updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow | null>;
  findAudit(auditId: string): Promise<AuditRow | null>;

  /**
   * Inserts a `queued` audit owned by the caller. RLS enforces both facts
   * (`with check (user_id = auth.uid() and status = 'queued')`), so this method cannot create
   * a row for someone else or invent a finished status.
   */
  createAudit(userId: string, input: NewAuditRow): Promise<AuditRow>;

  /** Newest first. `search` matches the address, host and the two labels. */
  listAudits(userId: string, query: AuditListQuery): Promise<AuditListResult>;

  /** How many audits this user created since a moment — the usage limit's only input. */
  countAuditsSince(userId: string, since: Date): Promise<number>;

  /** A queued or running audit for exactly this address, if one exists. */
  findActiveAudit(userId: string, url: string): Promise<AuditRow | null>;

  /** True when a row was removed. RLS means only the caller's rows can be. */
  deleteAudit(auditId: string): Promise<boolean>;

  /**
   * Every finding for one audit, most severe first, with the URL of the page it belongs to.
   * RLS scopes `audit_findings` through the parent audit, so a caller cannot read another
   * tenant's findings even by guessing an audit id.
   */
  listFindings(auditId: string): Promise<readonly FindingRow[]>;

  /** Page URLs and their fetch error, for the "N of M pages could not be read" limitation. */
  listPageSummaries(auditId: string): Promise<readonly PageRowSummary[]>;

  /**
   * Every stored metric for one audit, whatever its source, ordered by category and key. A metric
   * with `status: "unavailable"` is a row with no value: the report prints the absence rather than
   * a zero it did not measure.
   */
  listMetrics(auditId: string): Promise<readonly MetricRow[]>;
}

/** Builds a client for one request, authorised by that request's access token. */
export type UserDataFactory = (accessToken: string) => UserData;

/** API representations: camelCase, no `user_id`, no storage paths. */
export interface ProfileView {
  id: string;
  name: string;
  agencyName: string | null;
  website: string | null;
  timezone: string | null;
  logoUrl: string | null;
  updatedAt: string;
}

export interface AuditView {
  id: string;
  url: string;
  host: string;
  clientName: string | null;
  projectName: string | null;
  status: string;
  stage: string | null;
  maxPages: number;
  pagesScanned: number;
  partial: boolean;
  /** 0–100 over the categories that were checked, or null while there is no score. */
  overallScore: number | null;
  /** Per-category score and FR-13 weight; `score: null` means N/A, not zero. */
  categoryScores: readonly CategoryScore[] | null;
  /**
   * `message` is generated from `code`, never read from the row: a stored message could be a
   * database error, and this field is rendered in a browser.
   */
  error: { code: string; message: string } | null;
  /**
   * Whether this audit has AI-written explanations, and why not when it does not. The UI shows
   * this rather than guessing from an empty list, which would read as "nothing was found".
   */
  ai: {
    status: "ok" | "unavailable" | "skipped";
    model: string | null;
    summary: AuditSummaryOutput | null;
  };
  /** PageSpeed's status, strategy and version — the provider's facts, not an inference from gaps. */
  metrics: {
    status: "ok" | "partial" | "unavailable" | "skipped";
    reason: string | null;
    strategy: string | null;
    providerVersion: string | null;
    measuredAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface FindingView {
  id: string;
  issueCode: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  evidence: string;
  recommendation: string | null;
  /** Null for a site-wide finding. */
  pageUrl: string | null;
  /** Present only when the audit's AI step produced one for this finding. */
  aiExplanation: AIRecommendationOutput | null;
}

export interface MetricView {
  id: string;
  category: string;
  metricKey: string;
  label: string;
  value: number | null;
  unit: string;
  source: string;
  status: string;
  strategy: string | null;
  reason: string | null;
}

export function toProfileView(row: ProfileRow): ProfileView {
  return {
    id: row.id,
    name: row.name,
    agencyName: row.agency_name,
    website: row.website,
    timezone: row.timezone,
    logoUrl: row.logo_url,
    updatedAt: row.updated_at,
  };
}

/**
 * jsonb is only constrained to be an array, so the shape is checked here rather than trusted.
 * A malformed row must not become a score the browser renders as a fact.
 */
function scoreCategories(value: CategoryScore[] | null): CategoryScore[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set<string>(AUDIT_CATEGORIES);
  const cleaned: CategoryScore[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!known.has(entry.category)) continue;
    if (typeof entry.weight !== "number") continue;
    if (entry.score !== null && typeof entry.score !== "number") continue;
    cleaned.push({ category: entry.category, score: entry.score, weight: entry.weight });
  }
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * `ai_status` is constrained by the database, but a value this build does not know (an older
 * row, a newer migration) must not become a claim. Anything unrecognised reads as `skipped`.
 */
function aiStatus(value: string): "ok" | "unavailable" | "skipped" {
  return value === "ok" || value === "unavailable" ? value : "skipped";
}

/** A stored summary is re-validated on the way out, exactly as a score is. */
function auditSummary(value: unknown): AuditSummaryOutput | null {
  const parsed = auditSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The same for one finding's explanation: a malformed block is dropped, not rendered. */
function explanation(value: unknown): AIRecommendationOutput | null {
  if (value === null || value === undefined) return null;
  const parsed = aiRecommendationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const METRIC_STATUSES = ["ok", "unavailable", "partial"] as const;
const METRICS_STATUSES = ["ok", "partial", "unavailable", "skipped"] as const;

function oneOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function toMetricView(row: MetricRow): MetricView {
  return {
    id: row.id,
    category: row.category,
    metricKey: row.metric_key,
    label: row.label,
    value: row.value,
    unit: row.unit,
    source: row.source,
    status: oneOf(METRIC_STATUSES, row.status, "unavailable"),
    strategy: row.strategy,
    reason: row.reason,
  };
}

export function toFindingView(row: FindingRow): FindingView {
  return {
    id: row.id,
    issueCode: row.issue_code,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    recommendation: row.recommendation,
    pageUrl: row.page?.url ?? null,
    aiExplanation: explanation(row.ai_explanation),
  };
}

/** Severity order for a list a person reads: worst first, then stable by issue code. */
export function bySeverity(a: FindingRow, b: FindingRow): number {
  const rank = (value: string): number => {
    const index = SEVERITIES.indexOf(value as (typeof SEVERITIES)[number]);
    return index === -1 ? SEVERITIES.length : index;
  };
  return rank(a.severity) - rank(b.severity) || a.issue_code.localeCompare(b.issue_code);
}

export function toAuditView(row: AuditRow): AuditView {
  const code = row.error_code ?? (row.error_message === null ? null : "internal_error");
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    clientName: row.client_name,
    projectName: row.project_name,
    status: row.status,
    stage: row.stage,
    maxPages: row.max_pages,
    pagesScanned: row.pages_scanned,
    partial: row.was_partial,
    overallScore: row.overall_score,
    categoryScores: scoreCategories(row.category_scores),
    metrics: {
      status: oneOf(METRICS_STATUSES, row.metrics_status, "skipped"),
      reason: row.metrics_reason,
      strategy: row.metrics_strategy,
      providerVersion: row.metrics_provider_version,
      measuredAt: row.metrics_measured_at,
    },
    ai: {
      status: aiStatus(row.ai_status),
      model: row.ai_model,
      summary: row.ai_summary === null ? null : auditSummary(row.ai_summary),
    },
    error: code === null ? null : { code, message: publicAuditFailureMessage(code) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
