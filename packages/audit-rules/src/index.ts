/**
 * Deterministic rules and scoring (TRD §8, §9).
 *
 * Everything here is a pure function of a crawl: the same pages produce the same findings and the
 * same score, every time, on any machine. That property is the reason the number in a report can be
 * explained line by line — and the reason the AI phase is not allowed to touch it.
 */

export type { AuditRule, PageAuditContext, RuleFinding, SiteFacts } from "./types.js";
export { MAX_EVIDENCE_TEXT, excerpt, findingFor } from "./types.js";

export { RULES, RULES_VERSION, countBySeverity, runRules } from "./engine.js";
export type { RuleInput, RuleOutcome } from "./engine.js";

export {
  CATEGORY_WEIGHTS,
  MAX_RECURRENCE_FACTOR,
  RECURRENCE_STEP,
  SCORING_VERSION,
  SEVERITY_DEDUCTIONS,
  scoringCategory,
  scoreAudit,
} from "./scoring.js";
export type { ScoreInput, ScoreResult } from "./scoring.js";

export { SEO_RULES, SEO_RULE_CODES } from "./rules/seo.js";
export { TECHNICAL_RULES, TECHNICAL_RULE_CODES } from "./rules/technical.js";
export { PERFORMANCE_RULES, PERFORMANCE_RULE_CODES } from "./rules/performance.js";
export { MOBILE_RULES, MOBILE_RULE_CODES } from "./rules/mobile.js";
export { ACCESSIBILITY_RULES, ACCESSIBILITY_RULE_CODES } from "./rules/accessibility.js";
export { SECURITY_RULES, SECURITY_RULE_CODES } from "./rules/security.js";
export { LINKS_RULES, LINKS_RULE_CODES } from "./rules/links.js";
