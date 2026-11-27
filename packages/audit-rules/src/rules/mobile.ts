/**
 * Mobile rules (PRD FR-09, the part that does not need Lighthouse).
 *
 * The viewport tag is the whole of "will a phone show this page at a readable size". Everything
 * else about mobile — layout shift, tap targets, responsive images — needs a rendering engine, and
 * this build does not run one. That limit is stated in the report rather than papered over.
 */

import { excerpt, findingFor, type AuditRule } from "../types.js";

export const MOBILE_RULES: readonly AuditRule[] = [
  {
    code: "missing-viewport",
    category: "mobile",
    scope: "page",
    run: (context) => {
      if (context.parsed.viewport !== null) return [];
      return [
        findingFor(context, "page", {
          code: "missing-viewport",
          category: "mobile",
          title: "Page has no viewport setting",
          severity: "high",
          description:
            "Without a viewport meta tag a phone assumes a desktop-width page and scales it down, so text is tiny and every tap target shrinks with it.",
          evidence: 'No <meta name="viewport"> element was found.',
          recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
        }),
      ];
    },
  },
  {
    code: "zoom-disabled",
    category: "mobile",
    scope: "page",
    run: (context) => {
      const viewport = (context.parsed.viewport ?? "").toLowerCase();
      if (viewport === "") return [];
      const blocksZoom =
        viewport.includes("user-scalable=no") || /maximum-scale\s*=\s*(0?\.\d+|[01])\b/.test(viewport);
      if (!blocksZoom) return [];
      return [
        findingFor(context, "page", {
          code: "zoom-disabled",
          category: "mobile",
          title: "Page prevents pinch-to-zoom",
          severity: "medium",
          description:
            "Disabling zoom removes a reader's only way to enlarge text they cannot read. It is a common mobile accessibility defect, not a design choice.",
          evidence: `Viewport is "${excerpt(context.parsed.viewport ?? "")}".`,
          recommendation: "Remove user-scalable=no and maximum-scale limits from the viewport tag.",
        }),
      ];
    },
  },
];

export const MOBILE_RULE_CODES: readonly string[] = MOBILE_RULES.map((rule) => rule.code);
