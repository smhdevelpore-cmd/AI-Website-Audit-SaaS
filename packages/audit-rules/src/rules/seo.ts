/**
 * SEO rules (PRD FR-07).
 *
 * Thresholds are the ones a search result actually enforces: about 60 characters of title, about
 * 160 of description. Each is a named constant so a test can pin it and a reviewer can argue with
 * the number rather than with a literal in the middle of a sentence.
 *
 * Severity follows consequence, not tidiness. A missing title or H1 is high because the page loses
 * the thing a search result is built from; a 70-character title is low because it is truncated and
 * nothing breaks.
 */

import { normalizeUrl } from "@siteaudit/crawler";

import { excerpt, findingFor, type AuditRule, type PageAuditContext, type RuleFinding } from "../types.js";

export const MAX_TITLE_LENGTH = 60;
export const MIN_TITLE_LENGTH = 15;
export const MAX_DESCRIPTION_LENGTH = 160;

/** A jump of two or more levels (h1 → h3) breaks the outline a screen reader announces. */
const HEADING_SKIP = 2;

export const SEO_RULES: readonly AuditRule[] = [
  {
    code: "missing-title",
    category: "seo",
    scope: "page",
    run: (context) => {
      if (context.parsed.title !== null) return [];
      return [
        findingFor(context, "page", {
          code: "missing-title",
          category: "seo",
          title: "Page has no title",
          severity: "high",
          description:
            "The title element is the headline of a search result and the label of a browser tab. Without one, a search engine shows the address instead.",
          evidence: "No non-empty <title> element was found in the served HTML.",
          recommendation:
            "Add a unique title of about 15–60 characters that names the page and the business.",
        }),
      ];
    },
  },
  {
    code: "title-too-long",
    category: "seo",
    scope: "page",
    run: (context) => {
      const title = context.parsed.title;
      if (title === null || title.length <= MAX_TITLE_LENGTH) return [];
      return [
        findingFor(context, "page", {
          code: "title-too-long",
          category: "seo",
          title: "Title is longer than a search result shows",
          severity: "low",
          description:
            "A title longer than about 60 characters is cut off in a search result, so the end of it never reaches a reader.",
          evidence: `Title is ${title.length} characters: "${excerpt(title)}"`,
          recommendation: `Shorten the title to about ${MAX_TITLE_LENGTH} characters, keeping the page topic first.`,
        }),
      ];
    },
  },
  {
    code: "title-too-short",
    category: "seo",
    scope: "page",
    run: (context) => {
      const title = context.parsed.title;
      if (title === null || title.length >= MIN_TITLE_LENGTH) return [];
      return [
        findingFor(context, "page", {
          code: "title-too-short",
          category: "seo",
          title: "Title is too short to say what the page is",
          severity: "low",
          description:
            "A title of a few characters rarely tells a searcher what the page offers, so the result is skipped.",
          evidence: `Title is ${title.length} characters: "${excerpt(title)}"`,
          recommendation: `Write a descriptive title of at least ${MIN_TITLE_LENGTH} characters.`,
        }),
      ];
    },
  },
  {
    code: "missing-meta-description",
    category: "seo",
    scope: "page",
    run: (context) => {
      if (context.parsed.metaDescription !== null) return [];
      return [
        findingFor(context, "page", {
          code: "missing-meta-description",
          category: "seo",
          title: "Page has no meta description",
          severity: "medium",
          description:
            "The description is the sentence under a search result. Without one, a search engine invents it from page text, which often reads badly.",
          evidence: 'No <meta name="description"> with content was found.',
          recommendation: `Add a description of about ${MAX_DESCRIPTION_LENGTH} characters that states what the page offers and to whom.`,
        }),
      ];
    },
  },
  {
    code: "meta-description-too-long",
    category: "seo",
    scope: "page",
    run: (context) => {
      const description = context.parsed.metaDescription;
      if (description === null || description.length <= MAX_DESCRIPTION_LENGTH) return [];
      return [
        findingFor(context, "page", {
          code: "meta-description-too-long",
          category: "seo",
          title: "Meta description is longer than a search result shows",
          severity: "low",
          description:
            "Descriptions longer than about 160 characters are truncated, so the end of the sentence is lost.",
          evidence: `Description is ${description.length} characters: "${excerpt(description)}"`,
          recommendation: `Shorten the description to about ${MAX_DESCRIPTION_LENGTH} characters.`,
        }),
      ];
    },
  },
  {
    code: "missing-h1",
    category: "seo",
    scope: "page",
    run: (context) => {
      if (context.parsed.h1Count > 0) return [];
      return [
        findingFor(context, "page", {
          code: "missing-h1",
          category: "seo",
          title: "Page has no H1 heading",
          severity: "high",
          description:
            "The H1 is the page's main heading. It states the topic for a reader and for anything that summarises the page.",
          evidence: `No <h1> element was found (h2: ${context.parsed.headings.h2}, h3: ${context.parsed.headings.h3}).`,
          recommendation: "Add one H1 that names the page's subject, distinct from the title tag.",
        }),
      ];
    },
  },
  {
    code: "multiple-h1",
    category: "seo",
    scope: "page",
    run: (context) => {
      const h1Count = context.parsed.h1Count;
      if (h1Count <= 1) return [];
      return [
        findingFor(context, "page", {
          code: "multiple-h1",
          category: "seo",
          title: "Page has more than one H1 heading",
          severity: "low",
          description:
            "Several H1 headings make the page's main topic ambiguous to a reader skimming the outline.",
          evidence: `${h1Count} <h1> elements were found.`,
          recommendation: "Keep one H1 and demote the others to H2.",
        }),
      ];
    },
  },
  {
    code: "heading-level-skip",
    category: "seo",
    scope: "page",
    run: (context) => {
      const sequence = context.parsed.headingSequence;
      for (let index = 1; index < sequence.length; index += 1) {
        const previous = sequence[index - 1] ?? 1;
        const current = sequence[index] ?? 1;
        if (current - previous >= HEADING_SKIP) {
          return [
            findingFor(context, "page", {
              code: "heading-level-skip",
              category: "seo",
              title: "Heading levels skip a step",
              severity: "low",
              description:
                "Headings that jump from one level to a much deeper one (h1 straight to h4) describe an outline that readers and assistive technology cannot follow.",
              evidence: `Headings jump from h${previous} to h${current}.`,
              recommendation: "Use consecutive heading levels and style them with CSS rather than skipping.",
            }),
          ];
        }
      }
      return [];
    },
  },
  {
    code: "missing-lang",
    category: "seo",
    scope: "page",
    run: (context) => {
      if (context.parsed.lang !== null) return [];
      return [
        findingFor(context, "page", {
          code: "missing-lang",
          category: "seo",
          title: "Page does not declare its language",
          severity: "medium",
          description:
            "The html element should carry a language, so a screen reader pronounces the page correctly and a search engine knows which audience it is for.",
          evidence: "No lang attribute was found on the <html> element.",
          recommendation: 'Add lang="en" (or the page\'s language) to the html element.',
        }),
      ];
    },
  },
  {
    code: "noindex-page",
    category: "seo",
    scope: "page",
    run: (context) => {
      const directives = (context.parsed.metaRobots ?? "").toLowerCase();
      if (!directives.includes("noindex")) return [];
      return [
        findingFor(context, "page", {
          code: "noindex-page",
          category: "seo",
          title: "Page asks search engines not to index it",
          severity: "high",
          description:
            "A noindex directive removes the page from search results. That is correct for a thank-you page and a defect on a page that should be found.",
          evidence: `Meta robots: "${excerpt(context.parsed.metaRobots ?? "")}"`,
          recommendation: "Remove the noindex directive unless this page is deliberately hidden from search.",
        }),
      ];
    },
  },
  {
    code: "canonical-mismatch",
    category: "seo",
    scope: "page",
    run: (context) => {
      const canonical = context.parsed.canonical;
      if (canonical === null) return [];
      const declared = normalizeUrl(canonical, context.finalUrl)?.href ?? canonical;
      const served = normalizeUrl(context.finalUrl)?.href ?? context.finalUrl;
      if (declared === served) return [];
      return [
        findingFor(context, "page", {
          code: "canonical-mismatch",
          category: "seo",
          title: "Canonical points at a different URL",
          severity: "low",
          description:
            "The canonical URL tells a search engine which address is the real one. When it is not the address served, ranking signals are credited elsewhere — intentional for pagination, a mistake otherwise.",
          evidence: `Page served as ${served}, canonical says ${declared}.`,
          recommendation:
            "Point the canonical at the page's own URL, or confirm the consolidation is intended.",
        }),
      ];
    },
  },
  {
    code: "missing-open-graph",
    category: "seo",
    scope: "page",
    run: (context) => {
      const tags = new Set(context.parsed.ogTags);
      if (tags.has("og:title") && tags.has("og:description") && tags.has("og:image")) return [];
      const missing = ["og:title", "og:description", "og:image"].filter((tag) => !tags.has(tag));
      return [
        findingFor(context, "page", {
          code: "missing-open-graph",
          category: "seo",
          title: "Page has no complete Open Graph preview",
          severity: "low",
          description:
            "Open Graph tags decide how a link looks when it is shared. Without them a chat app shows a bare URL or a random image from the page.",
          evidence: `Missing: ${missing.join(", ")}.`,
          recommendation:
            "Add og:title, og:description and og:image so shared links render a proper preview.",
        }),
      ];
    },
  },
];

/** Exported for tests: the codes this module owns, in declaration order. */
export const SEO_RULE_CODES: readonly string[] = SEO_RULES.map((rule) => rule.code);

export type { PageAuditContext, RuleFinding };
