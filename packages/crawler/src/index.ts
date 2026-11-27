export { safeFetch } from "./fetch.js";
export type { FetchFailure, FetchFailureCode, FetchResult, FetchSuccess, SafeFetchOptions } from "./fetch.js";

export {
  DEFAULT_CRAWL_LIMITS,
  DEFAULT_FETCH_LIMITS,
  DEFAULT_USER_AGENT,
  MAX_CRAWL_DEPTH,
  STORED_HEADERS,
  pickStoredHeaders,
  requestHeaders,
} from "./limits.js";
export type { CrawlLimits, FetchLimits } from "./limits.js";

export { crawlSite } from "./crawl.js";
export type { CrawlOptions, CrawlSummary, CrawledPage } from "./crawl.js";

export { parsePage } from "./html.js";
export type { ParseOptions, ParsedPage } from "./html.js";

export { toPageRows } from "./page-rows.js";
export type { AuditPageRow } from "./page-rows.js";

export {
  hasAssetExtension,
  isSameOrigin,
  looksLikeAuthOrForm,
  normalizeUrl,
  shouldFollow,
} from "./normalize.js";
export type { FollowOptions, NormalizeResult } from "./normalize.js";

export {
  EMPTY_ROBOTS,
  isAllowedByRobots,
  parseRobots,
  productToken,
  robotsPath,
  sameOriginSitemaps,
} from "./robots.js";
export type { RobotsGroup, RobotsPolicy } from "./robots.js";

export { parseSitemap } from "./sitemap.js";
export type { SitemapContents } from "./sitemap.js";
