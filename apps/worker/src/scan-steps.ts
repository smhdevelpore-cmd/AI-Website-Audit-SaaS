/**
 * The steps a real audit runs: crawl → rules → measure → score → explain → persist (TRD §6).
 *
 * The order matters in three places:
 *
 *  - **Measuring before scoring.** PageSpeed's metrics are stored before the score is written, so a
 *    report can show both and a reader can see which is which. They do **not** feed the score: a
 *    third party's quota must never move a number we claim as ours (see `docs/PROVIDERS.md`).
 *  - **Scoring before explaining.** The summary the model writes may mention the score, and the
 *    score must exist before anything can describe it. Scoring no longer finishes the audit, so
 *    neither the provider nor the model can be mistaken for the part that decides the outcome.
 *  - **Explaining before persisting.** A provider that is slow or down delays the audit, never
 *    changes it: each step records what it got and the audit finishes either way.
 */

import { crawlSite, toPageRows, type CrawlOptions, type CrawlSummary } from "@siteaudit/crawler";
import { runRules, scoreAudit, type RuleOutcome, type ScoreResult } from "@siteaudit/audit-rules";
import { explainAudit, type AiProvider, type ExplanationFinding } from "@siteaudit/ai-explain";
import {
  unavailableReport,
  type PagespeedClient,
  type PagespeedStrategy,
  type ProviderStatus,
} from "@siteaudit/pagespeed";

import type { WorkerData } from "./data.js";
import { toFindingRows } from "./finding-rows.js";
import { FatalScanError, type ScanContext, type ScanStep } from "./pipeline.js";

const CRAWL_KEY = "crawl";
const METRICS_KEY = "metrics";
const RULES_KEY = "rules";
const SCORES_KEY = "scores";
const PAGE_IDS_KEY = "pageIds";

export interface AiStepOptions {
  readonly provider: AiProvider;
  readonly model: string;
  readonly timeoutMs?: number;
}

export interface PagespeedStepOptions {
  readonly client: PagespeedClient;
  readonly strategy?: PagespeedStrategy;
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
  /**
   * Absent when no `PAGESPEED_API_KEY` is configured. The audit's `metrics_status` then stays
   * `skipped`, and the report says performance was measured by our crawl only.
   */
  readonly pagespeed?: PagespeedStepOptions;
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

  const performance: ScanStep = {
    stage: "performance",
    async run(context: ScanContext) {
      const options = deps.pagespeed;
      if (options === undefined) {
        // No key configured: nothing is claimed, and `metrics_status` stays `skipped`.
        return "continue";
      }

      let report;
      try {
        report = await options.client.run(context.audit.url, context.signal);
      } catch (error) {
        // `run` is written not to throw for a provider's bad day. If it does, that is our bug —
        // and an audit must not fail because of it. The metrics are recorded as unavailable.
        console.error("[worker] pagespeed client threw", {
          auditId: context.audit.id,
          error: error instanceof Error ? error.name : "unknown",
        });
        report = unavailableReport("http_error", options.strategy ?? "MOBILE");
      }

      await deps.data.saveMetrics(context.audit.id, report);

      await deps.data
        .recordUsage({
          userId: context.audit.user_id,
          auditId: context.audit.id,
          kind: "provider_call",
          quantity: 1,
        })
        // The meter is not allowed to fail an audit that already got its answer.
        .catch(() => undefined);

      context.state.set(METRICS_KEY, report.status);
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

      // No provider configured at all is not a partial audit: it is an audit without provider
      // metrics, and `metrics_status` already says `skipped`.
      const metrics = context.state.get(METRICS_KEY) as ProviderStatus | undefined;
      const metricsIncomplete = metrics === "unavailable" || metrics === "partial";

      return {
        // A page we could not read, or a provider that did not answer, makes the totals cover only
        // part of what this audit is meant to show (TRD §6). The findings and the score stand.
        status: somePagesFailed || metricsIncomplete ? "partial" : "completed",
        pagesScanned,
      };
    },
  };

  return [crawling, rules, performance, scoring, ai, persisting];
}
