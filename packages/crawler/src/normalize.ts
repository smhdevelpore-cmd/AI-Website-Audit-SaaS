/**
 * URL normalisation and the discovery policy.
 *
 * Two different jobs, both about not wasting a page budget:
 *
 *  - `normalizeUrl` decides whether two links are the same page. `/about`, `/about#team` and
 *    `https://example.com/about` are one page, and crawling it twice would spend an audit's
 *    allowance on a duplicate.
 *  - `shouldFollow` decides whether a link is worth a request at all. Images, downloads, login
 *    screens and forms are not pages, and the TRD says not to fetch them.
 *
 * Both are deliberately conservative: a page we skip costs a finding, a page we fetch costs
 * someone else's bandwidth and our time budget.
 */

const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "zip",
  "gz",
  "tar",
  "rar",
  "7z",
  "exe",
  "dmg",
  "apk",
  "iso",
  "bin",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "webp",
  "avif",
  "ico",
  "bmp",
  "tiff",
  "css",
  "js",
  "mjs",
  "map",
  "json",
  "xml",
  "txt",
  "csv",
  "rss",
  "atom",
  "mp3",
  "mp4",
  "m4a",
  "wav",
  "ogg",
  "webm",
  "mov",
  "avi",
  "mkv",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
]);

/**
 * Paths that are almost certainly an authentication screen or a form handler. Fetching them
 * cannot measure anything useful, and following a logout link could end someone's session if the
 * site were ever crawled with a cookie (we never send one). Both reasons point the same way.
 */
const AUTH_PATTERNS: readonly RegExp[] = [
  /(^|\/)(log-?in|sign-?in|sign-?up|register|logout|log-?out|password|reset|forgot)(\/|$|\.)/i,
  /(^|\/)wp-(login|admin)(\.php)?$/i,
  /(^|\/)(cart|checkout|basket|payment)(\/|$)/i,
  /(^|\/)(admin|administrator|dashboard)(\/|$)/i,
  /(^|\/)(cgi-bin)(\/|$)/i,
];

export interface NormalizeResult {
  readonly href: string;
  readonly origin: string;
  readonly path: string;
}

/** `null` when the value cannot be a page address at all. */
export function normalizeUrl(raw: string, base?: string): NormalizeResult | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let url: URL;
  try {
    url = base === undefined ? new URL(trimmed) : new URL(trimmed, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;

  // A fragment is a position on a page, never a second page.
  url.hash = "";
  // `?` with nothing after it is noise; `?a=1` is not, and is kept verbatim. The parser keeps the
  // lone `?` in `href` while reporting an empty `search`, so round-trip it through the setter.
  const search = url.search;
  url.search = "";
  if (search !== "") url.search = search;

  return { href: url.href, origin: url.origin, path: `${url.pathname}${url.search}` };
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function hasAssetExtension(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const lastSegment = path.slice(path.lastIndexOf("/") + 1);
    if (lastSegment === "" || !lastSegment.includes(".")) return false;
    const extension = lastSegment.slice(lastSegment.lastIndexOf(".") + 1);
    return ASSET_EXTENSIONS.has(extension);
  } catch {
    return true;
  }
}

export function looksLikeAuthOrForm(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return AUTH_PATTERNS.some((pattern) => pattern.test(path));
  } catch {
    return true;
  }
}

export interface FollowOptions {
  readonly origin: string;
  /** Depth the link would be fetched at. */
  readonly depth: number;
  readonly maxDepth: number;
}

/** Whether a discovered link may be added to the crawl queue. */
export function shouldFollow(href: string, options: FollowOptions): boolean {
  if (options.depth > options.maxDepth) return false;
  if (!isSameOrigin(href, options.origin)) return false;
  if (hasAssetExtension(href)) return false;
  if (looksLikeAuthOrForm(href)) return false;
  return true;
}
