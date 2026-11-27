/**
 * Technical rules (PRD FR-08).
 *
 * The status rules are the ones that matter most: a page that answers 500 did not render, and no
 * amount of copy fixing will help. The site-level rules are advisory (a small site can be perfectly
 * healthy without a sitemap) and are filed against the audit rather than a page.
 */

import { findingFor, type AuditRule } from "../types.js";

export const TECHNICAL_RULES: readonly AuditRule[] = [
  {
    code: "server-error",
    category: "technical",
    scope: "page",
    run: (context) => {
      if (context.status < 500) return [];
      return [
        findingFor(context, "page", {
          code: "server-error",
          category: "technical",
          title: "Server returns an error",
          severity: "critical",
          description:
            "The server answered with a 5xx status, so the page did not render for this request. Whatever the page contains, a visitor did not see it.",
          evidence: `HTTP ${context.status} returned in ${Math.round(context.durationMs)} ms.`,
          recommendation:
            "Check the application logs for this URL, then re-run the audit once the server responds normally.",
          confidence: "observed",
        }),
      ];
    },
  },
  {
    code: "client-error",
    category: "technical",
    scope: "page",
    run: (context) => {
      if (context.status < 400 || context.status >= 500) return [];
      return [
        findingFor(context, "page", {
          code: "client-error",
          category: "technical",
          title: "Page returns a client error",
          severity: "high",
          description:
            "The server answered with a 4xx status, so this address does not serve a page. A link to it reaches a dead end.",
          evidence: `HTTP ${context.status} returned for ${context.url}.`,
          recommendation:
            "Serve the page at this address, or redirect it to the page that replaced it and update the links.",
        }),
      ];
    },
  },
  {
    code: "missing-robots-txt",
    category: "technical",
    scope: "site",
    applies: (context) => context.isStartPage,
    run: (context) => {
      if (context.site.robotsPresent) return [];
      return [
        findingFor(context, "site", {
          code: "missing-robots-txt",
          category: "technical",
          title: "No robots.txt file",
          severity: "low",
          description:
            "robots.txt states which parts of a site a crawler may visit and where its sitemaps are. Without it, crawlers decide for themselves.",
          evidence: `${context.site.origin}/robots.txt did not return a readable file.`,
          recommendation:
            "Add a robots.txt that allows the pages you want indexed, disallows the ones you do not, and names your sitemap.",
          confidence: "observed",
        }),
      ];
    },
  },
  {
    code: "missing-sitemap",
    category: "technical",
    scope: "site",
    applies: (context) => context.isStartPage,
    run: (context) => {
      if (context.site.hasSitemap) return [];
      return [
        findingFor(context, "site", {
          code: "missing-sitemap",
          category: "technical",
          title: "No sitemap found",
          severity: "low",
          description:
            "A sitemap lists the pages worth indexing and how recently they changed, which helps a search engine find pages that few links point to.",
          evidence: "No sitemap was declared in robots.txt, and /sitemap.xml returned nothing usable.",
          recommendation: "Publish a sitemap.xml and declare it in robots.txt.",
          confidence: "observed",
        }),
      ];
    },
  },
];

export const TECHNICAL_RULE_CODES: readonly string[] = TECHNICAL_RULES.map((rule) => rule.code);
