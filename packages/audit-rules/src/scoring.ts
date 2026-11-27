/**
 * Scoring (PRD FR-13, TRD §9).
 *
 * Weighted categories, deterministic deductions, no invented numbers. The formula in one sentence:
 *
 *   a category starts at 100 and loses points for each *distinct issue code* found in it, more for
 *   a severe issue, and at most twice as much for an issue that repeats across pages; the overall
 *   score is the weighted mean of the categories we were able to check, rounded.
 *
 * Three decisions worth stating, because each one is visible in a report:
 *
 *  - **A category we did not check is N/A, never zero.** Its weight is redistributed across the
 *    ones we did check (FR-13). If nothing was checked, the overall score is `null` — an audit
 *    without a score is honest; a score of 0 would claim the site failed checks we never ran.
 *  - **Recurrence is capped.** One template bug on all 25 pages is one defect, not 25: the
 *    multiplier stops at 2×, so a systematic issue costs a category at most twice its base.
 *  - **`links` findings are charged to `technical`.** FR-13's weights name six categories and
 *    total 100; `links` is a seventh category the schema allows but FR-13 does not weight. Folding
 *    it into technical (20) keeps the weights exactly as specified and stops broken links from
 *    being reported yet invisible in the number. See `docs/RULES.md` §4 for the conflict.
 */

import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type CategoryScore,
  type Severity,
} from "@siteaudit/shared-types";

import type { RuleFinding } from "./types.js";

/** PRD FR-13, verbatim. Sums to 100. */
export const CATEGORY_WEIGHTS: Readonly<Record<AuditCategory, number>> = {
  performance: 25,
  seo: 25,
  technical: 20,
  mobile: 15,
  accessibility: 10,
  security: 5,
  links: 0,
};

/** What one distinct issue code costs its category, before recurrence. */
export const SEVERITY_DEDUCTIONS: Readonly<Record<Severity, number>> = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
};

/** Each extra page the same code appears on adds half the step; the multiplier stops here. */
export const MAX_RECURRENCE_FACTOR = 2;
export const RECURRENCE_STEP = 0.25;

export const SCORING_VERSION = "rules-v1";

/**
 * Which weighted category a finding is charged to.
 *
 * Exported so the report can explain a deduction without re-implementing this rule.
 */
export function scoringCategory(category: AuditCategory): Exclude<AuditCategory, "links"> {
  return category === "links" ? "technical" : category;
}

function clampScore(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

/**
 * Deduction for one issue code, in quarter-point units to keep the arithmetic exact.
 *
 * `units = base * 4 * min(2, 1 + 0.25 × (pages − 1))` becomes `base * min(8, 4 + (pages − 1))`.
 */
function deductionUnits(finding: RuleFinding, pagesAffected: number): number {
  const base = SEVERITY_DEDUCTIONS[finding.severity];
  const factorUnits = Math.min(MAX_RECURRENCE_FACTOR * 4, 4 + (Math.max(1, pagesAffected) - 1));
  return base * factorUnits;
}

export interface ScoreInput {
  readonly findings: readonly RuleFinding[];
  /** Categories a rule actually ran in. Anything else is N/A. */
  readonly evaluated: readonly AuditCategory[];
}

export interface ScoreResult {
  readonly overall: number | null;
  readonly categories: readonly CategoryScore[];
  readonly scoringVersion: string;
}

export function scoreAudit(input: ScoreInput): ScoreResult {
  // Findings are grouped by the category they were reported in; `links` is then charged to
  // technical as well, so its deduction is visible in the number without an invented weight.
  const byCategory = new Map<AuditCategory, RuleFinding[]>();
  for (const finding of input.findings) {
    const bucket = byCategory.get(finding.category) ?? [];
    bucket.push(finding);
    byCategory.set(finding.category, bucket);
  }

  // A category counts as checked if a rule in it ran, and technical also counts when only the
  // link rules ran, because that is where their deduction lands.
  const available = new Set<AuditCategory>(input.evaluated);
  for (const category of input.evaluated) available.add(scoringCategory(category));

  const unitsFor = (category: AuditCategory): number => {
    const bucket = byCategory.get(category) ?? [];
    const pagesByCode = new Map<string, Set<string>>();
    for (const finding of bucket) {
      const pages = pagesByCode.get(finding.issueCode) ?? new Set<string>();
      // A site-wide finding affects the site, not a page: it counts as one.
      pages.add(finding.pageUrl ?? "site");
      pagesByCode.set(finding.issueCode, pages);
    }

    let units = 0;
    for (const [code, pages] of [...pagesByCode].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const representative = bucket.find((finding) => finding.issueCode === code);
      if (representative === undefined) continue;
      units += deductionUnits(representative, pages.size);
    }
    return units;
  };

  const categories: CategoryScore[] = [];
  let weightedSum = 0;
  let weightSum = 0;

  for (const category of AUDIT_CATEGORIES) {
    const weight = CATEGORY_WEIGHTS[category];
    if (!available.has(category)) {
      categories.push({ category, score: null, weight });
      continue;
    }

    const units = unitsFor(category) + (category === "technical" ? unitsFor("links") : 0);
    const score = clampScore(100 - units / 4);
    categories.push({ category, score, weight });
    if (weight > 0) {
      weightedSum += score * weight;
      weightSum += weight;
    }
  }

  const overall = weightSum === 0 ? null : clampScore(weightedSum / weightSum);
  return { overall, categories, scoringVersion: SCORING_VERSION };
}
