/**
 * The data access boundary.
 *
 * The API talks to these small interfaces, never to `@supabase/supabase-js` directly. That is
 * what lets the route tests run without a database, and it keeps one rule visible in the type
 * system: every call carries the caller's own token, so RLS — not application code — is what
 * separates tenants.
 */

import { AUDIT_CATEGORIES, publicAuditFailureMessage, type CategoryScore } from "@siteaudit/shared-types";

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
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
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
    error: code === null ? null : { code, message: publicAuditFailureMessage(code) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
