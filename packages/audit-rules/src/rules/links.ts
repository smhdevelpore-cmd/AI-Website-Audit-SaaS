/**
 * Link rules (PRD FR-11).
 *
 * A broken link is only a finding when we *observed* the destination failing. The crawl already
 * fetched the same-origin pages inside its budget, so the evidence is a status we recorded rather
 * than a second round of requests: a link whose destination was never fetched is treated as
 * unchecked, not as broken.
 */

import { findingFor, type AuditRule } from "../types.js";

/** How many failing destinations the evidence names before it summarises the rest. */
const SAMPLE = 3;

export const LINKS_RULES: readonly AuditRule[] = [
  {
    code: "broken-internal-link",
    category: "links",
    scope: "page",
    run: (context) => {
      const broken: string[] = [];
      for (const link of context.parsed.links) {
        const status = context.site.pageStatuses.get(link);
        if (status !== undefined && status !== null && status >= 400) broken.push(link);
      }
      if (broken.length === 0) return [];

      const sample = broken.slice(0, SAMPLE).join(", ");
      const rest = broken.length > SAMPLE ? `, and ${broken.length - SAMPLE} more` : "";
      return [
        findingFor(context, "page", {
          code: "broken-internal-link",
          category: "links",
          title: "Page links to an address that fails",
          severity: "high",
          description:
            "A link on this page points at a same-site address that answered with an error when we requested it. A visitor who follows it reaches a dead end.",
          evidence: `Broken destinations: ${sample}${rest}.`,
          recommendation:
            "Repair each link to the page that replaced it, or remove it; then enable a redirect from the old address.",
          confidence: "observed",
        }),
      ];
    },
  },
];

export const LINKS_RULE_CODES: readonly string[] = LINKS_RULES.map((rule) => rule.code);
