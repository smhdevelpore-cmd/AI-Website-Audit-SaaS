/**
 * The data access boundary.
 *
 * The API talks to these small interfaces, never to `@supabase/supabase-js` directly. That is
 * what lets the route tests run without a database, and it keeps one rule visible in the type
 * system: every call carries the caller's own token, so RLS — not application code — is what
 * separates tenants.
 */

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
  status: string;
  stage: string | null;
  max_pages: number;
  pages_scanned: number;
  was_partial: boolean;
  scoring_version: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
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
  status: string;
  stage: string | null;
  maxPages: number;
  pagesScanned: number;
  partial: boolean;
  error: { code: string | null; message: string | null } | null;
  createdAt: string;
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

export function toAuditView(row: AuditRow): AuditView {
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    status: row.status,
    stage: row.stage,
    maxPages: row.max_pages,
    pagesScanned: row.pages_scanned,
    partial: row.was_partial,
    error:
      row.error_code === null && row.error_message === null
        ? null
        : { code: row.error_code, message: row.error_message },
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
