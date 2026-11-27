/**
 * The steps a real audit runs: crawl → rules → score → explain → persist (TRD §6).
 *
 * The order matters in two places:
 *
 *  - **Scoring before explaining.** The summary the model writes may mention the score, and the
 *    score must exist before anything can describe it. Scoring no longer finishes the audit, so
 *    the AI step cannot be mistaken for the part that decides the outcome.
 *  - **Explaining before persisting.** A provider that is slow or down delays the audit, never
 *    changes it: `explain` records what it got and the audit finishes either way.
 *
 * The PageSpeed provider (Phase 8) slots in between `rules` and `scoring`, which is why scoring
 * reads the rules outcome rather than re-running anything.
 */

import { crawlSite, toPageRows, type CrawlOptions, type CrawlSummary } from "@siteaudit/crawler";
import { runRules, scoreAudit, type RuleOutcome, type ScoreResult } from "@siteaudit/audit-rules";
import { explainAudit, type AiProvider, type ExplanationFinding } from "@siteaudit/ai-explain";

import type { WorkerData } from "./data.js";
import { toFindingRows } from "./finding-rows.js";
import { FatalScanError, type ScanContext, type ScanStep } from "./pipeline.js";

const CRAWL_KEY = "crawl";
const RULES_KEY = "rules";
const SCORES_KEY = "scores";
const PAGE_IDS_KEY = "pageIds";

export interface AiStepOptions {
  readonly provider: AiProvider;
  readonly model: string;
  readonly timeoutMs?: number;
}

export interface ScanStepsDeps {
  readonly data: WorkerData;
  /**
   * The crawler, injectable for the same reason `resolveTarget` is: a test must be able to point
   * an audit at a local fixture server without loosening the shipped address policy.
   */
  readonly crawl?: (options: CrawlOptions) => Promise<CrawlSummary>;
  /**
   * Absent when no `LLM_API_KEY` is configured. The `ai` step then leaves the audit's
   * `ai_status` at its default `skipped` and the report says there are no explanations.
   */
  readonly ai?: AiStepOptions;
}

function requireState<T>(context: ScanContext, key: string): T {
  const value = context.state.get(key);
  if (value === undefined) {
    // Only reachable if the step list is assembled wrongly, which is our bug, not the site's.
    throw new FatalScanError("internal_error", `run state is missing ${key}`);
  }
  return value as T;
}

/** The path of a page, because the model has no use for a query string and no right to it. */
function pagePath(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function createScanSteps(deps: ScanStepsDeps): readonly ScanStep[] {
  const crawl = deps.crawl ?? crawlSite;

  const crawling: ScanStep = {
    stage: "crawling",
    async run(context: ScanContext) {
      const summary = await crawl({
        startUrl: context.audit.url,
        // The audit's own allowance, which the API already capped at the plan limit.
        maxPages: context.audit.max_pages,
        crawlLimits: { maxPages: context.audit.max_pages },
        signal: context.signal,
      });

      const startPage = summary.pages.find((page) => page.depth === 0);
      if (startPage === undefined || startPage.parsed === null) {
        // The page the user named could not be read. Nothing else was measured, and no rules can
        // be run on a site we never saw: this is the target's failure, not ours, and not retried.
        throw new FatalScanError("target_unreachable", "the start page could not be read");
      }

      const pageIdByUrl = await deps.data.savePages(
        context.audit.id,
        toPageRows(context.audit.id, summary.pages),
      );

      await deps.data
        .recordUsage({
          userId: context.audit.user_id,
          auditId: context.audit.id,
          kind: "page",
          quantity: summary.pages.length,
        })
        // The meter is not allowed to fail a scan that already did the work.
        .catch(() => undefined);

      context.state.set(CRAWL_KEY, summary);
      context.state.set(PAGE_IDS_KEY, pageIdByUrl);
      return "continue";
    },
  };

  const rules: ScanStep = {
    stage: "rules",
    async run(context: ScanContext) {
      const summary = requireState<CrawlSummary>(context, CRAWL_KEY);
      const outcome = runRules({
        startUrl: context.audit.url,
        crawl: summary,
        // Declared counts as present: a sitemap we could not read is a finding of its own, but it
        // is not the same defect as never having published one.
        hasSitemap: summary.sitemapUrls > 0 || summary.robots.sitemaps.length > 0,
      });

      await deps.data.saveFindings(
        context.audit.id,
        toFindingRows(
          context.audit.id,
          outcome.findings,
          requireState<Map<string, string>>(context, PAGE_IDS_KEY),
        ),
      );

      context.state.set(RULES_KEY, outcome);
      return "continue";
    },
  };

  const scoring: ScanStep = {
    stage: "scoring",
    async run(context: ScanContext) {
      const outcome = requireState<RuleOutcome>(context, RULES_KEY);

      const scores = scoreAudit({ findings: outcome.findings, evaluated: outcome.evaluated });
      if (scores.overall === null) {
        // No category was evaluated, so there is no score to show. That is not a 0.
        throw new FatalScanError("internal_error", "no category could be scored");
      }

      await deps.data.saveScores(context.audit.id, scores);
      context.state.set(SCORES_KEY, scores);
      return "continue";
    },
  };

  const ai: ScanStep = {
    stage: "ai",
    async run(context: ScanContext) {
      const options = deps.ai;
      if (options === undefined) {
        // No key configured: nothing is claimed, and `ai_status` stays `skipped`.
        return "continue";
      }

      const outcome = requireState<RuleOutcome>(context, RULES_KEY);
      const scores = requireState<ScoreResult>(context, SCORES_KEY);
      const summary = requireState<CrawlSummary>(context, CRAWL_KEY);

      const findings: ExplanationFinding[] = outcome.findings.map((finding) => ({
        issueCode: finding.issueCode,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        evidence: finding.evidence,
        pagePath: pagePath(finding.pageUrl),
      }));

      const result = await explainAudit(
        {
          host: context.audit.host,
          overallScore: scores.overall,
          categoryScores: scores.categories,
          findings,
          pagesScanned: summary.pages.filter((page) => page.parsed !== null).length,
          pagesUnreadable: summary.pages.filter((page) => page.parsed === null).length,
        },
        {
          provider: options.provider,
          model: options.model,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        },
      );

      if (result.status !== "ok") {
        // The audit is unaffected: findings and score are already written. A report will say the
        // explanations are unavailable rather than leaving a blank section that implies none.
        await deps.data.markAiUnavailable(context.audit.id);
        context.state.set("aiFailure", result.reason);
        return "continue";
      }

      await deps.data.saveExplanations(context.audit.id, {
        model: result.model,
        summary: result.summary,
        recommendations: result.recommendations,
      });

      await deps.data
        .recordUsage({
          userId: context.audit.user_id,
          auditId: context.audit.id,
          kind: "ai_token",
          quantity: result.usage.inputTokens + result.usage.outputTokens,
        })
        .catch(() => undefined);

      return "continue";
    },
  };

  const persisting: ScanStep = {
    stage: "persisting",
    async run(context: ScanContext) {
      const summary = requireState<CrawlSummary>(context, CRAWL_KEY);
      const pagesScanned = summary.pages.filter((page) => page.parsed !== null).length;
      const somePagesFailed = summary.pages.some((page) => page.error !== null);
      return {
        // A page we could not read makes the totals cover only part of the site (TRD §6).
        status: somePagesFailed ? "partial" : "completed",
        pagesScanned,
      };
    },
  };

  return [crawling, rules, scoring, ai, persisting];
}
