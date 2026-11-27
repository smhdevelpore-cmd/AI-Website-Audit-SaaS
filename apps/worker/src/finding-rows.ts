/**
 * Rule findings as `audit_findings` rows.
 *
 * The mapping lives next to the pipeline, not in the rules package, for the same reason
 * `toPageRows` lives in the crawler: a rule knows what it found, the database knows what a row
 * looks like, and one file owns the translation between them.
 *
 * `page_id` is resolved from the crawl's own page rows rather than re-deriving a URL from the
 * finding: a finding names a URL, a row names a page, and the page row is the one that proved we
 * fetched it.
 */

import type { RuleFinding } from "@siteaudit/audit-rules";

export interface NewFindingRow {
  readonly audit_id: string;
  readonly page_id: string | null;
  readonly issue_code: string;
  readonly category: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly recommendation: string | null;
  readonly source: "rule";
  readonly confidence: string;
}

export function toFindingRows(
  auditId: string,
  findings: readonly RuleFinding[],
  pageIdByUrl: ReadonlyMap<string, string>,
): NewFindingRow[] {
  return findings.map((finding) => ({
    audit_id: auditId,
    page_id: finding.pageUrl === null ? null : (pageIdByUrl.get(finding.pageUrl) ?? null),
    issue_code: finding.issueCode,
    category: finding.category,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    evidence: finding.evidence,
    recommendation: finding.recommendation === "" ? null : finding.recommendation,
    source: "rule",
    confidence: finding.confidence,
  }));
}
