/**
 * Request contracts for the API (TRD §5). Zod validates shape; target-url.ts owns the
 * safety rules. Kept separate on purpose: the rules must be usable without Zod, and the
 * schema must not be the only thing standing between a URL and the network.
 */

import { z } from "zod";
import { MAX_URL_LENGTH, UnsafeTargetError, parseTargetUrl, publicMessageFor } from "./target-url.js";

/** Server-side ceiling for one audit (FR-05, FR-17). Clients may ask for less, never more. */
export const AUDIT_MAX_PAGES_LIMIT = 25;

export const CLIENT_LABEL_MAX_LENGTH = 80;

export const targetUrlSchema = z
  .string()
  .trim()
  .min(1, "Enter the address of the page you want audited.")
  .max(MAX_URL_LENGTH, "That address is too long to audit.")
  .superRefine((value, ctx) => {
    try {
      parseTargetUrl(value);
    } catch (error) {
      if (error instanceof UnsafeTargetError) {
        ctx.addIssue({ code: "custom", message: publicMessageFor(error.reason), params: { reason: error.reason } });
        return;
      }
      ctx.addIssue({ code: "custom", message: "That address cannot be audited." });
    }
  });

export const scanScopeSchema = z.object({
  maxPages: z
    .number()
    .int("Pages must be a whole number.")
    .min(1, "At least one page must be scanned.")
    .max(AUDIT_MAX_PAGES_LIMIT, `An audit covers at most ${AUDIT_MAX_PAGES_LIMIT} pages.`),
});

export const createAuditInputSchema = z.object({
  url: targetUrlSchema,
  clientName: z.string().trim().min(1).max(CLIENT_LABEL_MAX_LENGTH).optional(),
  projectName: z.string().trim().min(1).max(CLIENT_LABEL_MAX_LENGTH).optional(),
  scanScope: scanScopeSchema.optional(),
});

export type CreateAuditInput = z.infer<typeof createAuditInputSchema>;

/** Belt and braces for callers that already parsed a body: the server clamps regardless. */
export function clampMaxPages(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return AUDIT_MAX_PAGES_LIMIT;
  const floored = Math.floor(requested);
  if (floored < 1) return 1;
  return Math.min(floored, AUDIT_MAX_PAGES_LIMIT);
}
