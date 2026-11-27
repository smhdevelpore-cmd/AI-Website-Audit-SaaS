/**
 * An in-memory `UserData` for tests.
 *
 * It is deliberately not a mock library: it implements the real interface with real filtering,
 * sorting, pagination and ownership rules, so a test that passes here is a test of the route's
 * logic rather than of a hand-written return value. The one thing it cannot prove is RLS — that
 * is `tests/integration/rls.test.ts`, against real PostgreSQL.
 *
 * `RLS` in comments below means "what the policy would have done": every method takes the caller
 * id and filters on it, exactly as PostgREST with the caller's token would.
 */

import { publicAuditFailureMessage } from "@siteaudit/shared-types";

import type {
  AuditListQuery,
  AuditListResult,
  AuditRow,
  NewAuditRow,
  ProfilePatch,
  ProfileRow,
  UserData,
} from "../../apps/api/src/data/types.js";

export interface SeedAudit {
  readonly id?: string;
  readonly userId: string;
  readonly url: string;
  readonly status?: string;
  readonly stage?: string | null;
  readonly maxPages?: number;
  readonly createdAt?: string;
  readonly errorCode?: string | null;
  readonly clientName?: string | null;
  readonly projectName?: string | null;
}

export class InMemoryUserData implements UserData {
  readonly profiles = new Map<string, ProfileRow>();
  readonly audits = new Map<string, AuditRow>();
  private clock = 0;

  constructor(readonly now: () => Date = () => new Date()) {}

  /** Distinct, increasing timestamps so "newest first" is never ambiguous in a test. */
  private nextTimestamp(): string {
    this.clock += 1;
    return new Date(this.now().getTime() + this.clock).toISOString();
  }

  addProfile(id: string, name = "Test User"): ProfileRow {
    const createdAt = this.now().toISOString();
    const row: ProfileRow = {
      id,
      name,
      agency_name: null,
      website: null,
      timezone: null,
      logo_url: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.profiles.set(id, row);
    return row;
  }

  seedAudit(seed: SeedAudit): AuditRow {
    const id = seed.id ?? crypto.randomUUID();
    const created = seed.createdAt ?? this.nextTimestamp();
    const status = seed.status ?? "queued";
    const terminal =
      status === "completed" || status === "partial" || status === "failed" || status === "cancelled";
    const row: AuditRow = {
      id,
      user_id: seed.userId,
      url: seed.url,
      host: new URL(seed.url).host,
      client_name: seed.clientName ?? null,
      project_name: seed.projectName ?? null,
      status,
      stage: seed.stage ?? null,
      max_pages: seed.maxPages ?? 25,
      pages_scanned: 0,
      was_partial: false,
      scoring_version: null,
      error_code: seed.errorCode ?? null,
      error_message: seed.errorCode ? publicAuditFailureMessage(seed.errorCode) : null,
      started_at: null,
      completed_at: terminal ? created : null,
      created_at: created,
      updated_at: created,
    };
    this.audits.set(id, row);
    return row;
  }

  /* ------------------------------------------------------------ UserData */

  async findProfile(userId: string): Promise<ProfileRow | null> {
    return this.profiles.get(userId) ?? null;
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow | null> {
    const current = this.profiles.get(userId);
    if (current === undefined) return null;
    const updated = { ...current, ...patch, updated_at: this.nextTimestamp() };
    this.profiles.set(userId, updated);
    return updated;
  }

  async findAudit(auditId: string): Promise<AuditRow | null> {
    return this.audits.get(auditId) ?? null;
  }

  async createAudit(userId: string, input: NewAuditRow): Promise<AuditRow> {
    const created = this.nextTimestamp();
    const row: AuditRow = {
      id: crypto.randomUUID(),
      user_id: userId,
      url: input.url,
      host: input.host,
      client_name: input.clientName,
      project_name: input.projectName,
      status: "queued",
      stage: null,
      max_pages: input.maxPages,
      pages_scanned: 0,
      was_partial: false,
      scoring_version: null,
      error_code: null,
      error_message: null,
      started_at: null,
      completed_at: null,
      created_at: created,
      updated_at: created,
    };
    this.audits.set(row.id, row);
    return row;
  }

  async listAudits(userId: string, query: AuditListQuery): Promise<AuditListResult> {
    const term = query.search?.toLowerCase();
    const matching = [...this.audits.values()]
      .filter((row) => row.user_id === userId) // RLS: `using (user_id = auth.uid())`
      .filter((row) => query.status === undefined || row.status === query.status)
      .filter((row) => {
        if (term === undefined) return true;
        return [row.url, row.host, row.client_name, row.project_name]
          .filter((value): value is string => value !== null)
          .some((value) => value.toLowerCase().includes(term));
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

    const from = (query.page - 1) * query.limit;
    return { rows: matching.slice(from, from + query.limit), total: matching.length };
  }

  async countAuditsSince(userId: string, since: Date): Promise<number> {
    return [...this.audits.values()].filter(
      (row) => row.user_id === userId && row.created_at >= since.toISOString(),
    ).length;
  }

  async findActiveAudit(userId: string, url: string): Promise<AuditRow | null> {
    return (
      [...this.audits.values()].find(
        (row) =>
          row.user_id === userId && row.url === url && (row.status === "queued" || row.status === "running"),
      ) ?? null
    );
  }

  async deleteAudit(auditId: string): Promise<boolean> {
    return this.audits.delete(auditId);
  }

  /** Rows the caller can see, for assertions that read like the question being asked. */
  rowsFor(userId: string): AuditRow[] {
    return [...this.audits.values()].filter((row) => row.user_id === userId);
  }
}
