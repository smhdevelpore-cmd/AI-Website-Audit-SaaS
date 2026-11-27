/**
 * The rule engine, against pages built by the real parser.
 *
 * Every fixture goes through `parsePage`, so a rule is tested against what the crawler actually
 * stores rather than against a hand-written `ParsedPage` that could drift from the parser. A rule
 * that only passes because a test constructed its input is a rule that will not fire in production.
 */

import { parsePage, type CrawlSummary, type CrawledPage } from "@siteaudit/crawler";
import { runRules } from "@siteaudit/audit-rules";
import { describe, expect, it } from "vitest";

const START = "https://example.com/";

interface PageFixture {
  readonly url?: string;
  readonly html?: string;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly durationMs?: number;
  readonly byteSize?: number;
  readonly error?: CrawledPage["error"];
  readonly depth?: number;
}

const ALL_SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/** A page that violates nothing. Each test breaks exactly one thing. */
function cleanHtml(url = START): string {
  return `<!doctype html>
    <html lang="en">
      <head>
        <title>Plumbing services in Leeds and Yorkshire</title>
        <meta name="description" content="Emergency and planned plumbing across Leeds.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="${url}">
        <meta property="og:title" content="Plumbing in Leeds">
        <meta property="og:description" content="Emergency and planned plumbing.">
        <meta property="og:image" content="https://example.com/og.png">
      </head>
      <body>
        <h1>Plumbing in Leeds</h1>
        <h2>Boilers</h2>
        <h3>Repairs</h3>
        <p>We fix boilers, baths and leaks across the city.</p>
        <a href="/contact">Contact us</a>
        <img src="/van.png" alt="Our van outside the workshop">
        <form><label for="email">Email</label><input id="email" type="email"></form>
      </body>
    </html>`;
}

function crawl(pages: readonly PageFixture[]): CrawlSummary {
  const crawled: CrawledPage[] = pages.map((page, index) => {
    const url = page.url ?? START;
    const html = page.html ?? cleanHtml(url);
    return {
      url,
      finalUrl: url,
      depth: page.depth ?? index,
      status: page.status ?? 200,
      contentType: "text/html",
      headers: page.headers ?? ALL_SECURITY_HEADERS,
      byteSize: page.byteSize ?? html.length,
      durationMs: page.durationMs ?? 120,
      title: null,
      parsed: page.error == null ? parsePage(html, url, { maxLinks: 500 }) : null,
      error: page.error ?? null,
      fetchedAt: "2026-11-27T12:00:00.000Z",
    };
  });

  return {
    origin: new URL(START).origin,
    pages: crawled,
    robots: { present: true, sitemaps: [`${new URL(START).origin}/sitemap.xml`] },
    sitemapUrls: 2,
    skipped: { robots: 0, pageCap: 0, assets: 0, offOrigin: 0 },
    startedAt: "2026-11-27T12:00:00.000Z",
    finishedAt: "2026-11-27T12:00:01.000Z",
  };
}

function codes(pages: readonly PageFixture[]): string[] {
  return runRules({ startUrl: START, crawl: crawl(pages), hasSitemap: true }).findings.map(
    (finding) => finding.issueCode,
  );
}

describe("the clean page", () => {
  it("produces no findings at all", () => {
    expect(codes([{}])).toEqual([]);
  });

  it("still marks every category as evaluated", () => {
    const outcome = runRules({ startUrl: START, crawl: crawl([{}]), hasSitemap: true });

    // Nothing to report is not the same as nothing checked: this is what makes a 100 honest.
    expect(outcome.evaluated).toEqual([
      "performance",
      "seo",
      "technical",
      "mobile",
      "accessibility",
      "security",
      "links",
    ]);
  });
});

describe("SEO rules", () => {
  it("flags a page with no title", () => {
    const html = cleanHtml().replace(/<title>.*<\/title>/, "");
    const findings = runRules({ startUrl: START, crawl: crawl([{ html }]), hasSitemap: true }).findings;

    const finding = findings.find((f) => f.issueCode === "missing-title");
    expect(finding).toMatchObject({ category: "seo", severity: "high", pageUrl: START });
  });

  it("flags a title over 60 characters and one under 15", () => {
    const long = cleanHtml().replace(/<title>.*<\/title>/, `<title>${"a".repeat(61)}</title>`);
    const short = cleanHtml().replace(/<title>.*<\/title>/, "<title>Plumbing</title>");

    expect(codes([{ html: long }])).toContain("title-too-long");
    expect(codes([{ html: short }])).toContain("title-too-short");
  });

  it("flags a missing description, H1 and language", () => {
    const html = cleanHtml()
      .replace(/<meta name="description"[^>]*>/, "")
      .replace("<h1>Plumbing in Leeds</h1>", "")
      .replace('<html lang="en">', "<html>");

    expect(codes([{ html }])).toEqual(
      expect.arrayContaining(["missing-meta-description", "missing-h1", "missing-lang"]),
    );
  });

  it("flags several H1s and a heading-level jump", () => {
    const html = cleanHtml()
      .replace("<h1>Plumbing in Leeds</h1>", "<h1>Plumbing</h1><h1>in Leeds</h1>")
      .replace("<h2>Boilers</h2>", "<h4>Boilers</h4>");

    expect(codes([{ html }])).toEqual(expect.arrayContaining(["multiple-h1", "heading-level-skip"]));
  });

  it("flags a page that asks not to be indexed", () => {
    const html = cleanHtml().replace("</head>", '<meta name="robots" content="noindex, follow"></head>');
    const finding = runRules({ startUrl: START, crawl: crawl([{ html }]), hasSitemap: true }).findings.find(
      (f) => f.issueCode === "noindex-page",
    );

    expect(finding?.severity).toBe("high");
    expect(finding?.evidence).toContain("noindex");
  });

  it("flags a canonical that points elsewhere, and accepts one that matches", () => {
    const elsewhere = cleanHtml().replace(
      `<link rel="canonical" href="${START}"`,
      '<link rel="canonical" href="https://example.com/other"',
    );
    expect(codes([{ html: elsewhere }])).toContain("canonical-mismatch");
  });

  it("flags an incomplete Open Graph preview", () => {
    const html = cleanHtml().replace(/<meta property="og:image"[^>]*>/, "");
    const finding = runRules({ startUrl: START, crawl: crawl([{ html }]), hasSitemap: true }).findings.find(
      (f) => f.issueCode === "missing-open-graph",
    );

    expect(finding?.evidence).toContain("og:image");
  });
});

describe("technical rules", () => {
  it("flags a 500 as critical and a 404 as high", () => {
    const server = runRules({ startUrl: START, crawl: crawl([{ status: 500 }]), hasSitemap: true }).findings;
    expect(server.find((f) => f.issueCode === "server-error")?.severity).toBe("critical");

    const notFound = runRules({
      startUrl: START,
      crawl: crawl([{ status: 404 }]),
      hasSitemap: true,
    }).findings;
    expect(notFound.find((f) => f.issueCode === "client-error")?.severity).toBe("high");
  });

  it("files a missing robots.txt and sitemap against the audit, not a page", () => {
    const summary = {
      ...crawl([{}]),
      robots: { present: false, sitemaps: [] },
      sitemapUrls: 0,
    };
    const findings = runRules({ startUrl: START, crawl: summary, hasSitemap: false }).findings;

    const robots = findings.find((f) => f.issueCode === "missing-robots-txt");
    const sitemap = findings.find((f) => f.issueCode === "missing-sitemap");
    expect(robots?.pageUrl).toBeNull();
    expect(sitemap?.pageUrl).toBeNull();
    // The two site rules are the only ones that apply here, and each is reported once.
    expect(findings.map((finding) => finding.issueCode).sort()).toEqual([
      "missing-robots-txt",
      "missing-sitemap",
    ]);
  });

  it("does not report a site rule once per page", () => {
    const summary = { ...crawl([{}, {}, {}]), robots: { present: false, sitemaps: [] }, sitemapUrls: 0 };
    const findings = runRules({ startUrl: START, crawl: summary, hasSitemap: false }).findings;

    expect(findings.filter((f) => f.issueCode === "missing-robots-txt")).toHaveLength(1);
  });
});

describe("performance rules", () => {
  it("flags a slow response and a heavy document, with the measurement in the evidence", () => {
    const findings = runRules({
      startUrl: START,
      crawl: crawl([{ durationMs: 4_000, byteSize: 900_000 }]),
      hasSitemap: true,
    }).findings;

    const slow = findings.find((f) => f.issueCode === "slow-server-response");
    expect(slow?.category).toBe("performance");
    expect(slow?.evidence).toContain("4000 ms");
    expect(slow?.evidence).toContain("not Lighthouse");

    const heavy = findings.find((f) => f.issueCode === "large-page-weight");
    expect(heavy?.evidence).toContain("879 KB");
  });

  it("says nothing about a page just under the thresholds", () => {
    expect(codes([{ durationMs: 2_500, byteSize: 500 * 1024 }])).toEqual([]);
  });
});

describe("mobile and accessibility rules", () => {
  it("flags a missing viewport and a zoom-blocking one", () => {
    const missing = cleanHtml().replace(/<meta name="viewport"[^>]*>/, "");
    expect(codes([{ html: missing }])).toContain("missing-viewport");

    const blocked = cleanHtml().replace(
      'content="width=device-width, initial-scale=1"',
      'content="width=device-width, user-scalable=no, maximum-scale=1"',
    );
    expect(codes([{ html: blocked }])).toContain("zoom-disabled");
  });

  it("counts images without alt, links without a name and unlabelled fields", () => {
    const html = cleanHtml()
      .replace('alt="Our van outside the workshop"', "")
      .replace('<a href="/contact">Contact us</a>', '<a href="/contact"><span></span></a>')
      .replace('<label for="email">Email</label>', "");

    const findings = runRules({ startUrl: START, crawl: crawl([{ html }]), hasSitemap: true }).findings;
    const alt = findings.find((f) => f.issueCode === "images-missing-alt");
    const link = findings.find((f) => f.issueCode === "links-without-text");
    const label = findings.find((f) => f.issueCode === "inputs-without-label");

    expect(alt?.evidence).toBe("1 of 1 image elements have no alt attribute.");
    expect(link?.severity).toBe("medium");
    expect(label?.severity).toBe("high");
  });

  it("accepts a link named by an aria-label or by an image alt", () => {
    const html = cleanHtml().replace(
      '<a href="/contact">Contact us</a>',
      '<a href="/contact" aria-label="Contact us"><img src="/icon.png" alt=""></a>',
    );
    expect(codes([{ html }])).toEqual([]);
  });
});

describe("security rules", () => {
  it("reports each missing header once, against the site", () => {
    const findings = runRules({
      startUrl: START,
      crawl: crawl([{ headers: {} }, { url: "https://example.com/about", headers: {} }]),
      hasSitemap: true,
    }).findings;

    for (const code of [
      "missing-hsts",
      "missing-csp",
      "missing-content-type-options",
      "missing-frame-protection",
      "missing-referrer-policy",
    ]) {
      const matches = findings.filter((f) => f.issueCode === code);
      expect(matches, code).toHaveLength(1);
      expect(matches[0]?.pageUrl, code).toBeNull();
    }
  });

  it("accepts frame protection from a CSP directive instead of the header", () => {
    const headers = {
      "strict-transport-security": "max-age=63072000",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };
    expect(codes([{ headers }])).toEqual([]);
  });

  it("flags a site submitted over http as critical", () => {
    const findings = runRules({
      startUrl: "http://example.com/",
      crawl: crawl([{}]),
      hasSitemap: true,
    }).findings;

    const finding = findings.find((f) => f.issueCode === "insecure-http");
    expect(finding?.severity).toBe("critical");
    // HSTS is not asked of a site that is not on HTTPS yet: the first finding is the real one.
    expect(findings.some((f) => f.issueCode === "missing-hsts")).toBe(false);
  });
});

describe("link rules", () => {
  it("flags a link to a page the crawl saw fail, and only then", () => {
    const home = cleanHtml().replace("</body>", '<a href="https://example.com/gone">Old page</a></body>');
    const summary = crawl([{ html: home }, { url: "https://example.com/gone", status: 404, depth: 1 }]);

    const findings = runRules({ startUrl: START, crawl: summary, hasSitemap: true }).findings;
    const broken = findings.find((f) => f.issueCode === "broken-internal-link");

    expect(broken?.category).toBe("links");
    expect(broken?.pageUrl).toBe(START);
    expect(broken?.evidence).toContain("https://example.com/gone");
    // The failing destination is also its own technical finding; both are true and both are kept.
    expect(findings.some((f) => f.issueCode === "client-error")).toBe(true);
  });

  it("does not call a link broken when the crawl never fetched it", () => {
    const home = cleanHtml().replace("</body>", '<a href="/never-crawled">Elsewhere</a></body>');
    expect(codes([{ html: home }])).toEqual([]);
  });
});

describe("the engine itself", () => {
  it("is deterministic: the same crawl produces the same findings in the same order", () => {
    const summary = crawl([
      { status: 500 },
      {
        url: "https://example.com/about",
        html: cleanHtml("https://example.com/about").replace("<h1>", "<p>").replace("</h1>", "</p>"),
      },
    ]);

    const first = runRules({ startUrl: START, crawl: summary, hasSitemap: true });
    const second = runRules({ startUrl: START, crawl: summary, hasSitemap: true });
    expect(second).toEqual(first);

    // Ordered by category, then severity: a report reads top-down, not in discovery order.
    const categories = first.findings.map((f) => f.category);
    const seoIndex = categories.indexOf("seo");
    const technicalIndex = categories.indexOf("technical");
    expect(seoIndex === -1 || technicalIndex === -1 || seoIndex < technicalIndex).toBe(true);
  });

  it("skips pages that failed to fetch entirely", () => {
    const outcome = runRules({
      startUrl: START,
      crawl: crawl([{ error: "timeout", status: 200 }]),
      hasSitemap: true,
    });

    expect(outcome.findings).toEqual([]);
    expect(outcome.evaluated).toEqual([]);
    expect(outcome.pagesEvaluated).toBe(0);
  });

  it("refuses a rule that emits a code it does not own", () => {
    expect(() =>
      runRules({
        startUrl: START,
        crawl: crawl([{}]),
        hasSitemap: true,
        rules: [
          {
            code: "missing-title",
            category: "seo",
            scope: "page",
            run: () => [
              {
                issueCode: "something-else",
                category: "seo",
                title: "t",
                severity: "low",
                description: "d",
                pageUrl: START,
                evidence: "e",
                recommendation: "r",
                confidence: "observed",
              },
            ],
          },
        ],
      }),
    ).toThrow(/emitted a finding with code something-else/);
  });
});
