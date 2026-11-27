/**
 * AI output contracts (TRD §11).
 *
 * Strict objects on purpose: an explanation step that returns an extra field we did not ask
 * for, or invents a severity, fails validation instead of reaching a report. AI never
 * supplies a measurement — these schemas have no numeric field for one.
 */

import { z } from "zod";

import { difficultySchema, prioritySchema } from "./enums.js";

const sentence = (max: number) => z.string().trim().min(1).max(max);

export const aiRecommendationSchema = z
  .object({
    issueCode: z.string().trim().min(1).max(80),
    plainExplanation: sentence(600),
    businessImpact: sentence(400),
    recommendedFix: z.array(sentence(300)).min(1).max(5),
    difficulty: difficultySchema,
    priority: prioritySchema,
  })
  .strict();

export const auditSummarySchema = z
  .object({
    overview: sentence(800),
    topPriorities: z.array(sentence(200)).min(1).max(5),
    limitations: z.array(sentence(300)).max(5),
  })
  .strict();

export type AIRecommendationOutput = z.infer<typeof aiRecommendationSchema>;
export type AuditSummaryOutput = z.infer<typeof auditSummarySchema>;
