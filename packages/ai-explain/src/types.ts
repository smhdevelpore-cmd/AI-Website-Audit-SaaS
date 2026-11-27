/**
 * The explanation step's contract (TRD §11, PRD FR-14).
 *
 * AI is allowed to *explain* a finding and to *order* the work. It is not allowed to find one, to
 * measure one, or to change how serious it is. That boundary is enforced three times over:
 *
 *  - `ExplanationFinding` — what goes into the prompt — has no description, no score and no page
 *    text: only the code, the category, the severity we already decided, and the evidence string a
 *    rule produced.
 *  - the response schema (`@siteaudit/validation`) has no numeric field at all, so an invented
 *    metric cannot be represented;
 *  - a recommendation for an issue code that was not in the input is treated as a hallucination
 *    and the whole response is rejected.
 */

import type { AIRecommendationOutput, AuditSummaryOutput } from "@siteaudit/validation";
import type { AuditCategory, CategoryScore, Severity } from "@siteaudit/shared-types";

export interface ExplanationFinding {
  /** Rows are matched back on this code and the page; the code is the anchor. */
  readonly issueCode: string;
  readonly category: AuditCategory;
  readonly severity: Severity;
  readonly title: string;
  /** The evidence a rule recorded. Already bounded by the rule; never page HTML. */
  readonly evidence: string;
  /** Which page, as a path where possible. A URL's query string is not sent. */
  readonly pagePath: string | null;
}

export interface ExplanationInput {
  readonly host: string;
  readonly overallScore: number | null;
  readonly categoryScores: readonly CategoryScore[];
  readonly findings: readonly ExplanationFinding[];
  /** Facts a summary needs to be honest about coverage. */
  readonly pagesScanned: number;
  readonly pagesUnreadable: number;
}

/** One request to a provider. The provider sees nothing else — no key, no audit id, no user. */
export interface AiRequest {
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens: number;
}

/** Returns the model's raw reply: JSON text, which this package validates. */
export type AiProvider = (request: AiRequest, signal: AbortSignal) => Promise<string>;

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type ExplainFailureReason = "provider_error" | "invalid_output" | "timeout" | "no_findings";

export type ExplainResult =
  | {
      readonly status: "ok";
      readonly model: string;
      readonly summary: AuditSummaryOutput;
      /** Keyed by issue code: the same code on ten pages gets one explanation. */
      readonly recommendations: ReadonlyMap<string, AIRecommendationOutput>;
      readonly usage: TokenUsage;
      readonly attempts: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: ExplainFailureReason;
      readonly attempts: number;
      /** For logs only. Never stored on a row and never rendered. */
      readonly detail: string;
    };

/** What the caller must persist when the step succeeds. */
export interface ExplanationPayload {
  readonly model: string;
  readonly summary: AuditSummaryOutput;
  readonly recommendations: ReadonlyMap<string, AIRecommendationOutput>;
  readonly usage: TokenUsage;
}
