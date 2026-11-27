/**
 * The landing page's address check. It is a typing-mistake filter, not the SSRF gate — these
 * tests pin down what it accepts so nobody mistakes it for the security control.
 */

import { describe, expect, it } from "vitest";

import { checkSiteAddress } from "../../apps/web/src/lib/site-url.js";

describe("checkSiteAddress", () => {
  it("accepts an ordinary public address", () => {
    expect(checkSiteAddress("https://example.com")).toEqual({ ok: true, href: "https://example.com/" });
    expect(checkSiteAddress("  http://example.com/path?q=1  ")).toEqual({
      ok: true,
      href: "http://example.com/path?q=1",
    });
  });

  it("rejects a scheme that is not http or https", () => {
    for (const address of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"]) {
      expect(checkSiteAddress(address).ok, address).toBe(false);
    }
  });

  it("rejects credentials in the address", () => {
    const result = checkSiteAddress("https://user:secret@example.com");
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").toMatch(/username and password/i);
  });

  it("asks for the full address when the scheme is missing", () => {
    const result = checkSiteAddress("example.com");
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").toMatch(/starting with https/i);
  });

  it("rejects blank and over-long input", () => {
    expect(checkSiteAddress("   ").ok).toBe(false);
    expect(checkSiteAddress(`https://example.com/${"a".repeat(2100)}`).ok).toBe(false);
  });

  it("does not pretend to know whether an address is reachable or safe", () => {
    // A literal private address passes the syntax check on purpose: only the server's DNS and
    // IP rules can decide that, and this function must not appear to have decided.
    expect(checkSiteAddress("http://127.0.0.1:8080").ok).toBe(true);
  });
});
