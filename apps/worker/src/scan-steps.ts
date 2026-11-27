/**
 * The steps a real audit runs: crawl → rules → score (TRD §6).
 *
 * The order is the TRD's, minus the modules that do not exist yet: the PageSpeed provider
 * (Phase 7) and the AI explanation (Phase 7) slot in after `rules` and before `scoring`, which is
 * why scoring reads the *rules outcome* rather than re-running anything.
 *
 * The state hand-off deserves a note. `crawling` produces a `CrawlSummary` that `rules` needs whole
 * — every page's parsed data, not only the row shape. It travels in `context.state`, which the
 * runner creates per job: nothing is written to the database and read back, and nothing outlives
 * the run. A retry starts from an empty map and a fresh crawl, which is the only correct starting
 * point for a scan.
 */

import { crawlSite, toPageRows, type CrawlOptions, type CrawlSummary } from "@siteaudit/crawler";
import { runRules, scoreAudit, type RuleOutcome } from "@siteaudit/audit-rules";

import type { WorkerData } from "./data.js";
import { toFindingRows } from "./finding-rows.js";
import { FatalScanError, type ScanContext, type ScanStep } from "./pipeline.js";

const CRAWL_KEY = "crawl";
const RULES_KEY = "rules";
const PAGE_IDS_KEY = "pageIds";

export interface ScanStepsDeps {
  readonly data: WorkerData;
  /**
   * The crawler, injectable for the same reason `resolveTarget` is: a test must be able to point
   * an audit at a local fixture server without loosening the shipped address policy.
   */
  readonly crawl?: (options: CrawlOptions) => Promise<CrawlSummary>;
}

function requireState<T>(context: ScanContext, key: string): T {
  const value = context.state.get(key);
  if (value === undefined) {
    // Only reachable if the step list is assembled wrongly, which is our bug, not the site's.
    throw new FatalScanError("internal_error", `run state is missing ${key}`);
  }
  return value as T;
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
      const summary = requireState<CrawlSummary>(context, CRAWL_KEY);

      const scores = scoreAudit({ findings: outcome.findings, evaluated: outcome.evaluated });
      if (scores.overall === null) {
        // No category was evaluated, so there is no score to show. That is not a 0.
        throw new FatalScanError("internal_error", "no category could be scored");
      }

      await deps.data.saveScores(context.audit.id, scores);

      const pagesScanned = summary.pages.filter((page) => page.parsed !== null).length;
      const somePagesFailed = summary.pages.some((page) => page.error !== null);
      return {
        // A page we could not read makes the totals cover only part of the site (TRD §6).
        status: somePagesFailed ? "partial" : "completed",
        pagesScanned,
      };
    },
  };

  return [crawling, rules, scoring];
}
