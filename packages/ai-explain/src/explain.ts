/**
 * The explanation step (TRD §11).
 *
 * It either returns validated explanations or it returns `unavailable` with a reason. There is no
 * third outcome and no partial text: an explanation that failed validation is not stored, because
 * a half-understood sentence in a client report is worse than a missing one.
 *
 * Failure is ordinary here. A provider that is down, slow, or talks about a finding that does not
 * exist changes nothing about the audit — the deterministic findings, the score and the status are
 * already written by the steps before this one.
 */

import { aiExplanationResponseSchema, type AIExplanationResponse } from "@siteaudit/validation";

import { buildPrompt } from "./prompt.js";
import type {
  AiProvider,
  ExplainFailureReason,
  ExplainResult,
  ExplanationInput,
  TokenUsage,
} from "./types.js";

export interface ExplainOptions {
  readonly provider: AiProvider;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Two attempts: a malformed reply is often a one-off, a broken provider is not worth a third. */
  readonly maxAttempts?: number;
  readonly maxOutputTokens?: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_ATTEMPTS = 2;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_500;

/** Rough, deliberately conservative. Used for metering only; never shown as a cost to a customer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Models wrap JSON in fences even when told not to. This strips that, and nothing else. */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function attempt(
  provider: AiProvider,
  request: { system: string; user: string; maxOutputTokens: number },
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return provider(request, controller.signal).finally(() => clearTimeout(timer));
}

export async function explainAudit(input: ExplanationInput, options: ExplainOptions): Promise<ExplainResult> {
  if (input.findings.length === 0) {
    // Nothing to explain. Calling a provider to say so would spend money on an empty page.
    return { status: "unavailable", reason: "no_findings", attempts: 0, detail: "no findings to explain" };
  }

  const prompt = buildPrompt(input);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  let lastDetail = "no attempt was made";
  // The reason the *last* attempt failed, so a provider that is down is not reported as a
  // validation failure (and vice versa).
  let lastReason: ExplainFailureReason = "provider_error";
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    let raw: string;
    try {
      raw = await attempt(
        options.provider,
        { system: prompt.system, user: prompt.user, maxOutputTokens },
        timeoutMs,
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      lastDetail = timedOut ? "provider timed out" : "provider failed";
      lastReason = timedOut ? "timeout" : "provider_error";
      // A timeout is not retried in the same run: the audit has a budget and the answer is late.
      if (timedOut)
        return { status: "unavailable", reason: "timeout", attempts: attemptNumber, detail: lastDetail };
      continue;
    }

    const parsed = aiExplanationResponseSchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      lastDetail = `invalid output: ${parsed.error.issues[0]?.path.join(".") ?? "shape"}`;
      lastReason = "invalid_output";
      continue;
    }

    const invented = parsed.data.recommendations.find(
      (recommendation) => !prompt.allowedCodes.has(recommendation.issueCode),
    );
    if (invented !== undefined) {
      // The model wrote about a finding nobody made. Everything it said is now suspect.
      lastDetail = `recommendation for unknown issue code ${invented.issueCode}`;
      lastReason = "invalid_output";
      continue;
    }

    const recommendations = new Map(
      parsed.data.recommendations.map((recommendation) => [recommendation.issueCode, recommendation]),
    );
    const usage: TokenUsage = {
      inputTokens: estimateTokens(prompt.system + prompt.user),
      outputTokens: estimateTokens(raw),
    };

    return {
      status: "ok",
      model: options.model,
      summary: parsed.data.summary,
      recommendations,
      usage,
      attempts: attemptNumber,
    };
  }

  return { status: "unavailable", reason: lastReason, attempts: maxAttempts, detail: lastDetail };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
}

export type { AIExplanationResponse };
