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
  FindingRow,
  MetricRow,
  NewAuditRow,
  PageRowSummary,
  ProfilePatch,
  ProfileRow,
  UserData,
} from "../../apps/api/src/data/types.js";

export interface SeedFinding {
  readonly id?: string;
  readonly pageUrl?: string | null;
  readonly issueCode: string;
  readonly category: string;
  readonly severity: string;
  readonly title?: string;
  readonly description?: string;
  readonly evidence?: string;
  readonly recommendation?: string | null;
  readonly aiExplanation?: FindingRow["ai_explanation"];
}

export interface SeedMetric {
  readonly metricKey: string;
  readonly label?: string;
  readonly value: number | null;
  readonly unit?: string;
  readonly status?: string;
  readonly reason?: string | null;
}

export interface SeedAudit {
  readonly id?: string;
  readonly userId: string;
  readonly url: string;
  readonly status?: string;
  readonly stage?: string | null;
  readonly maxPages?: number;
  readonly createdAt?: string;
  readonly errorCode?: string | null;
  readonly overallScore?: number | null;
  readonly clientName?: string | null;
  readonly projectName?: string | null;
  readonly aiStatus?: "ok" | "unavailable" | "skipped";
  readonly metricsStatus?: "ok" | "partial" | "unavailable" | "skipped";
  readonly metricsReason?: string | null;
  readonly metricsStrategy?: string | null;
  readonly metricsProviderVersion?: string | null;
  readonly metricsMeasuredAt?: string | null;
  readonly aiModel?: string | null;
  readonly aiSummary?: AuditRow["ai_summary"];
  readonly categoryScores?: AuditRow["category_scores"];
  readonly scoringVersion?: string | null;
  readonly completedAt?: string | null;
  readonly pagesScanned?: number;
}

export class InMemoryUserData implements UserData {
  readonly profiles = new Map<string, ProfileRow>();
  readonly audits = new Map<string, AuditRow>();
  /** Rows for `audit_findings` and `audit_pages`, keyed by audit id. */
  readonly findings = new Map<string, FindingRow[]>();
  readonly pages = new Map<string, PageRowSummary[]>();
  readonly metrics = new Map<string, MetricRow[]>();
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
      pages_scanned: seed.pagesScanned ?? 0,
      was_partial: false,
      scoring_version: seed.scoringVersion ?? null,
      overall_score: seed.overallScore ?? null,
      category_scores: seed.categoryScores ?? null,
      error_code: seed.errorCode ?? null,
      error_message: seed.errorCode ? publicAuditFailureMessage(seed.errorCode) : null,
      ai_status: seed.aiStatus ?? "skipped",
      ai_model: seed.aiModel ?? null,
      ai_summary: seed.aiSummary ?? null,
      metrics_status: seed.metricsStatus ?? "skipped",
      metrics_reason: seed.metricsReason ?? null,
      metrics_strategy: seed.metricsStrategy ?? null,
      metrics_provider_version: seed.metricsProviderVersion ?? null,
      metrics_measured_at: seed.metricsMeasuredAt ?? null,
      started_at: null,
      completed_at: seed.completedAt ?? (terminal ? created : null),
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
      // `createAudit` inserts a queued row: nothing has been measured and nothing explained.
      pages_scanned: 0,
      was_partial: false,
      scoring_version: null,
      overall_score: null,
      category_scores: null,
      error_code: null,
      error_message: null,
      ai_status: "skipped",
      ai_model: null,
      ai_summary: null,
      metrics_status: "skipped",
      metrics_reason: null,
      metrics_strategy: null,
      metrics_provider_version: null,
      metrics_measured_at: null,
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

  /** Seeds one finding, and the page row it belongs to when a URL is named. */
  seedFinding(auditId: string, seed: SeedFinding): FindingRow {
    const pageUrl = seed.pageUrl ?? null;
    if (pageUrl !== null) {
      const pages = this.pages.get(auditId) ?? [];
      if (!pages.some((page) => page.url === pageUrl)) {
        pages.push({ url: pageUrl, fetch_error: null });
        this.pages.set(auditId, pages);
      }
    }
    const row: FindingRow = {
      id: seed.id ?? crypto.randomUUID(),
      audit_id: auditId,
      page_id: pageUrl === null ? null : `page:${pageUrl}`,
      issue_code: seed.issueCode,
      category: seed.category,
      severity: seed.severity,
      title: seed.title ?? `${seed.issueCode} on ${pageUrl ?? "the site"}`,
      description: seed.description ?? "A description of the defect.",
      evidence: seed.evidence ?? "The evidence the rule observed.",
      recommendation: seed.recommendation ?? "A deterministic recommendation.",
      source: "rule",
      status: "open",
      ai_explanation: seed.aiExplanation ?? null,
      page: pageUrl === null ? null : { url: pageUrl },
    };
    this.findings.set(auditId, [...(this.findings.get(auditId) ?? []), row]);
    return row;
  }

  seedPage(auditId: string, url: string, fetchError: string | null = null): void {
    const pages = this.pages.get(auditId) ?? [];
    pages.push({ url, fetch_error: fetchError });
    this.pages.set(auditId, pages);
  }

  async listFindings(auditId: string): Promise<readonly FindingRow[]> {
    // RLS: findings are visible through their audit, so an audit the caller cannot see has none.
    return this.findings.get(auditId) ?? [];
  }

  async listPageSummaries(auditId: string): Promise<readonly PageRowSummary[]> {
    return this.pages.get(auditId) ?? [];
  }

  /** Seeds one stored measurement. `value: null` with a status is the "no number" case. */
  seedMetric(auditId: string, seed: SeedMetric): MetricRow {
    const row: MetricRow = {
      id: crypto.randomUUID(),
      audit_id: auditId,
      page_id: null,
      category: "performance",
      metric_key: seed.metricKey,
      label: seed.label ?? seed.metricKey,
      value: seed.value,
      unit: seed.unit ?? "ms",
      source: "pagespeed",
      status: seed.status ?? (seed.value === null ? "unavailable" : "ok"),
      strategy: "MOBILE",
      provider_version: "12.6.0",
      measured_at: "2026-11-27T09:59:00.000Z",
      reason: seed.reason ?? null,
    };
    this.metrics.set(auditId, [...(this.metrics.get(auditId) ?? []), row]);
    return row;
  }

  async listMetrics(auditId: string): Promise<readonly MetricRow[]> {
    // The SQL orders by (category, metric_key); a fake that returned insertion order would let a
    // test pass on an ordering the API does not produce.
    return [...(this.metrics.get(auditId) ?? [])].sort(
      (a, b) => a.category.localeCompare(b.category) || a.metric_key.localeCompare(b.metric_key),
    );
  }

  /** Rows the caller can see, for assertions that read like the question being asked. */
  rowsFor(userId: string): AuditRow[] {
    return [...this.audits.values()].filter((row) => row.user_id === userId);
  }
}
