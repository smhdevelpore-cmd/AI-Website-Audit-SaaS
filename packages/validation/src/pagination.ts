/**
 * List, filter and pagination queries (TRD §5). Query strings arrive as strings, so page and
 * limit coerce — but the coercion is bounded, because `limit=100000` is a denial-of-service
 * request, not a page size.
 */

import { z } from "zod";

import { auditStatusSchema, severitySchema, auditCategorySchema } from "./enums.js";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

export const paginationQuerySchema = z.object({
  page: pageSchema,
  limit: pageSizeSchema,
});

export const AUDIT_SEARCH_MAX_LENGTH = 200;

export const listAuditsQuerySchema = paginationQuerySchema.extend({
  status: auditStatusSchema.optional(),
  search: z.string().trim().min(1).max(AUDIT_SEARCH_MAX_LENGTH).optional(),
});

export const findingsQuerySchema = paginationQuerySchema.extend({
  category: auditCategorySchema.optional(),
  severity: severitySchema.optional(),
  pageUrl: z.string().trim().max(2048).optional(),
  issueCode: z.string().trim().min(1).max(80).optional(),
});

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export function toPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / limit));
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasMore: page < totalPages,
  };
}

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type ListAuditsQuery = z.infer<typeof listAuditsQuerySchema>;
export type FindingsQuery = z.infer<typeof findingsQuerySchema>;
