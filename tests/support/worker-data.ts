/**
 * An in-memory `WorkerData` that mirrors the SQL conditions in `apps/worker/src/data.ts`.
 *
 * The conditions are the point: `markRunning` only moves a queued/running row, `finish` only
 * writes while `completed_at` is null, `setStage` only while running. A fake that skipped those
 * checks would let a test pass on behaviour the real worker does not have.
 */

import { publicAuditFailureMessage, type AuditStage, type UsageKind } from "@siteaudit/shared-types";

import type { AuditFinish, WorkerAudit, WorkerData } from "../../apps/worker/src/data.js";
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
}
