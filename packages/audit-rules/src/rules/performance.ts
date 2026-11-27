/**
 * Performance rules that do not need Lighthouse (PRD FR-06, TRD §9).
 *
 * PageSpeed supplies LCP, CLS and a lab score; Phase 7 wires the provider. What the crawler can
 * measure on its own is server response time and the weight of the HTML document. Both are real
 * measurements with a timestamp, and the report labels them as ours rather than as a Lighthouse
 * score — the two must never be added together or one presented as the other.
 */

import { findingFor, type AuditRule } from "../types.js";

/** Where a response stops being "a server having a slow second" and starts being a defect. */
export const SLOW_RESPONSE_MS = 2_500;
/** An HTML document over this is carrying content that belongs in a cached asset. */
export const LARGE_PAGE_BYTES = 500 * 1024;

export const PERFORMANCE_RULES: readonly AuditRule[] = [
  {
    code: "slow-server-response",
    category: "performance",
    scope: "page",
    run: (context) => {
      if (context.durationMs <= SLOW_RESPONSE_MS) return [];
      return [
        findingFor(context, "page", {
          code: "slow-server-response",
          category: "performance",
          title: "Server takes over two and a half seconds to answer",
          severity: "medium",
          description:
            "The HTML document arrived slowly. Nothing on the page can render before that response, so every visitor waits this long before seeing anything.",
          evidence: `Response took ${Math.round(context.durationMs)} ms (measured by our crawl, not Lighthouse; threshold ${SLOW_RESPONSE_MS} ms).`,
          recommendation:
            "Profile the server path for this URL: database queries, uncached templates and cold starts are the usual causes.",
          confidence: "observed",
        }),
      ];
    },
  },
  {
    code: "large-page-weight",
    category: "performance",
    scope: "page",
    run: (context) => {
      if (context.byteSize <= LARGE_PAGE_BYTES) return [];
      const kilobytes = Math.round(context.byteSize / 1024);
      return [
        findingFor(context, "page", {
          code: "large-page-weight",
          category: "performance",
          title: "HTML document is very large",
          severity: "medium",
          description:
            "The page's HTML alone is heavy, before images, styles or scripts. Large documents are slower to transfer and slower to parse on a phone.",
          evidence: `${kilobytes} KB of HTML (threshold ${Math.round(LARGE_PAGE_BYTES / 1024)} KB), measured on the response we fetched.`,
          recommendation:
            "Move repeated markup into components, paginate long lists, and check for inlined data that should be a separate request.",
        }),
      ];
    },
  },
];

export const PERFORMANCE_RULE_CODES: readonly string[] = PERFORMANCE_RULES.map((rule) => rule.code);
