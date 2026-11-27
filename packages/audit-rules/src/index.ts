/**
 * Rule engine contract (TRD §8). No rules yet: each rule needs fixtures and a reviewed
 * threshold before it can produce a finding a customer acts on.
 */

import type { AuditCategory, Finding } from "@siteaudit/shared-types";

export const RULES_VERSION = 0;

/** Sanitised, bounded view of one fetched page. What a rule is allowed to see. */
export interface PageAuditContext {
  url: string;
  status: number;
  html?: string;
  headers: Readonly<Record<string, string>>;
  timingMs?: number;
}

export interface AuditRule {
  code: string;
  category: AuditCategory;
  run(context: PageAuditContext): Finding[];
}

export const RULES: readonly AuditRule[] = [];

export function ruleCount(): number {
  return RULES.length;
}
