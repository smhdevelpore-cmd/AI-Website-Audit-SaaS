/**
 * sitemap.xml, read without an XML parser.
 *
 * Deliberate choice: a real XML parser is an attack surface (entity expansion, external
 * entities, deeply nested documents) and the format we consume is two element names and a
 * `<loc>`. This scanner therefore *cannot* be made to fetch or expand anything, and it cannot
 * recurse: a `<sitemapindex>` returns child locations for the caller to decide about, up to a
 * caller-supplied limit.
 */

export interface SitemapContents {
  readonly kind: "urlset" | "sitemapindex" | "unknown";
  /** Page URLs from a urlset. Empty for an index. */
  readonly pages: readonly string[];
  /** Child sitemap URLs from an index. Empty for a urlset. */
  readonly sitemaps: readonly string[];
  /** True when the document had more entries than the limit allowed. */
  readonly truncated: boolean;
}

const LOC = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseSitemap(xml: string, limit: number): SitemapContents {
  const head = xml.slice(0, 4_000).toLowerCase();
  const kind: SitemapContents["kind"] = head.includes("<sitemapindex")
    ? "sitemapindex"
    : head.includes("<urlset")
      ? "urlset"
      : "unknown";

  const found: string[] = [];
  let truncated = false;

  for (const match of xml.matchAll(LOC)) {
    const value = decodeEntities((match[1] ?? "").trim());
    if (value === "") continue;
    if (found.length >= limit) {
      truncated = true;
      break;
    }
    found.push(value);
  }

  return kind === "sitemapindex"
    ? { kind, pages: [], sitemaps: found, truncated }
    : { kind, pages: found, sitemaps: [], truncated };
}
