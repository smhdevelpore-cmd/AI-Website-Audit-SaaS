/**
 * Bounded page discovery (TRD §7, PRD FR-05).
 *
 * The crawl is a breadth-first walk of one origin, and every bound is enforced here rather than
 * assumed of the code below:
 *
 *   pages ≤ maxPages · depth ≤ maxDepth · concurrency ≤ perHostConcurrency · sitemap URLs ≤ cap
 *
 * Order of business: robots.txt, then sitemaps, then the start page, then links. robots.txt is
 * read first because it is the site's stated policy and it names the sitemaps; the start page is
 * fetched even when robots.txt disallows it, because the user asked for that page by name. Links
 * that robots.txt disallows are never fetched.
 */

import type { HostResolver } from "@siteaudit/validation";

import { safeFetch, type FetchFailureCode, type SafeFetchOptions } from "./fetch.js";
import { parsePage, type ParsedPage } from "./html.js";
import {
  DEFAULT_CRAWL_LIMITS,
  DEFAULT_FETCH_LIMITS,
  DEFAULT_USER_AGENT,
  MAX_CRAWL_DEPTH,
  type CrawlLimits,
  type FetchLimits,
} from "./limits.js";
import { hasAssetExtension, normalizeUrl, shouldFollow } from "./normalize.js";
import {
  EMPTY_ROBOTS,
  isAllowedByRobots,
  parseRobots,
  sameOriginSitemaps,
  type RobotsPolicy,
} from "./robots.js";
import { parseSitemap } from "./sitemap.js";

export interface CrawlOptions {
  readonly startUrl: string;
  readonly maxPages?: number;
  readonly crawlLimits?: Partial<CrawlLimits>;
  readonly fetchLimits?: Partial<FetchLimits>;
  readonly resolver?: HostResolver;
  readonly assertAddress?: (address: string) => void;
  /** See `SafeFetchOptions.allowedPorts`: test fixtures only. */
  readonly allowedPorts?: readonly number[];
  readonly userAgent?: string;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}

export interface CrawledPage {
  /** The URL we requested. */
  readonly url: string;
  /** Where the content came from, after redirects (equals `url` when there were none). */
  readonly finalUrl: string;
  readonly depth: number;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly byteSize: number;
  readonly durationMs: number;
  readonly title: string | null;
  readonly parsed: ParsedPage | null;
  /** Set when the page could not be fetched. The code only: no addresses, no error text. */
  readonly error: FetchFailureCode | null;
  readonly fetchedAt: string;
}

export interface CrawlSummary {
  readonly origin: string;
  readonly pages: readonly CrawledPage[];
  readonly robots: {
    readonly present: boolean;
    readonly sitemaps: readonly string[];
  };
  /** URLs taken from sitemaps and considered. */
  readonly sitemapUrls: number;
  /** Discovered URLs not fetched, and why — the audit's limitations section needs this. */
  readonly skipped: {
    readonly robots: number;
    readonly pageCap: number;
    readonly assets: number;
    readonly offOrigin: number;
  };
  readonly startedAt: string;
  readonly finishedAt: string;
}

interface QueueItem {
  readonly url: string;
  readonly depth: number;
}

export async function crawlSite(options: CrawlOptions): Promise<CrawlSummary> {
  const limits: CrawlLimits = { ...DEFAULT_CRAWL_LIMITS, ...options.crawlLimits };
  const fetchLimits: FetchLimits = { ...DEFAULT_FETCH_LIMITS, ...options.fetchLimits };
  // Depth is written to `audit_pages.depth`, whose schema check stops at MAX_CRAWL_DEPTH.
  const maxDepth = Math.max(0, Math.min(limits.maxDepth, MAX_CRAWL_DEPTH));
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const start = normalizeUrl(options.startUrl);
  if (start === null) throw new Error("the start URL is not an http(s) page address");
  const origin = start.origin;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? limits.maxPages, limits.maxPages));

  const fetchOptions = (overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions => ({
    limits: fetchLimits,
    userAgent,
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    ...(options.assertAddress === undefined ? {} : { assertAddress: options.assertAddress }),
    ...(options.allowedPorts === undefined ? {} : { allowedPorts: options.allowedPorts }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...overrides,
  });

  // Policy files are allowed to be text/plain and small; they are not pages.
  const policyOptions = (): SafeFetchOptions =>
    fetchOptions({
      limits: {
        ...fetchLimits,
        maxBytes: limits.maxPolicyBytes,
        allowedContentTypes: ["text/plain", "text/html", "application/xml", "text/xml"],
        totalTimeoutMs: Math.min(fetchLimits.totalTimeoutMs, 8_000),
      },
    });

  /* ------------------------------------------------------------------ robots */

  let policy: RobotsPolicy = EMPTY_ROBOTS;
  const robotsResult = await safeFetch(`${origin}/robots.txt`, policyOptions());
  if (robotsResult.ok && robotsResult.status >= 200 && robotsResult.status < 300) {
    policy = parseRobots(robotsResult.body);
  }

  /* ----------------------------------------------------------------- sitemaps */

  const sitemapCandidates = sameOriginSitemaps(policy, origin, 3);
  if (sitemapCandidates.length === 0) sitemapCandidates.push(`${origin}/sitemap.xml`);

  const sitemapUrls: string[] = [];
  for (const candidate of sitemapCandidates) {
    if (sitemapUrls.length >= limits.maxSitemapUrls) break;
    const result = await safeFetch(candidate, policyOptions());
    if (!result.ok || result.status < 200 || result.status >= 300) continue;

    const contents = parseSitemap(result.body, limits.maxSitemapUrls);
    const children = contents.kind === "sitemapindex" ? contents.sitemaps.slice(0, 2) : [];
    const locations = [...contents.pages, ...children];

    for (const location of locations) {
      if (sitemapUrls.length >= limits.maxSitemapUrls) break;
      const normalized = normalizeUrl(location, origin);
      if (normalized === null || normalized.origin !== origin) continue;
      if (hasAssetExtension(normalized.href)) continue;
      sitemapUrls.push(normalized.href);
    }
  }

  /* -------------------------------------------------------------------- queue */

  const seen = new Set<string>([start.href]);
  const queue: QueueItem[] = [{ url: start.href, depth: 0 }];
  const skipped = { robots: 0, pageCap: 0, assets: 0, offOrigin: 0 };

  // A sitemap is a *discovered* URL like any other, so robots.txt governs it. Only the start page,
  // which the user named explicitly, is fetched regardless of the policy.
  for (const url of sitemapUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (!isAllowedByRobots(policy, url, userAgent)) {
      skipped.robots += 1;
      continue;
    }
    if (queue.length - 1 >= maxPages) {
      skipped.pageCap += 1;
      continue;
    }
    queue.push({ url, depth: 1 });
  }

  const pages: CrawledPage[] = [];
  let cursor = 0;

  const fetchPage = async (item: QueueItem): Promise<CrawledPage> => {
    const fetchedAt = now().toISOString();
    const result = await safeFetch(item.url, fetchOptions());

    if (!result.ok) {
      return {
        url: item.url,
        finalUrl: result.url,
        depth: item.depth,
        status: null,
        contentType: null,
        byteSize: 0,
        durationMs: result.durationMs,
        title: null,
        parsed: null,
        error: result.code,
        fetchedAt,
      };
    }

    const parsed = parsePage(result.body, result.finalUrl, { maxLinks: limits.maxLinksPerPage });
    return {
      url: item.url,
      finalUrl: result.finalUrl,
      depth: item.depth,
      status: result.status,
      contentType: result.contentType,
      byteSize: result.byteSize,
      durationMs: result.durationMs,
      title: parsed.title,
      parsed,
      error: null,
      fetchedAt,
    };
  };

  const accept = (href: string, depth: number): void => {
    if (seen.has(href)) return;
    if (depth > maxDepth) return;
    if (!shouldFollow(href, { origin, depth, maxDepth })) {
      skipped.assets += 1;
      return;
    }
    if (!isAllowedByRobots(policy, href, userAgent)) {
      skipped.robots += 1;
      seen.add(href);
      return;
    }
    if (pages.length + (queue.length - cursor) >= maxPages) {
      skipped.pageCap += 1;
      seen.add(href);
      return;
    }
    seen.add(href);
    queue.push({ url: href, depth });
  };

  while (cursor < queue.length && pages.length < maxPages) {
    const batch: QueueItem[] = [];
    while (
      cursor < queue.length &&
      batch.length < Math.max(1, limits.perHostConcurrency) &&
      pages.length + batch.length < maxPages
    ) {
      const item = queue[cursor];
      cursor += 1;
      if (item !== undefined) batch.push(item);
    }
    if (batch.length === 0) break;

    const fetched = await Promise.all(batch.map((item) => fetchPage(item)));

    for (const page of fetched) {
      pages.push(page);
      if (page.parsed === null || page.error !== null) continue;
      if (page.parsed.nofollow) continue; // the page asked us not to follow its links
      for (const href of page.parsed.links) {
        if (page.depth + 1 > maxDepth) break;
        accept(href, page.depth + 1);
      }
    }
  }

  return {
    origin,
    pages,
    robots: { present: policy.present, sitemaps: policy.sitemaps.slice(0, 10) },
    sitemapUrls: sitemapUrls.length,
    skipped,
    startedAt,
    finishedAt: now().toISOString(),
  };
}

/** Convenience for tests and callers that only need the count. */
export function pagesWithinCap(summary: CrawlSummary, cap: number): boolean {
  return summary.pages.length <= cap;
}
