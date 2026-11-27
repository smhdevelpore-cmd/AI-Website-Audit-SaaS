/**
 * An in-memory `WorkerData` that mirrors the SQL conditions in `apps/worker/src/data.ts`.
 *
 * The conditions are the point: `markRunning` only moves a queued/running row, `finish` only
 * writes while `completed_at` is null, `setStage` only while running. A fake that skipped those
 * checks would let a test pass on behaviour the real worker does not have.
 */

import type { AuditPageRow } from "@siteaudit/crawler";
import type { ScoreResult } from "@siteaudit/audit-rules";
import { publicAuditFailureMessage, type AuditStage, type UsageKind } from "@siteaudit/shared-types";

import type { AuditFinish, WorkerAudit, WorkerData } from "../../apps/worker/src/data.js";
import type { NewFindingRow } from "../../apps/worker/src/finding-rows.js";
import type { ExplanationRows } from "../../apps/worker/src/data.js";
import type { AIRecommendationOutput } from "@siteaudit/validation";
import type { InMemoryUserData } from "./audit-store.js";

export interface RecordedUsage {
  readonly userId: string;
  readonly auditId: string;
  readonly kind: UsageKind;
  readonly quantity: number;
}

export class InMemoryWorkerData implements WorkerData {
  readonly usage: RecordedUsage[] = [];
  readonly stages: Array<{ auditId: string; stage: AuditStage }> = [];
  /** Writes that the SQL would have refused, kept so a test can assert nothing happened. */
  readonly refused: string[] = [];
  /** Pages, findings and scores as written, keyed by audit id. */
  readonly pages = new Map<string, AuditPageRow[]>();
  readonly findings = new Map<string, NewFindingRow[]>();
  readonly scores = new Map<string, ScoreResult>();
  /** What the AI step wrote, per audit. Absent means the step produced nothing for it. */
  readonly explanations = new Map<string, ExplanationRows>();
  readonly aiUnavailable: string[] = [];
  readonly findingExplanations = new Map<string, AIRecommendationOutput>();

  /** Set to make the next `loadAudit` (and only that call) throw, to simulate a DB blip. */
  failNextLoad = false;

  constructor(private readonly store: InMemoryUserData) {}

  async loadAudit(auditId: string): Promise<WorkerAudit | null> {
    if (this.failNextLoad) {
      this.failNextLoad = false;
      throw new Error("database unavailable");
    }
    const row = this.store.audits.get(auditId);
    if (row === undefined) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      url: row.url,
      host: row.host,
      status: row.status,
      stage: row.stage,
      max_pages: row.max_pages,
      started_at: row.started_at,
    };
  }

  async markRunning(auditId: string, stage: AuditStage, options: { fresh: boolean }): Promise<boolean> {
    const row = this.store.audits.get(auditId);
    if (row === undefined || (row.status !== "queued" && row.status !== "running")) {
      this.refused.push(`markRunning:${auditId}`);
      return false;
    }
    this.store.audits.set(auditId, {
      ...row,
      status: "running",
      stage,
      started_at: options.fresh ? new Date().toISOString() : row.started_at,
    });
    return true;
  }

  async setStage(auditId: string, stage: AuditStage): Promise<void> {
    const row = this.store.audits.get(auditId);
    if (row === undefined || row.status !== "running") {
      this.refused.push(`setStage:${auditId}`);
      return;
    }
    this.stages.push({ auditId, stage });
    this.store.audits.set(auditId, { ...row, stage });
  }

  async finish(auditId: string, finish: AuditFinish): Promise<void> {
    const row = this.store.audits.get(auditId);
    if (row === undefined || row.completed_at !== null) {
      this.refused.push(`finish:${auditId}`);
      return;
    }
    const completedAt = new Date().toISOString();
    if (finish.status === "failed") {
      this.store.audits.set(auditId, {
        ...row,
        status: "failed",
        completed_at: completedAt,
        error_code: finish.code,
        error_message: publicAuditFailureMessage(finish.code),
      });
      return;
    }
    if (finish.status === "cancelled") {
      this.store.audits.set(auditId, { ...row, status: "cancelled", completed_at: completedAt });
      return;
    }
    this.store.audits.set(auditId, {
      ...row,
      status: finish.status,
      completed_at: completedAt,
      pages_scanned: finish.pagesScanned,
      was_partial: finish.status === "partial",
    });
  }

  async recordUsage(record: RecordedUsage): Promise<void> {
    this.usage.push(record);
  }

  async savePages(auditId: string, rows: readonly AuditPageRow[]): Promise<ReadonlyMap<string, string>> {
    // Mirrors `upsert ... on conflict (audit_id, url)`: a retried crawl replaces its own rows.
    const existing = this.pages.get(auditId) ?? [];
    const byUrl = new Map(existing.map((row) => [row.url, row]));
    for (const row of rows) byUrl.set(row.url, row);
    this.pages.set(auditId, [...byUrl.values()]);

    // The API reads pages through the same store, so a report built after a scan sees them.
    for (const row of rows) this.store.seedPage(auditId, row.url, row.fetch_error);

    const ids = new Map<string, string>();
    for (const row of rows) ids.set(row.url, `page:${row.url}`);
    return ids;
  }

  async saveFindings(auditId: string, rows: readonly NewFindingRow[]): Promise<void> {
    this.findings.set(auditId, [...rows]);
    // Mirrors the insert: the API's `listFindings` reads these same rows, so a report rendered
    // after a scan is built from what the scan wrote, not from a second copy.
    for (const row of rows) {
      this.store.seedFinding(auditId, {
        pageUrl: row.page_id === null ? null : row.page_id.replace(/^page:/, ""),
        issueCode: row.issue_code,
        category: row.category,
        severity: row.severity,
        title: row.title,
        description: row.description,
        evidence: row.evidence,
        recommendation: row.recommendation,
      });
    }
  }

  async saveExplanations(auditId: string, explanations: ExplanationRows): Promise<void> {
    // What the SQL does in one call: the audit's status, model and summary, and one explanation
    // per finding, keyed by issue code.
    const row = this.store.audits.get(auditId);
    if (row !== undefined) {
      this.store.audits.set(auditId, {
        ...row,
        ai_status: "ok",
        ai_model: explanations.model,
        ai_summary: explanations.summary,
      });
      const findings = this.store.findings.get(auditId) ?? [];
      this.store.findings.set(
        auditId,
        findings.map((finding) => {
          const explanation = explanations.recommendations.get(finding.issue_code);
          return explanation === undefined ? finding : { ...finding, ai_explanation: explanation };
        }),
      );
    }

    this.explanations.set(auditId, explanations);
    for (const [issueCode, recommendation] of explanations.recommendations) {
      this.findingExplanations.set(`${auditId}|${issueCode}`, recommendation);
    }
  }

  async markAiUnavailable(auditId: string): Promise<void> {
    this.aiUnavailable.push(auditId);
    this.explanations.delete(auditId);
    const row = this.store.audits.get(auditId);
    if (row !== undefined) {
      this.store.audits.set(auditId, { ...row, ai_status: "unavailable", ai_summary: null });
    }
  }

  async saveScores(auditId: string, scores: ScoreResult): Promise<void> {
    this.scores.set(auditId, scores);
    const row = this.store.audits.get(auditId);
    if (row === undefined || row.completed_at !== null) {
      this.refused.push(`saveScores:${auditId}`);
      return;
    }
    this.store.audits.set(auditId, {
      ...row,
      overall_score: scores.overall,
      category_scores: [...scores.categories],
      scoring_version: scores.scoringVersion,
    });
  }
}
