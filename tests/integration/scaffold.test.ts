/**
 * Proves the harness itself: workspace packages resolve without a prior build, and the
 * test runner sees every workspace.
 */
import { describe, expect, it } from "vitest";

import { RULES, RULES_VERSION } from "@siteaudit/audit-rules";
import { REPORT_TEMPLATE_VERSION } from "@siteaudit/report-template";
import { DOMAIN_SCHEMA_VERSION } from "@siteaudit/shared-types";
import { AUDIT_MAX_PAGES_LIMIT } from "@siteaudit/validation";

describe("workspace wiring", () => {
  it("resolves every package through its public entry", () => {
    expect(RULES_VERSION).toBe("rules-v1");
    expect(REPORT_TEMPLATE_VERSION).toBe("report-v1");
    expect(DOMAIN_SCHEMA_VERSION).toBe(1); // bumped when the Phase 1 contracts landed
    expect(AUDIT_MAX_PAGES_LIMIT).toBe(25);
  });

  it("ships one rule per issue code, with no duplicates", () => {
    expect(RULES.length).toBeGreaterThan(0);
    const codes = RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
