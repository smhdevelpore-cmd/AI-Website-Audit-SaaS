/**
 * Proves the harness itself: workspace packages resolve without a prior build, and the
 * test runner sees every workspace.
 */
import { describe, expect, it } from "vitest";

import { RULES, RULES_VERSION, ruleCount } from "@siteaudit/audit-rules";
import { REPORT_TEMPLATE_VERSION } from "@siteaudit/report-template";
import { DOMAIN_SCHEMA_VERSION } from "@siteaudit/shared-types";
import { AUDIT_MAX_PAGES_LIMIT } from "@siteaudit/validation";

describe("workspace wiring", () => {
  it("resolves every package through its public entry", () => {
    expect(RULES_VERSION).toBe(0);
    expect(REPORT_TEMPLATE_VERSION).toBe(0);
    expect(DOMAIN_SCHEMA_VERSION).toBe(1); // bumped when the Phase 1 contracts landed
    expect(AUDIT_MAX_PAGES_LIMIT).toBe(25);
  });

  it("ships no audit rules yet", () => {
    expect(RULES).toEqual([]);
    expect(ruleCount()).toBe(0);
  });
});
