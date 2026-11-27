import { describe, expect, it } from "vitest";

import { updateProfileSchema } from "./profile.js";

function issuesOf(value: unknown) {
  const result = updateProfileSchema.safeParse(value);
  return result.success ? [] : result.error.issues;
}

describe("updateProfileSchema", () => {
  it("accepts a name on its own", () => {
    expect(updateProfileSchema.safeParse({ name: "Ayesha Khan" }).success).toBe(true);
  });

  it("accepts the optional fields when they are valid", () => {
    const result = updateProfileSchema.safeParse({
      name: "Ayesha Khan",
      agencyName: "Northwind Studio",
      website: "https://northwind.example",
      timezone: "Asia/Karachi",
      logoUrl: "https://northwind.example/logo.png",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(issuesOf({ name: "   " })).toHaveLength(1);
  });

  it("rejects a website that is not http(s) or carries credentials", () => {
    expect(issuesOf({ name: "A", website: "javascript:alert(1)" })).toHaveLength(1);
    expect(issuesOf({ name: "A", website: "https://user:pass@example.com" })).toHaveLength(1);
    expect(issuesOf({ name: "A", website: "not a url" })).toHaveLength(1);
  });

  it("rejects a time zone the runtime does not know", () => {
    expect(issuesOf({ name: "A", timezone: "Mars/Olympus" })).toHaveLength(1);
    expect(issuesOf({ name: "A", timezone: "europe/berlin" })).toHaveLength(0);
  });
});
