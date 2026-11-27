/**
 * What a rule sees, and what it may say (TRD §8).
 *
 * A rule is a pure function of one crawled page plus a small set of site-level facts. It has no
 * I/O, no clock and no randomness: the same page and the same facts must produce the same
 * findings, or the score they feed is not reproducible.
 *
 * `PageAuditContext` deliberately contains the *parsed* page rather than raw HTML. The parser is
 * part of the crawler, so a rule cannot re-implement "what counts as a title" and disagree with
 * what was stored in `audit_pages.parsed`.
 */

import type { ParsedPage } from "@siteaudit/crawler";
import type { AuditCategory, FindingConfidence, Severity } from "@siteaudit/shared-types";

/** Facts about the site as a whole, gathered once per audit and shared by every page. */
export interface SiteFacts {
  readonly origin: string;
  /** The audit's own scheme: an `http://` submission is a finding, not an accident of redirects. */
  readonly usesHttps: boolean;
  readonly robotsPresent: boolean;
  /** A sitemap was declared by robots.txt or found at `/sitemap.xml`, whatever it contained. */
  readonly hasSitemap: boolean;
  /** Pages whose HTML we actually parsed. */
  readonly pagesFetched: number;
  /** Pages the crawl requested, including the ones that failed. */
  readonly pagesAttempted: number;
  /** Requested URL → final status, for every page the crawl touched. The link rule reads this. */
  readonly pageStatuses: ReadonlyMap<string, number | null>;
}

export interface PageAuditContext {
  /** The URL we requested. This is the page a finding is filed against. */
  readonly url: string;
  /** Where the content came from after redirects. */
  readonly finalUrl: string;
  readonly status: number;
  /** The stored header subset (`STORED_HEADERS`); an absent header reads as absent. */
  readonly headers: Readonly<Record<string, string>>;
  readonly durationMs: number;
  readonly byteSize: number;
  readonly parsed: ParsedPage;
  readonly depth: number;
  readonly isStartPage: boolean;
  readonly site: SiteFacts;
}

/**
 * A finding before it has an id, an audit or a status.
 *
 * `pageUrl` is `null` for a site-wide finding: "there is no robots.txt" is not a property of the
 * homepage, and filing it there would make the report point at a page that is fine.
 */
export interface RuleFinding {
  readonly issueCode: string;
  readonly category: AuditCategory;
  readonly title: string;
  readonly severity: Severity;
  readonly description: string;
  readonly pageUrl: string | null;
  readonly evidence: string;
  readonly recommendation: string;
  readonly confidence: FindingConfidence;
}

export interface AuditRule {
  /** The issue code this rule emits. One rule, one code: a code that means two things is two codes. */
  readonly code: string;
  readonly category: AuditCategory;
  readonly scope: "page" | "site";
  /**
   * Whether this rule has anything to say about this page. A rule that does not apply does not
   * count as evidence that its category was checked — that is what keeps N/A honest.
   */
  readonly applies?: (context: PageAuditContext) => boolean;
  run(context: PageAuditContext): readonly RuleFinding[];
}

/** Longest snippet of page-controlled text kept in evidence. The report renders this string. */
export const MAX_EVIDENCE_TEXT = 120;

/** Page text is untrusted and unbounded; a finding carries a sample, never the text. */
export function excerpt(value: string, max = MAX_EVIDENCE_TEXT): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface FindingInput {
  readonly code: string;
  readonly category: AuditCategory;
  readonly title: string;
  readonly severity: Severity;
  readonly description: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly confidence?: FindingConfidence;
}

/** Builds a finding, filling the page (or site) scope from the rule's own scope. */
export function findingFor(
  context: PageAuditContext,
  scope: "page" | "site",
  input: FindingInput,
): RuleFinding {
  return {
    issueCode: input.code,
    category: input.category,
    title: input.title,
    severity: input.severity,
    description: input.description,
    pageUrl: scope === "site" ? null : context.url,
    evidence: input.evidence,
    recommendation: input.recommendation,
    confidence: input.confidence ?? "observed",
  };
}
