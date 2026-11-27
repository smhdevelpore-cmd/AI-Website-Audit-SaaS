/**
 * The crawler's pure parts: URL normalisation, robots.txt, sitemap.xml and the HTML extractor.
 *
 * No network here — these are the functions that decide *what* a crawl does, so they are tested
 * with adversarial strings rather than with a server.
 */

import {
  hasAssetExtension,
  isAllowedByRobots,
  looksLikeAuthOrForm,
  normalizeUrl,
  parsePage,
  parseRobots,
  parseSitemap,
  productToken,
  shouldFollow,
} from "@siteaudit/crawler";
import { describe, expect, it } from "vitest";

describe("normalizeUrl", () => {
  it("drops the fragment, because it is a position on a page and not another page", () => {
    expect(normalizeUrl("https://example.com/a#team")?.href).toBe("https://example.com/a");
  });

  it("keeps a meaningful query string and drops an empty one", () => {
    expect(normalizeUrl("https://example.com/a?page=2")?.href).toBe("https://example.com/a?page=2");
    expect(normalizeUrl("https://example.com/a?")?.href).toBe("https://example.com/a");
  });

  it("resolves a relative link against its page", () => {
    expect(normalizeUrl("../b", "https://example.com/x/y/")?.href).toBe("https://example.com/x/b");
    expect(normalizeUrl("/b", "https://example.com/x/y")?.href).toBe("https://example.com/b");
  });

  it("refuses anything that is not an http(s) page with no credentials", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("mailto:hi@example.com")).toBeNull();
    expect(normalizeUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeUrl("https://user:pass@example.com/")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("lowercases the host and drops the default port", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/Page")?.href).toBe("https://example.com/Page");
  });
});

describe("discovery policy", () => {
  it("recognises files that are not pages", () => {
    expect(hasAssetExtension("https://example.com/report.pdf")).toBe(true);
    expect(hasAssetExtension("https://example.com/logo.PNG?x=1")).toBe(true);
    expect(hasAssetExtension("https://example.com/about")).toBe(false);
    expect(hasAssetExtension("https://example.com/v1.2/notes")).toBe(false);
  });

  it("recognises the screens we must not crawl", () => {
    expect(looksLikeAuthOrForm("https://example.com/login")).toBe(true);
    expect(looksLikeAuthOrForm("https://example.com/wp-login.php")).toBe(true);
    expect(looksLikeAuthOrForm("https://example.com/sign-up/step-2")).toBe(true);
    expect(looksLikeAuthOrForm("https://example.com/checkout")).toBe(true);
    expect(looksLikeAuthOrForm("https://example.com/pricing")).toBe(false);
    // A blog post whose slug happens to say "log-in" is a page we do want to audit.
    expect(looksLikeAuthOrForm("https://example.com/blog/log-in-to-your-pension")).toBe(false);
  });

  it("follows only same-origin pages within depth", () => {
    const options = { origin: "https://example.com", depth: 1, maxDepth: 2 };
    expect(shouldFollow("https://example.com/about", options)).toBe(true);
    expect(shouldFollow("https://other.example/about", options)).toBe(false);
    expect(shouldFollow("https://example.com/brochure.pdf", options)).toBe(false);
    expect(shouldFollow("https://example.com/login", options)).toBe(false);
    expect(shouldFollow("https://example.com/about", { ...options, depth: 3 })).toBe(false);
  });
});

describe("robots.txt", () => {
  const policy = parseRobots(
    [
      "# a comment",
      "User-agent: *",
      "Disallow: /private",
      "",
      "User-agent: SiteAuditBot",
      "Disallow: /",
      "Allow: /public",
      "",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n"),
  );

  it("reads our own group rather than the wildcard one", () => {
    expect(productToken("SiteAuditBot/0.1 (+https://example.com/bot)")).toBe("siteauditbot");
    expect(isAllowedByRobots(policy, "https://example.com/blog", "SiteAuditBot/0.1")).toBe(false);
    expect(isAllowedByRobots(policy, "https://example.com/public/page", "SiteAuditBot/0.1")).toBe(true);
  });

  it("falls back to the wildcard group for another crawler", () => {
    expect(isAllowedByRobots(policy, "https://example.com/private/x", "SomeOtherBot/2.0")).toBe(false);
    expect(isAllowedByRobots(policy, "https://example.com/public", "SomeOtherBot/2.0")).toBe(true);
  });

  it("collects sitemap declarations", () => {
    expect(policy.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("treats a missing file as permission", () => {
    const empty = parseRobots("");
    expect(isAllowedByRobots(empty, "https://example.com/anything", "SiteAuditBot/0.1")).toBe(true);
  });

  it("honours the longest match, with Allow winning a tie", () => {
    const longest = parseRobots(["User-agent: *", "Disallow: /shop", "Allow: /shop/sale"].join("\n"));
    expect(isAllowedByRobots(longest, "https://example.com/shop/cart", "x")).toBe(false);
    expect(isAllowedByRobots(longest, "https://example.com/shop/sale/x", "x")).toBe(true);

    const tie = parseRobots(["User-agent: *", "Disallow: /page", "Allow: /page"].join("\n"));
    expect(isAllowedByRobots(tie, "https://example.com/page", "x")).toBe(true);
  });

  it("treats an empty Disallow as 'allow everything' rather than as a rule", () => {
    const permissive = parseRobots(["User-agent: *", "Disallow:"].join("\n"));
    expect(isAllowedByRobots(permissive, "https://example.com/anything", "x")).toBe(true);
  });

  it("supports wildcards and end anchors", () => {
    const wildcard = parseRobots(["User-agent: *", "Disallow: /*.pdf$"].join("\n"));
    expect(isAllowedByRobots(wildcard, "https://example.com/report.pdf", "x")).toBe(false);
    expect(isAllowedByRobots(wildcard, "https://example.com/report.pdf.html", "x")).toBe(true);
  });
});

describe("sitemap.xml", () => {
  it("reads page locations from a urlset and decodes entities", () => {
    const contents = parseSitemap(
      `<?xml version="1.0"?><urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url>` +
        `<url><loc>https://example.com/b</loc></url></urlset>`,
      10,
    );

    expect(contents.kind).toBe("urlset");
    expect(contents.pages).toEqual(["https://example.com/a?x=1&y=2", "https://example.com/b"]);
  });

  it("reads child sitemaps from an index without recursing", () => {
    const contents = parseSitemap(
      `<sitemapindex><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>`,
      10,
    );

    expect(contents.kind).toBe("sitemapindex");
    expect(contents.sitemaps).toEqual(["https://example.com/sitemap-1.xml"]);
    expect(contents.pages).toEqual([]);
  });

  it("bounds the number of locations it will return", () => {
    const contents = parseSitemap(
      `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>https://example.com/${i}</loc></url>`).join("")}</urlset>`,
      3,
    );

    expect(contents.pages).toHaveLength(3);
    expect(contents.truncated).toBe(true);
  });

  it("does not expand anything, because it is not an XML parser", () => {
    const contents = parseSitemap(
      `<!DOCTYPE foo SYSTEM "file:///etc/passwd"><urlset><url><loc>https://example.com/&xxe;</loc></url></urlset>`,
      10,
    );
    expect(contents.pages).toEqual(["https://example.com/&xxe;"]);
  });
});

describe("parsePage", () => {
  const html = `<!doctype html>
    <html lang="en-GB">
      <head>
        <title>  Acme   Plumbing  </title>
        <meta name="description" content="Emergency plumbers.">
        <meta name="robots" content="noindex, nofollow">
        <link rel="canonical" href="/plumbing">
        <base href="https://example.com/base/">
      </head>
      <body>
        <h1>Plumbing</h1><h1>Second</h1>
        <h2>Sub</h2>
        <a href="/about">About</a>
        <a href="contact">Contact</a>
        <a href="/about#team">About again</a>
        <a href="https://other.example/">Elsewhere</a>
        <a href="mailto:x@example.com">Mail</a>
        <a href="report.pdf">PDF</a>
        <img src="a.png" alt="A">
        <img src="b.png">
        <img src="c.png" alt="">
        <script>var ignored = 1;</script>
        <style>.ignored{}</style>
        <p>Some visible text for the page.</p>
      </body>
    </html>`;

  const parsed = parsePage(html, "https://example.com/", { maxLinks: 100 });

  it("extracts the fields the rules need", () => {
    expect(parsed.title).toBe("Acme Plumbing");
    expect(parsed.lang).toBe("en-GB");
    expect(parsed.metaDescription).toBe("Emergency plumbers.");
    expect(parsed.metaRobots).toContain("nofollow");
    expect(parsed.canonical).toBe("https://example.com/plumbing");
    expect(parsed.h1Count).toBe(2);
    expect(parsed.headings.h2).toBe(1);
    expect(parsed.images).toBe(3);
    expect(parsed.imagesWithoutAlt).toBe(2);
  });

  it("resolves links against <base> and de-duplicates them", () => {
    expect(parsed.baseHref).toBe("https://example.com/base/");
    // A relative link resolves against <base>; a root-relative one always resolves against the origin.
    expect(parsed.links).toContain("https://example.com/base/contact");
    expect(parsed.links).toContain("https://example.com/about");
    // Assets are listed here and filtered later by `shouldFollow`, not hidden from the extractor.
    expect(parsed.links).toContain("https://example.com/base/report.pdf");
    // `/about` and `/about#team` normalise to the same page.
    expect(parsed.links.filter((link) => link.endsWith("/about"))).toHaveLength(1);
  });

  it("counts internal and external links, and skips schemes it cannot fetch", () => {
    expect(parsed.internalLinks).toBeGreaterThan(0);
    expect(parsed.externalLinks).toBe(1);
    expect(parsed.links.some((link) => link.startsWith("mailto:"))).toBe(false);
  });

  it("marks the page nofollow and measures visible text only", () => {
    expect(parsed.nofollow).toBe(true);
    expect(parsed.textLength).toBeGreaterThan(0);
    expect(parsed.textLength).toBeLessThan(html.length);
  });

  it("caps the number of links it keeps", () => {
    const many = `<html><body>${Array.from({ length: 50 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("")}</body></html>`;
    const capped = parsePage(many, "https://example.com/", { maxLinks: 10 });
    expect(capped.links).toHaveLength(10);
    expect(capped.internalLinks).toBe(50);
  });

  it("survives a page with no head and no links", () => {
    const bare = parsePage("<p>nothing here</p>", "https://example.com/", { maxLinks: 10 });
    expect(bare.title).toBeNull();
    expect(bare.lang).toBeNull();
    expect(bare.links).toEqual([]);
    expect(bare.h1Count).toBe(0);
  });
});
