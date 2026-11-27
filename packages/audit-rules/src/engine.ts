/**
 * The rule engine (TRD §8).
 *
 * Takes one crawl and returns the findings a reviewer can act on. It is a pure function of the
 * crawl: same pages, same rules, same findings, same order. Nothing here reads the clock, the
 * network or the database.
 *
 * Two things the engine guarantees and its callers rely on:
 *
 *  - **A rule only speaks for its own code.** A rule that emits a finding with a different
 *    `issueCode` is a bug, and it throws rather than writing a mislabelled row.
 *  - **`evaluated` is not `found something`.** A category is evaluated when a rule of that category
 *    *ran*, even if it raised no finding. That is the difference between "we checked and it is
 *    clean" (score 100) and "we did not check" (N/A), and scoring depends on it.
 */

import type { CrawlSummary } from "@siteaudit/crawler";
import { AUDIT_CATEGORIES, SEVERITIES, type AuditCategory } from "@siteaudit/shared-types";

import { ACCESSIBILITY_RULES } from "./rules/accessibility.js";
import { LINKS_RULES } from "./rules/links.js";
import { MOBILE_RULES } from "./rules/mobile.js";
import { PERFORMANCE_RULES } from "./rules/performance.js";
import { SECURITY_RULES } from "./rules/security.js";
import { SEO_RULES } from "./rules/seo.js";
import { TECHNICAL_RULES } from "./rules/technical.js";
import type { AuditRule, PageAuditContext, RuleFinding, SiteFacts } from "./types.js";

/**
 * The catalogue. Order is stable and is the order the engine tries rules in; a report lists
 * findings by category and severity, not by the order they happened to be discovered.
 */
export const RULES: readonly AuditRule[] = [
  ...SEO_RULES,
  ...TECHNICAL_RULES,
  ...PERFORMANCE_RULES,
  ...MOBILE_RULES,
  ...ACCESSIBILITY_RULES,
  ...SECURITY_RULES,
  ...LINKS_RULES,
];

/** Bumped whenever a rule, a threshold or a scoring formula changes. Stored with the audit. */
export const RULES_VERSION = "rules-v1";

export interface RuleInput {
  /** The audit's start URL. Its scheme decides `usesHttps`; its origin scopes the crawl. */
  readonly startUrl: string;
  readonly crawl: Pick<CrawlSummary, "pages" | "robots" | "sitemapUrls">;
  /** A sitemap was declared or found, even if it listed nothing we could use. */
  readonly hasSitemap: boolean;
  readonly rules?: readonly AuditRule[];
}

export interface RuleOutcome {
  readonly findings: readonly RuleFinding[];
  readonly evaluated: readonly AuditCategory[];
  readonly rulesVersion: string;
  /** Pages a rule ran on: the denominator for "how widespread is this". */
  readonly pagesEvaluated: number;
}

const CATEGORY_ORDER: readonly AuditCategory[] = AUDIT_CATEGORIES;
const SEVERITY_ORDER: readonly string[] = SEVERITIES;

function siteFacts(input: RuleInput): SiteFacts {
  const start = new URL(input.startUrl);
  const pageStatuses = new Map<string, number | null>();
  for (const page of input.crawl.pages) pageStatuses.set(page.url, page.status);

  const parsed = input.crawl.pages.filter((page) => page.parsed !== null);
  return {
    origin: start.origin,
    usesHttps: start.protocol === "https:",
    robotsPresent: input.crawl.robots.present,
    hasSitemap: input.hasSitemap,
    pagesFetched: parsed.length,
    pagesAttempted: input.crawl.pages.length,
    pageStatuses,
  };
}

function sortKey(finding: RuleFinding): [number, number, string, string] {
  const category = CATEGORY_ORDER.indexOf(finding.category);
  const severity = SEVERITY_ORDER.indexOf(finding.severity);
  return [
    category === -1 ? CATEGORY_ORDER.length : category,
    severity,
    finding.issueCode,
    finding.pageUrl ?? "",
  ];
}

export function runRules(input: RuleInput): RuleOutcome {
  const rules = input.rules ?? RULES;
  const site = siteFacts(input);
  const findings: RuleFinding[] = [];
  const seen = new Set<string>();
  const evaluated = new Set<AuditCategory>();

  let pagesEvaluated = 0;
  for (const page of input.crawl.pages) {
    // A page that failed to fetch has no parsed data: there is nothing for a rule to judge.
    if (page.parsed === null) continue;
    pagesEvaluated += 1;

    const context: PageAuditContext = {
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status ?? 0,
      headers: page.headers,
      durationMs: page.durationMs,
      byteSize: page.byteSize,
      parsed: page.parsed,
      depth: page.depth,
      isStartPage: page.depth === 0,
      site,
    };

    for (const rule of rules) {
      if (rule.applies !== undefined && !rule.applies(context)) continue;
      evaluated.add(rule.category);

      for (const finding of rule.run(context)) {
        if (finding.issueCode !== rule.code) {
          throw new Error(`rule ${rule.code} emitted a finding with code ${finding.issueCode}`);
        }
        if (finding.category !== rule.category) {
          throw new Error(`rule ${rule.code} emitted a finding in category ${finding.category}`);
        }
        const key = `${finding.issueCode}|${finding.pageUrl ?? "site"}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(finding);
      }
    }
  }

  findings.sort((a, b) => {
    const [ac, as, aCode, aUrl] = sortKey(a);
    const [bc, bs, bCode, bUrl] = sortKey(b);
    if (ac !== bc) return ac - bc;
    if (as !== bs) return as - bs;
    if (aCode !== bCode) return aCode < bCode ? -1 : 1;
    if (aUrl === bUrl) return 0;
    return aUrl < bUrl ? -1 : 1;
  });

  return {
    findings,
    evaluated: CATEGORY_ORDER.filter((category) => evaluated.has(category)),
    rulesVersion: RULES_VERSION,
    pagesEvaluated,
  };
}

/** How many findings of each severity this outcome holds — the report's headline numbers. */
export function countBySeverity(findings: readonly RuleFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const severity of SEVERITY_ORDER) counts[severity] = 0;
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  return counts;
}
