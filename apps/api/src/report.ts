/**
 * Turning stored rows into a document (PRD FR-15, TRD §12).
 *
 * This module is the whole join between the database and the renderer, and it is deliberately
 * small: read the audit, its findings and its pages, map them to the report's input, render. Every
 * number in the PDF therefore comes from a row — nothing is recomputed from the site, and nothing
 * is fetched.
 *
 * A finding whose category or severity the database would not have accepted is skipped rather than
 * guessed at: `audit_findings` has check constraints on both columns, so the branch is unreachable,
 * and inventing a value would be worse than the impossible.
 */

import { AUDIT_CATEGORIES, SEVERITIES, type AuditCategory, type Severity } from "@siteaudit/shared-types";
import {
  buildReportSnapshot,
  renderReportPdf,
  type ReportFinding,
  type ReportSnapshot,
} from "@siteaudit/report-template";

import type { AuditRow, UserData } from "./data/types.js";

const CATEGORY_SET = new Set<string>(AUDIT_CATEGORIES);
const SEVERITY_SET = new Set<string>(SEVERITIES);

export interface ReportInputs {
  readonly data: UserData;
  readonly audit: AuditRow;
  readonly agencyName: string | null;
  readonly now?: Date;
}

/** Builds the snapshot from stored rows only. Exported so a test can assert the numbers. */
export async function buildAuditSnapshot(inputs: ReportInputs): Promise<ReportSnapshot> {
  const findings = await inputs.data.listFindings(inputs.audit.id);
  const pages = await inputs.data.listPageSummaries(inputs.audit.id);

  const mapped: ReportFinding[] = [];
  for (const row of findings) {
    if (!CATEGORY_SET.has(row.category) || !SEVERITY_SET.has(row.severity)) continue;
    mapped.push({
      issueCode: row.issue_code,
      category: row.category as AuditCategory,
      severity: row.severity as Severity,
      title: row.title,
      description: row.description,
      evidence: row.evidence,
      recommendation: row.recommendation,
      pageUrl: row.page?.url ?? null,
      aiExplanation: row.ai_explanation,
    });
  }

  return buildReportSnapshot(
    {
      audit: {
        id: inputs.audit.id,
        url: inputs.audit.url,
        host: inputs.audit.host,
        status: inputs.audit.status,
        createdAt: inputs.audit.created_at,
        startedAt: inputs.audit.started_at,
        completedAt: inputs.audit.completed_at,
        pagesScanned: inputs.audit.pages_scanned,
        partial: inputs.audit.was_partial,
        overallScore: inputs.audit.overall_score,
        categoryScores: inputs.audit.category_scores,
        scoringVersion: inputs.audit.scoring_version,
        aiStatus:
          inputs.audit.ai_status === "ok" || inputs.audit.ai_status === "unavailable"
            ? inputs.audit.ai_status
            : "skipped",
        aiModel: inputs.audit.ai_model,
        aiSummary: inputs.audit.ai_summary,
      },
      findings: mapped,
      // Requested vs unreadable: the difference between a page we did not try and one we failed
      // to read, which is what a limitation has to state.
      pagesAttempted: Math.max(pages.length, inputs.audit.pages_scanned),
      pagesUnreadable: pages.filter((page) => page.fetch_error !== null).length,
      branding: { agencyName: inputs.agencyName },
      rulesVersion: null,
    },
    inputs.now === undefined ? {} : { now: inputs.now },
  );
}

export async function buildAuditReport(inputs: ReportInputs): Promise<Uint8Array> {
  const snapshot = await buildAuditSnapshot(inputs);
  return renderReportPdf(snapshot, inputs.now === undefined ? {} : { now: inputs.now });
}

/**
 * A download name built from the host and the audit date. The host is user-influenced data, so
 * everything but letters, digits and dots is replaced: a quote or a newline in a
 * `Content-Disposition` header is how response splitting starts.
 */
export function reportFilename(host: string, completedAt: string | null): string {
  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, "-").slice(0, 80) || "site";
  const date = (completedAt ?? new Date(0).toISOString()).slice(0, 10);
  return `audit-${safeHost}-${date}.pdf`;
}
