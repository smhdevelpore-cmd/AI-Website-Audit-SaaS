/**
 * Request contracts for the API (TRD §5). Zod validates shape; target-url.ts owns the
 * safety rules. Kept separate on purpose: the rules must be usable without Zod, and the
 * schema must not be the only thing standing between a URL and the network.
 */
import { z } from "zod";
/** Server-side ceiling for one audit (FR-05, FR-17). Clients may ask for less, never more. */
export declare const AUDIT_MAX_PAGES_LIMIT = 25;
export declare const CLIENT_LABEL_MAX_LENGTH = 80;
export declare const targetUrlSchema: z.ZodString;
export declare const scanScopeSchema: z.ZodObject<{
    maxPages: z.ZodNumber;
}, z.core.$strip>;
export declare const createAuditInputSchema: z.ZodObject<{
    url: z.ZodString;
    clientName: z.ZodOptional<z.ZodString>;
    projectName: z.ZodOptional<z.ZodString>;
    scanScope: z.ZodOptional<z.ZodObject<{
        maxPages: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CreateAuditInput = z.infer<typeof createAuditInputSchema>;
/** Belt and braces for callers that already parsed a body: the server clamps regardless. */
export declare function clampMaxPages(requested: number | undefined): number;
//# sourceMappingURL=audit-input.d.ts.map