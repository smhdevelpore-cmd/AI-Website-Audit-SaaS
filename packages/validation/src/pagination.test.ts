import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  findingsQuerySchema,
  listAuditsQuerySchema,
  paginationQuerySchema,
  toPaginationMeta,
} from "./pagination.js";

function issuesOf(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } },
  value: unknown,
) {
  const result = schema.safeParse(value);
  return result.success ? [] : (result.error?.issues ?? []);
}

describe("paginationQuerySchema", () => {
  it("defaults an empty query", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE });
  });

  it("coerces the strings a query string actually delivers", () => {
    expect(paginationQuerySchema.parse({ page: "3", limit: "50" })).toEqual({ page: 3, limit: 50 });
  });

  it("refuses a page size no client should be able to ask for", () => {
    expect(issuesOf(paginationQuerySchema, { limit: String(MAX_PAGE_SIZE + 1) })).toHaveLength(1);
    expect(issuesOf(paginationQuerySchema, { limit: "0" })).toHaveLength(1);
  });

  it("refuses fractional pages and junk", () => {
    expect(issuesOf(paginationQuerySchema, { page: "1.5" })).toHaveLength(1);
    expect(issuesOf(paginationQuerySchema, { page: "abc" })).toHaveLength(1);
    expect(issuesOf(paginationQuerySchema, { page: "-1" })).toHaveLength(1);
  });
});

describe("listAuditsQuerySchema", () => {
  it("accepts a status, a search term and paging together", () => {
    expect(listAuditsQuerySchema.parse({ status: "partial", search: "northwind", page: "2" })).toMatchObject({
      status: "partial",
      search: "northwind",
      page: 2,
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it("rejects a status that is not in the domain list", () => {
    const issues = issuesOf(listAuditsQuerySchema, { status: "done" });
    expect(issues).toHaveLength(1);
  });

  it("caps the search term", () => {
    expect(issuesOf(listAuditsQuerySchema, { search: "x".repeat(201) })).toHaveLength(1);
  });
});

describe("findingsQuerySchema", () => {
  it("accepts category and severity filters", () => {
    expect(findingsQuerySchema.parse({ category: "seo", severity: "critical" })).toMatchObject({
      category: "seo",
      severity: "critical",
    });
  });

  it("rejects an unknown category or severity", () => {
    expect(issuesOf(findingsQuerySchema, { category: "vibes" })).toHaveLength(1);
    expect(issuesOf(findingsQuerySchema, { severity: "blocker" })).toHaveLength(1);
  });
});

describe("toPaginationMeta", () => {
  it("computes pages and the hasMore flag", () => {
    expect(toPaginationMeta(1, 20, 45)).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasMore: true,
    });
    expect(toPaginationMeta(3, 20, 45)).toEqual({
      page: 3,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasMore: false,
    });
  });

  it("never reports a negative or fractional total", () => {
    expect(toPaginationMeta(1, 20, -5)).toMatchObject({ total: 0, totalPages: 1, hasMore: false });
    expect(toPaginationMeta(1, 20, 4.7)).toMatchObject({ total: 4 });
  });
});
