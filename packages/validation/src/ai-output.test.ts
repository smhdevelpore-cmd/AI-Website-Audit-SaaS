import { describe, expect, it } from "vitest";

import { aiRecommendationSchema, auditSummarySchema } from "./ai-output.js";

const validRecommendation = {
  issueCode: "seo.title.missing",
  plainExplanation: "The page has no title element, so a search result shows the address instead of a name.",
  businessImpact: "The listing reads as broken next to competitors, which lowers the click-through rate.",
  recommendedFix: ["Add a title of 50 to 60 characters that names the page and the business."],
  difficulty: "easy",
  priority: "high",
};

describe("aiRecommendationSchema", () => {
  it("accepts a well-formed explanation", () => {
    expect(aiRecommendationSchema.safeParse(validRecommendation).success).toBe(true);
  });

  it("rejects an invented difficulty or priority", () => {
    expect(aiRecommendationSchema.safeParse({ ...validRecommendation, difficulty: "trivial" }).success).toBe(
      false,
    );
    expect(aiRecommendationSchema.safeParse({ ...validRecommendation, priority: "urgent" }).success).toBe(
      false,
    );
  });

  it("rejects an extra field, so a model cannot smuggle data into the report", () => {
    const withMetric = { ...validRecommendation, measuredScore: 12 };
    const result = aiRecommendationSchema.safeParse(withMetric);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("refuses to pass off an empty explanation as one", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...validRecommendation, plainExplanation: "   " }).success,
    ).toBe(false);
  });

  it("bounds the fix list and each step", () => {
    expect(aiRecommendationSchema.safeParse({ ...validRecommendation, recommendedFix: [] }).success).toBe(
      false,
    );
    expect(
      aiRecommendationSchema.safeParse({ ...validRecommendation, recommendedFix: ["x".repeat(301)] }).success,
    ).toBe(false);
    expect(
      aiRecommendationSchema.safeParse({
        ...validRecommendation,
        recommendedFix: Array<string>(6).fill("Do it."),
      }).success,
    ).toBe(false);
  });
});

describe("auditSummarySchema", () => {
  const validSummary = {
    overview: "Four of the six categories produced measurements; performance data was unavailable today.",
    topPriorities: ["Give every page a unique title."],
    limitations: ["Performance data was unavailable from the provider."],
  };

  it("accepts a summary that states its limitations", () => {
    expect(auditSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it("accepts a summary with no limitations, but not with unlimited ones", () => {
    expect(auditSummarySchema.safeParse({ ...validSummary, limitations: [] }).success).toBe(true);
    expect(
      auditSummarySchema.safeParse({ ...validSummary, limitations: Array<string>(6).fill("Limited.") })
        .success,
    ).toBe(false);
  });

  it("requires at least one priority", () => {
    expect(auditSummarySchema.safeParse({ ...validSummary, topPriorities: [] }).success).toBe(false);
  });

  it("has no field an AI could put a measurement in", () => {
    const keys = Object.keys(auditSummarySchema.shape);
    expect(keys).toEqual(["overview", "topPriorities", "limitations"]);
  });
});
