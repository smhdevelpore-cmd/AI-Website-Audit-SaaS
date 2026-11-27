/**
 * Scoring (PRD FR-13, TRD §9).
 *
 * These tests are the ones that make the number in a report defensible: every deduction is a
 * property of a finding, every category's weight is the PRD's, and a category that was not checked
 * is N/A rather than zero.
 */

import {
  CATEGORY_WEIGHTS,
  MAX_RECURRENCE_FACTOR,
  SCORING_VERSION,
  SEVERITY_DEDUCTIONS,
  scoreAudit,
  scoringCategory,
  type RuleFinding,
} from "@siteaudit/audit-rules";
import { AUDIT_CATEGORIES, type AuditCategory, type Severity } from "@siteaudit/shared-types";
import { describe, expect, it } from "vitest";

const ALL: readonly AuditCategory[] = AUDIT_CATEGORIES;

function finding(overrides: Partial<RuleFinding> & { severity: Severity }): RuleFinding {
  return {
    issueCode: "missing-title",
    category: "seo",
    title: "Title",
    description: "Description",
    pageUrl: "https://example.com/",
    evidence: "Evidence",
    recommendation: "Recommendation",
    confidence: "observed",
    ...overrides,
  };
}

function scoreOf(
  category: AuditCategory,
  findings: readonly RuleFinding[],
  evaluated: readonly AuditCategory[] = ALL,
) {
  return scoreAudit({ findings, evaluated }).categories.find((entry) => entry.category === category);
}

describe("weights", () => {
  it("are PRD FR-13 verbatim and sum to 100 over the weighted categories", () => {
    expect(CATEGORY_WEIGHTS).toEqual({
      performance: 25,
      seo: 25,
      technical: 20,
      mobile: 15,
      accessibility: 10,
      security: 5,
      links: 0,
    });

    const total = AUDIT_CATEGORIES.reduce((sum, category) => sum + CATEGORY_WEIGHTS[category], 0);
    expect(total).toBe(100);
  });

  it("charge links findings to technical, because FR-13 does not weight links", () => {
    expect(scoringCategory("links")).toBe("technical");
    expect(scoringCategory("seo")).toBe("seo");
  });
});

describe("a clean audit", () => {
  it("scores 100 when every category was checked and nothing was found", () => {
    const result = scoreAudit({ findings: [], evaluated: ALL });

    expect(result.overall).toBe(100);
    expect(result.categories.every((entry) => entry.score === 100)).toBe(true);
    expect(result.scoringVersion).toBe(SCORING_VERSION);
  });

  it("has no overall score at all when nothing was checked", () => {
    const result = scoreAudit({ findings: [], evaluated: [] });

    expect(result.overall).toBeNull();
    // N/A is not zero: every category carries a null score, and no weight is claimed.
    expect(result.categories.every((entry) => entry.score === null)).toBe(true);
  });
});

describe("deductions", () => {
  it("takes the documented amount for each severity", () => {
    for (const [severity, deduction] of Object.entries(SEVERITY_DEDUCTIONS)) {
      const entry = scoreOf("seo", [finding({ severity: severity as Severity })]);
      expect(entry?.score, severity).toBe(100 - deduction);
    }
  });

  it("charges one issue code once per page, however many findings share it", () => {
    const one = scoreOf("seo", [finding({ severity: "high" })]);
    const samePageTwice = scoreOf("seo", [finding({ severity: "high" }), finding({ severity: "high" })]);

    expect(one?.score).toBe(88);
    expect(samePageTwice?.score).toBe(88);
  });

  it("increases the deduction for an issue that repeats, and caps it", () => {
    const on = (pages: number): RuleFinding[] =>
      Array.from({ length: pages }, (_, index) =>
        finding({ severity: "high", pageUrl: `https://example.com/p${index}` }),
      );

    expect(scoreOf("seo", on(1))?.score).toBe(88); // 12
    expect(scoreOf("seo", on(2))?.score).toBe(85); // 12 × 1.25 = 15
    expect(scoreOf("seo", on(3))?.score).toBe(82); // 12 × 1.5 = 18
    expect(scoreOf("seo", on(9))?.score).toBe(76); // capped at 12 × 2 = 24
    expect(scoreOf("seo", on(50))?.score).toBe(76);
    expect(MAX_RECURRENCE_FACTOR).toBe(2);
  });

  it("never goes below zero", () => {
    const findings = Array.from({ length: 8 }, (_, index) =>
      finding({ severity: "critical", issueCode: `issue-${index}` }),
    );
    expect(scoreOf("seo", findings)?.score).toBe(0);
  });

  it("only charges a category for findings in that category", () => {
    const findings = [finding({ severity: "critical", category: "security" })];

    expect(scoreOf("seo", findings)?.score).toBe(100);
    expect(scoreOf("security", findings)?.score).toBe(75);
  });

  it("counts a site-wide finding as one page", () => {
    const siteWide = finding({ severity: "critical", category: "security", pageUrl: null });
    expect(scoreOf("security", [siteWide])?.score).toBe(75);
  });
});

describe("the overall score", () => {
  it("is the weighted mean of the categories that were checked", () => {
    // SEO 88 (one high), everything else 100.
    const result = scoreAudit({ findings: [finding({ severity: "high" })], evaluated: ALL });

    // (88×25 + 100×75) / 100 = 97
    expect(result.overall).toBe(97);
  });

  it("redistributes the weight of a category that is N/A", () => {
    const findings = [finding({ severity: "critical", category: "security", pageUrl: null })];
    const result = scoreAudit({ findings, evaluated: ["seo", "security"] });

    const performance = result.categories.find((entry) => entry.category === "performance");
    expect(performance?.score).toBeNull();
    expect(performance?.weight).toBe(25);

    // SEO 100 at 25 and security 75 at 5: (2500 + 375) / 30 = 95.8 → 96.
    expect(result.overall).toBe(96);
  });

  it("ignores the links weight and keeps its deduction in technical", () => {
    const findings = [finding({ severity: "high", category: "links", issueCode: "broken-internal-link" })];
    const result = scoreAudit({ findings, evaluated: ["links"] });

    const technical = result.categories.find((entry) => entry.category === "technical");
    const links = result.categories.find((entry) => entry.category === "links");
    const performance = result.categories.find((entry) => entry.category === "performance");

    expect(technical?.score).toBe(88); // the deduction landed here
    expect(links?.score).toBe(88);
    expect(links?.weight).toBe(0);
    expect(performance?.score).toBeNull();
    expect(result.overall).toBe(88);
  });

  it("is the same for the same input, every time", () => {
    const findings = [
      finding({ severity: "medium" }),
      finding({ severity: "low", issueCode: "title-too-long", pageUrl: "https://example.com/b" }),
      finding({ severity: "high", category: "accessibility", issueCode: "images-missing-alt" }),
    ];

    const first = scoreAudit({ findings, evaluated: ALL });
    const second = scoreAudit({ findings: [...findings].reverse(), evaluated: [...ALL].reverse() });

    expect(second.overall).toBe(first.overall);
    expect(second.categories).toEqual(first.categories);
  });

  it("rounds to a whole number, because a score is displayed", () => {
    const result = scoreAudit({ findings: [finding({ severity: "low" })], evaluated: ALL });
    expect(Number.isInteger(result.overall)).toBe(true);
  });
});
