import { describe, expect, it } from "vitest";
import {
  AUDIT_MAX_PAGES_LIMIT,
  CLIENT_LABEL_MAX_LENGTH,
  clampMaxPages,
  createAuditInputSchema,
} from "./audit-input.js";

function issuesFor(input: unknown) {
  const result = createAuditInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues;
}

describe("createAuditInputSchema", () => {
  it("accepts the documented create request", () => {
    const parsed = createAuditInputSchema.safeParse({
      url: "https://example.com",
      clientName: "Northwind",
      projectName: "Spring relaunch",
      scanScope: { maxPages: 10 },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.url).toBe("https://example.com");
      expect(parsed.data.scanScope?.maxPages).toBe(10);
    }
  });

  it("accepts a bare URL, because labels are optional", () => {
    expect(createAuditInputSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
  });

  it("rejects a missing URL", () => {
    expect(issuesFor({})[0]?.path).toEqual(["url"]);
  });

  it("rejects an unsafe URL with a client-safe message, not the internals", () => {
    const issues = issuesFor({ url: "http://169.254.169.254/latest/meta-data/" });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("That address is not a public website we can reach.");
    expect(issues[0]?.message).not.toContain("169.254");

    // Zod's public issue union does not surface custom `params`; the API reads it via this cast.
    const withParams = issues[0] as { params?: { reason?: string } } | undefined;
    expect(withParams?.params?.reason).toBe("address-not-public");
  });

  it("rejects a non-HTTP scheme", () => {
    const issues = issuesFor({ url: "file:///etc/passwd" });
    expect(issues[0]?.message).toBe("Only http and https addresses can be audited.");
  });

  it("enforces the page ceiling regardless of the client", () => {
    expect(
      issuesFor({ url: "https://example.com", scanScope: { maxPages: AUDIT_MAX_PAGES_LIMIT + 1 } }),
    ).toHaveLength(1);
    expect(issuesFor({ url: "https://example.com", scanScope: { maxPages: 0 } })).toHaveLength(1);
    expect(issuesFor({ url: "https://example.com", scanScope: { maxPages: 2.5 } })).toHaveLength(1);
  });

  it("caps client labels", () => {
    const issues = issuesFor({
      url: "https://example.com",
      clientName: "x".repeat(CLIENT_LABEL_MAX_LENGTH + 1),
    });
    expect(issues[0]?.path).toEqual(["clientName"]);
  });
});

describe("clampMaxPages", () => {
  it("clamps instead of trusting the caller", () => {
    expect(clampMaxPages(undefined)).toBe(AUDIT_MAX_PAGES_LIMIT);
    expect(clampMaxPages(5)).toBe(5);
    expect(clampMaxPages(999)).toBe(AUDIT_MAX_PAGES_LIMIT);
    expect(clampMaxPages(0)).toBe(1);
    expect(clampMaxPages(-4)).toBe(1);
    expect(clampMaxPages(7.9)).toBe(7);
    expect(clampMaxPages(Number.NaN)).toBe(AUDIT_MAX_PAGES_LIMIT);
  });
});
