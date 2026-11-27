/**
 * Evidence-bound explanations (PRD FR-14, TRD §11).
 *
 * Deliberately a package of its own: `@siteaudit/audit-rules` must remain a pure function of a
 * crawl that never touches the network, and the AI step must remain optional. When this package is
 * absent from a deployment, or its provider fails, the deterministic audit is unchanged.
 */

export {
  explainAudit,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_MS,
  estimateTokens,
} from "./explain.js";
export type { ExplainOptions } from "./explain.js";

export { buildPrompt, MAX_EVIDENCE_CHARS, MAX_FINDINGS, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.js";
export type { BuiltPrompt } from "./prompt.js";

export { createHttpAiProvider, DEFAULT_LLM_ENDPOINT } from "./http-provider.js";
export type { HttpProviderOptions } from "./http-provider.js";

export type {
  AiProvider,
  AiRequest,
  ExplainFailureReason,
  ExplainResult,
  ExplanationFinding,
  ExplanationInput,
  ExplanationPayload,
  TokenUsage,
} from "./types.js";
