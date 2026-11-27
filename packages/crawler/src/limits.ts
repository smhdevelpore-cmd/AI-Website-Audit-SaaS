/**
 * The crawler's limits, in one place (TRD §7).
 *
 * Every number here is a ceiling on something an untrusted server controls: how long it may take
 * to answer, how much it may send, how many times it may redirect us. None of them are advisory —
 * `fetch.ts` enforces each one by destroying the socket, not by hoping the peer behaves.
 */

export interface FetchLimits {
  /** Time allowed to establish the TCP connection (and the TLS handshake). */
  readonly connectTimeoutMs: number;
  /** Time allowed for a hop to produce a complete response, redirects excluded. */
  readonly hopTimeoutMs: number;
  /** Time allowed for the whole chain, redirects included. This is the one that cannot be talked past. */
  readonly totalTimeoutMs: number;
  /** Bytes of body we will read. Anything beyond is discarded and the fetch fails. */
  readonly maxBytes: number;
  /** Redirects followed before giving up. Each hop is revalidated from scratch. */
  readonly maxRedirects: number;
  /** Only these are pages. Anything else is not parsed and not stored as HTML. */
  readonly allowedContentTypes: readonly string[];
  /** Bound on the `Location` chain's memory: we keep every visited URL to detect loops. */
  readonly maxUrlLength: number;
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  connectTimeoutMs: 5_000,
  hopTimeoutMs: 10_000,
  totalTimeoutMs: 12_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  allowedContentTypes: ["text/html", "application/xhtml+xml"],
  maxUrlLength: 2_048,
};

/**
 * The deepest page a crawl may record. `audit_pages_depth_range` in the schema allows 0–10, so a
 * crawl that went deeper could not be stored; the crawler stops at the schema rather than at the
 * first failed insert.
 */
export const MAX_CRAWL_DEPTH = 10;

export interface CrawlLimits {
  /** Pages fetched in one audit, including the start page. */
  readonly maxPages: number;
  /** Link depth from the start page. The start page is depth 0. */
  readonly maxDepth: number;
  /** Simultaneous requests to one host. */
  readonly perHostConcurrency: number;
  /** URLs carried over from robots.txt/sitemap discovery, so a huge sitemap cannot flood the queue. */
  readonly maxSitemapUrls: number;
  /** Bytes of robots.txt / sitemap.xml we will read. These are small files by convention. */
  readonly maxPolicyBytes: number;
  /** Links parsed from one page, so a page of 100 000 anchors costs us a corollary amount of memory. */
  readonly maxLinksPerPage: number;
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = {
  maxPages: 10,
  maxDepth: 2,
  perHostConcurrency: 2,
  maxSitemapUrls: 100,
  maxPolicyBytes: 512 * 1024,
  maxLinksPerPage: 500,
};

/** Sent on every request. An operator must be able to find out who is hitting their site, and why. */
export const DEFAULT_USER_AGENT = "SiteAuditBot/0.1 (+https://example.com/bot)";

/** Headers we send. Deliberately minimal: no cookies, no auth, no compression. */
export function requestHeaders(userAgent: string): Record<string, string> {
  return {
    // `identity` matters twice: no gzip means an unbounded decompression cannot bypass the byte
    // cap, and the body we measure is the body we received.
    "accept-encoding": "identity",
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    "user-agent": userAgent,
    connection: "close",
  };
}
