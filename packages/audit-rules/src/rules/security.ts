/**
 * Security-signal rules (PRD FR-10).
 *
 * These are the four cheap headers and HTTPS, nothing more: this is not a vulnerability scan and
 * the report says so. They run on the start page only, because they are a property of how the site
 * is served rather than of each page — and because five identical findings across a small crawl
 * would bury the one that matters.
 */

import { findingFor, type AuditRule } from "../types.js";

const onStartPageOverHttps = (context: Parameters<NonNullable<AuditRule["applies"]>>[0]): boolean =>
  context.isStartPage && context.site.usesHttps;

function headerRule(input: {
  readonly code: string;
  readonly header: string;
  readonly severity: "medium" | "low";
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
  /** Extra condition, e.g. a header satisfied by a directive inside another header. */
  readonly satisfied?: (context: Parameters<NonNullable<AuditRule["applies"]>>[0]) => boolean;
}): AuditRule {
  return {
    code: input.code,
    category: "security",
    scope: "site",
    applies: onStartPageOverHttps,
    run: (context) => {
      const present = (context.headers[input.header] ?? "").trim() !== "";
      if (present || (input.satisfied?.(context) ?? false)) return [];
      return [
        findingFor(context, "site", {
          code: input.code,
          category: "security",
          title: input.title,
          severity: input.severity,
          description: input.description,
          evidence: `The homepage response did not include a ${input.header} header.`,
          recommendation: input.recommendation,
        }),
      ];
    },
  };
}

export const SECURITY_RULES: readonly AuditRule[] = [
  {
    code: "insecure-http",
    category: "security",
    scope: "site",
    applies: (context) => context.isStartPage,
    run: (context) => {
      if (context.site.usesHttps) return [];
      return [
        findingFor(context, "site", {
          code: "insecure-http",
          category: "security",
          title: "Site is served without HTTPS",
          severity: "critical",
          description:
            "Traffic to an http:// address can be read and changed on the way. Browsers mark it as not secure, and search engines treat it as a negative signal.",
          evidence: `The audit was submitted as ${context.site.origin}, whose scheme is http.`,
          recommendation: "Serve the site over HTTPS and redirect every http request to the https address.",
          confidence: "observed",
        }),
      ];
    },
  },
  headerRule({
    code: "missing-hsts",
    header: "strict-transport-security",
    severity: "medium",
    title: "No Strict-Transport-Security header",
    description:
      "HSTS tells a browser to use HTTPS for this site automatically, which closes the window where the first http request can be intercepted.",
    recommendation:
      "Send Strict-Transport-Security with a max-age of at least a few months, once HTTPS works everywhere.",
  }),
  headerRule({
    code: "missing-csp",
    header: "content-security-policy",
    severity: "medium",
    title: "No Content-Security-Policy header",
    description:
      "A CSP limits which scripts a page may run. Without one, a single injected script runs with full access to the page and its session.",
    recommendation: "Add a Content-Security-Policy that allows the sources the site actually uses.",
  }),
  headerRule({
    code: "missing-content-type-options",
    header: "x-content-type-options",
    severity: "low",
    title: "No X-Content-Type-Options header",
    description:
      "Without nosniff, a browser may treat a file as a different type than the server declared, which is how an uploaded image can run as a script.",
    recommendation: "Send X-Content-Type-Options: nosniff on every response.",
  }),
  headerRule({
    code: "missing-frame-protection",
    header: "x-frame-options",
    severity: "low",
    title: "Page can be framed by another site",
    description:
      "Neither X-Frame-Options nor a CSP frame-ancestors directive is set, so another site can embed this page and overlay its own controls on it.",
    recommendation:
      "Send X-Frame-Options: DENY (or a CSP frame-ancestors directive) unless embedding is intended.",
    satisfied: (context) =>
      (context.headers["content-security-policy"] ?? "").toLowerCase().includes("frame-ancestors"),
  }),
  headerRule({
    code: "missing-referrer-policy",
    header: "referrer-policy",
    severity: "low",
    title: "No Referrer-Policy header",
    description:
      "Full URLs are sent to other sites as the referrer by default, which can leak internal paths and query strings to third parties.",
    recommendation: "Send Referrer-Policy: strict-origin-when-cross-origin (or stricter).",
  }),
];

export const SECURITY_RULE_CODES: readonly string[] = SECURITY_RULES.map((rule) => rule.code);
