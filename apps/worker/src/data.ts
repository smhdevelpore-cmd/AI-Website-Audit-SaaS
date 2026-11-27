/**
 * The worker's data boundary.
 *
 * This is the only process that holds the service-role key, and it holds it for one reason: a
 * worker must be able to update rows that no user may update. RLS grants `authenticated` exactly
 * `select`, `insert (queued, own)` and `delete (own)` on audits — there is deliberately no update
 * policy, so a client can never relabel a failed audit as a completed one.
 *
 * Every write is conditional. A worker that restarts mid-scan, a retried job, and a user who
 * cancelled two seconds ago all produce the same situation: the row may no longer be in the state
 * this process believes it is. The condition is in the SQL, not in a preceding read.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AuditPageRow } from "@siteaudit/crawler";
import type { ScoreResult } from "@siteaudit/audit-rules";
import type { NewFindingRow } from "./finding-rows.js";

import {
  publicAuditFailureMessage,
  type AuditFailureCode,
  type AuditStage,
  type UsageKind,
} from "@siteaudit/shared-types";

export interface WorkerAudit {
  readonly id: string;
  readonly user_id: string;
  readonly url: string;
  readonly host: string;
  readonly status: string;
  readonly stage: string | null;
  readonly max_pages: number;
  readonly started_at: string | null;
}

export type AuditFinish =
  | { readonly status: "failed"; readonly code: AuditFailureCode }
  | { readonly status: "cancelled" }
  | { readonly status: "completed" | "partial"; readonly pagesScanned: number };

export interface WorkerData {
  loadAudit(auditId: string): Promise<WorkerAudit | null>;
  /**
   * `queued → running`. Returns false when the row is no longer queued or running (cancelled or
   * deleted between enqueue and pickup), which is a skip, not an error.
   */
  markRunning(auditId: string, stage: AuditStage, options: { readonly fresh: boolean }): Promise<boolean>;
  /** Only moves a stage while the audit is running; a finished audit keeps its last stage. */
  setStage(auditId: string, stage: AuditStage): Promise<void>;
  /** Writes a terminal status once. A second call is a no-op. */
  finish(auditId: string, finish: AuditFinish): Promise<void>;
  recordUsage(record: {
    readonly userId: string;
    readonly auditId: string;
    readonly kind: UsageKind;
    readonly quantity: number;
  }): Promise<void>;
  /**
   * Writes the pages a crawl produced and returns their database ids by URL.
   *
   * Findings reference a page row, so ids have to come back from the same write that created
   * them. Upsert on `(audit_id, url)` makes a retried crawl overwrite its own rows instead of
   * failing on the unique constraint.
   */
  savePages(auditId: string, rows: readonly AuditPageRow[]): Promise<ReadonlyMap<string, string>>;
  /**
   * Replaces this audit's findings. The delete is not laziness: a retry must not leave the
   * findings of the attempt that crashed next to the ones that succeeded.
   */
  saveFindings(auditId: string, rows: readonly NewFindingRow[]): Promise<void>;
  /** Stores the score and the version of the formula that produced it, before the audit finishes. */
  saveScores(auditId: string, scores: ScoreResult): Promise<void>;
}

const AUDIT_COLUMNS = "id,user_id,url,host,status,stage,max_pages,started_at";

function failurePayload(finish: AuditFinish, now: Date): Record<string, unknown> {
  const completed_at = now.toISOString();
  if (finish.status === "failed") {
    return {
      status: "failed",
      completed_at,
      error_code: finish.code,
      // Generated from the code, never carried from an exception: this string is rendered.
      error_message: publicAuditFailureMessage(finish.code),
    };
  }
  if (finish.status === "cancelled") {
    return { status: "cancelled", completed_at, error_code: null, error_message: null };
  }
  return {
    status: finish.status,
    completed_at,
    was_partial: finish.status === "partial",
    pages_scanned: finish.pagesScanned,
    error_code: null,
    error_message: null,
  };
}

export interface SupabaseWorkerDataOptions {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export function createSupabaseWorkerData(options: SupabaseWorkerDataOptions): WorkerData {
  const now = options.now ?? (() => new Date());
  const client: SupabaseClient = createClient(options.url, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(options.fetch === undefined ? {} : { global: { fetch: options.fetch } }),
  });

  function failed(operation: string, error: { message: string } | null): never {
    throw new Error(`${operation} failed: ${error?.message ?? "unknown error"}`);
  }

  return {
    async loadAudit(auditId) {
      const { data, error } = await client
        .from("audits")
        .select(AUDIT_COLUMNS)
        .eq("id", auditId)
        .maybeSingle<WorkerAudit>();
      if (error) failed("audits.load", error);
      return data ?? null;
    },

    async markRunning(auditId, stage, { fresh }) {
      const patch: Record<string, unknown> = { status: "running", stage };
      if (fresh) patch["started_at"] = now().toISOString();

      const { data, error } = await client
        .from("audits")
        .update(patch)
        .eq("id", auditId)
        .in("status", ["queued", "running"])
        .select("id");
      if (error) failed("audits.markRunning", error);
      return (data ?? []).length > 0;
    },

    async setStage(auditId, stage) {
      const { error } = await client
        .from("audits")
        .update({ stage })
        .eq("id", auditId)
        .eq("status", "running");
      if (error) failed("audits.setStage", error);
    },

    async finish(auditId, finish) {
      const { error } = await client
        .from("audits")
        .update(failurePayload(finish, now()))
        .eq("id", auditId)
        // Terminal once. A retried job or a late timer cannot rewrite a finished audit.
        .is("completed_at", null)
        .in("status", ["queued", "running"]);
      if (error) failed("audits.finish", error);
    },

    async savePages(auditId, rows) {
      if (rows.length === 0) return new Map<string, string>();
      const { data, error } = await client
        .from("audit_pages")
        .upsert(
          rows.map((row) => ({ ...row, audit_id: auditId })),
          { onConflict: "audit_id,url" },
        )
        .select("id,url");
      if (error) failed("audit_pages.upsert", error);

      const ids = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ id: string; url: string }>) ids.set(row.url, row.id);
      return ids;
    },

    async saveFindings(auditId, rows) {
      const { error: deleteError } = await client.from("audit_findings").delete().eq("audit_id", auditId);
      if (deleteError) failed("audit_findings.delete", deleteError);
      if (rows.length === 0) return;

      // PostgREST has a request-size ceiling; a 25-page audit is a few hundred rows at most, but
      // chunking keeps a large crawl from turning into one oversized statement.
      for (let index = 0; index < rows.length; index += 200) {
        const chunk = rows.slice(index, index + 200).map((row) => ({ ...row, audit_id: auditId }));
        const { error } = await client.from("audit_findings").insert(chunk);
        if (error) failed("audit_findings.insert", error);
      }
    },

    async saveScores(auditId, scores) {
      const { error } = await client
        .from("audits")
        .update({
          overall_score: scores.overall,
          category_scores: scores.categories,
          scoring_version: scores.scoringVersion,
        })
        .eq("id", auditId)
        .in("status", ["running", "queued"]);
      if (error) failed("audits.saveScores", error);
    },

    async recordUsage({ userId, auditId, kind, quantity }) {
      const { error } = await client
        .from("usage_records")
        .insert({ user_id: userId, audit_id: auditId, kind, quantity });
      if (error) failed("usage_records.insert", error);
    },
  };
}
