/**
 * Bounded discovery against a local fixture site (TRD §7).
 *
 * The fixture is a small but awkward website: it has a robots.txt that disallows a section, a
 * sitemap that lists a disallowed URL and an off-origin URL, login and download links on the home
 * page, a deep chain past the depth limit, and a page that asks not to be followed.
 *
 * Every assertion is about a bound or a policy being *enforced*, not about the shape of the crawl.
 */

import { crawlSite, toPageRows, type CrawlSummary } from "@siteaudit/crawler";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  allowLoopback,
  fixtureResolver,
  html,
  notFound,
  page,
  redirect,
  startFixtureServer,
  text,
  type FixtureServer,
} from "../support/fixture-server.js";

const HOST = "fixture.test";

function site(server: FixtureServer) {
  return async (req: { url?: string | undefined }, res: Parameters<typeof html>[0]): Promise<void> => {
    const path = req.url ?? "/";
    const origin = `http://${HOST}:${server.port}`;

    if (path === "/robots.txt") {
      text(res, ["User-agent: *", "Disallow: /private", "", `Sitemap: ${origin}/sitemap.xml`].join("\n"));
      return;
    }

    if (path === "/sitemap.xml") {
      text(
        res,
        `<urlset>` +
          `<url><loc>${origin}/from-sitemap</loc></url>` +
          `<url><loc>${origin}/private/hidden</loc></url>` +
          `<url><loc>https://other.example/elsewhere</loc></url>` +
          `</urlset>`,
        "application/xml",
      );
      return;
    }

    const routes: Record<string, () => void> = {
      "/": () =>
        html(
          res,
          page("Home", [
            "/about",
            "/private/secret",
            "/login",
            "/brochure.pdf",
            "https://other.example/",
            "/deep",
            "/nofollow",
          ]),
        ),
      "/about": () => html(res, page("About", ["/", "/contact"])),
      "/contact": () => html(res, page("Contact")),
      "/deep": () => html(res, page("Deep", ["/deeper"])),
      "/deeper": () => html(res, page("Deeper", ["/deepest"])),
      "/deepest": () => html(res, page("Deepest")),
      "/nofollow": () =>
        html(res, page("No follow", ["/should-not-follow"], `<meta name="robots" content="nofollow">`)),
      "/from-sitemap": () => html(res, page("From sitemap")),
      // None of these may be requested. They answer so a failure shows a page, not a connection error.
      "/private/secret": () => html(res, page("Secret")),
      "/private/hidden": () => html(res, page("Hidden")),
      "/login": () => html(res, page("Login")),
      "/should-not-follow": () => html(res, page("Followed anyway")),
      "/shared": () => redirect(res, "/about"),
    };

    const route = routes[path];
    if (route === undefined) {
      notFound(res);
      return;
    }
    route();
  };
}

describe("crawlSite", () => {
  let server: FixtureServer;
  let options: Parameters<typeof crawlSite>[0];

  beforeAll(async () => {
    server = await startFixtureServer((req, res) => site(server)(req, res));
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.reset();
    options = {
      startUrl: `http://${HOST}:${server.port}/`,
      resolver: fixtureResolver(HOST),
      assertAddress: allowLoopback,
      allowedPorts: [server.port],
    };
  });

  it("walks the site within the page, depth and origin bounds", async () => {
    const summary = await crawlSite({ ...options, maxPages: 10 });

    expect(summary.origin).toBe(`http://${HOST}:${server.port}`);
    expect(summary.pages.length).toBeLessThanOrEqual(10);
    expect(summary.pages[0]?.url).toBe(`http://${HOST}:${server.port}/`);
    expect(summary.pages[0]?.title).toBe("Home");

    // Discovery actually works: a linked page, a sitemap page, and a second-level page all arrived.
    expect(summary.pages.map((p) => p.url).sort()).toEqual(
      expect.arrayContaining([
        `http://${HOST}:${server.port}/about`,
        `http://${HOST}:${server.port}/from-sitemap`,
        `http://${HOST}:${server.port}/deep`,
      ]),
    );

    // Depth: /deeper is at depth 2 (allowed by default), /deepest at depth 3 is not.
    expect(server.hits).not.toContain("/deepest");

    // Origin: a link to another site is counted, never fetched.
    expect(summary.skipped.offOrigin + summary.skipped.assets).toBeGreaterThan(0);
  });

  it("does not fetch what robots.txt disallows, including sitemap URLs", async () => {
    const summary = await crawlSite({ ...options, maxPages: 10 });

    expect(server.hits).not.toContain("/private/secret");
    expect(server.hits).not.toContain("/private/hidden");
    expect(summary.skipped.robots).toBeGreaterThanOrEqual(2);
    expect(summary.robots.present).toBe(true);
    expect(summary.robots.sitemaps).toEqual([`http://${HOST}:${server.port}/sitemap.xml`]);
  });

  it("still fetches the start page when robots.txt disallows it, because the user asked for it", async () => {
    const blocking = await startFixtureServer((req, res) => {
      if ((req.url ?? "/") === "/robots.txt") {
        text(res, "User-agent: *\nDisallow: /");
        return;
      }
      if ((req.url ?? "/") === "/about") {
        html(res, page("About"));
        return;
      }
      html(res, page("Home", ["/about"]));
    });

    try {
      const summary = await crawlSite({
        startUrl: `http://${HOST}:${blocking.port}/`,
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [blocking.port],
      });

      expect(blocking.hits).toContain("/");
      expect(blocking.hits).not.toContain("/about");
      expect(summary.pages).toHaveLength(1);
      expect(summary.skipped.robots).toBeGreaterThanOrEqual(1);
    } finally {
      await blocking.close();
    }
  });

  it("never requests login screens, downloads or other origins", async () => {
    await crawlSite({ ...options, maxPages: 10 });

    expect(server.hits).not.toContain("/login");
    expect(server.hits).not.toContain("/brochure.pdf");
    expect(server.hits.some((hit) => hit.includes("other.example"))).toBe(false);
  });

  it("stops at the page cap and says so", async () => {
    const summary = await crawlSite({ ...options, maxPages: 2 });

    expect(summary.pages).toHaveLength(2);
    expect(summary.skipped.pageCap).toBeGreaterThan(0);
    // Bound is a bound: exactly two page requests, plus the two policy files.
    const pageHits = server.hits.filter((hit) => hit !== "/robots.txt" && hit !== "/sitemap.xml");
    expect(pageHits).toHaveLength(2);
  });

  it("stops at the depth limit", async () => {
    await crawlSite({ ...options, maxPages: 10, crawlLimits: { maxDepth: 1 } });

    expect(server.hits).toContain("/deep");
    expect(server.hits).not.toContain("/deeper");
  });

  it("honours a page that asks not to have its links followed", async () => {
    await crawlSite({ ...options, maxPages: 10 });

    expect(server.hits).toContain("/nofollow");
    expect(server.hits).not.toContain("/should-not-follow");
  });

  it("keeps concurrent requests per host within the limit", async () => {
    const slow = await startFixtureServer(async (req, res) => {
      const path = req.url ?? "/";
      if (path === "/robots.txt") {
        text(res, "User-agent: *\nDisallow: /nothing");
        return;
      }
      if (path === "/sitemap.xml") {
        notFound(res);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
      const links = path === "/" ? ["/a", "/b", "/c", "/d", "/e"] : [];
      html(res, page(`Page ${path}`, links));
    });

    try {
      await crawlSite({
        startUrl: `http://${HOST}:${slow.port}/`,
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [slow.port],
        maxPages: 6,
        crawlLimits: { perHostConcurrency: 2 },
      });

      expect(slow.maxConcurrent).toBeLessThanOrEqual(2);
      expect(slow.maxConcurrent).toBe(2); // the batch really did overlap
      expect(slow.hits.filter((hit) => hit !== "/robots.txt" && hit !== "/sitemap.xml")).toHaveLength(6);
    } finally {
      await slow.close();
    }
  });

  it("crawls a site with no robots.txt and no sitemap without failing", async () => {
    const bare = await startFixtureServer((req, res) => {
      if ((req.url ?? "/") === "/") html(res, page("Bare", ["/one"]));
      else if ((req.url ?? "/") === "/one") html(res, page("One"));
      else notFound(res);
    });

    try {
      const summary = await crawlSite({
        startUrl: `http://${HOST}:${bare.port}/`,
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [bare.port],
      });

      expect(summary.robots.present).toBe(false);
      expect(summary.pages.map((p) => p.title)).toEqual(["Bare", "One"]);
      expect(summary.skipped.robots).toBe(0);
    } finally {
      await bare.close();
    }
  });

  it("records timings, status and a redirect's final URL", async () => {
    const redirecting = await startFixtureServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/") {
        html(res, page("Start", ["/shared"]));
        return;
      }
      if (path === "/shared") {
        redirect(res, "/landed");
        return;
      }
      if (path === "/landed") {
        html(res, page("Landed"));
        return;
      }
      notFound(res);
    });

    try {
      const summary = await crawlSite({
        startUrl: `http://${HOST}:${redirecting.port}/`,
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [redirecting.port],
      });

      const landed = summary.pages.find((p) => p.url.endsWith("/shared"));
      expect(landed).toBeDefined();
      expect(landed?.finalUrl).toBe(`http://${HOST}:${redirecting.port}/landed`);
      expect(landed?.title).toBe("Landed");
      expect(landed?.status).toBe(200);
      expect(landed?.durationMs).toBeGreaterThanOrEqual(0);
      expect(landed?.byteSize).toBeGreaterThan(0);
      expect(landed?.error).toBeNull();
    } finally {
      await redirecting.close();
    }
  });

  it("records a page that fails the content-type check as a row with a code, not a crash", async () => {
    const flaky = await startFixtureServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/") {
        html(res, page("Start", ["/gone"]));
        return;
      }
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4 not a page");
    });

    try {
      const summary = await crawlSite({
        startUrl: `http://${HOST}:${flaky.port}/`,
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [flaky.port],
      });

      // `/gone` is a page-shaped URL that answers with a PDF: it belongs in the audit as a failed
      // row, which is what the report will show, rather than as an exception.
      expect(summary.pages).toHaveLength(2);
      expect(summary.pages[0]?.error).toBeNull();
      const failed = summary.pages.find((p) => p.url.endsWith("/gone"));
      expect(failed?.error).toBe("non_html");
      expect(failed?.status).toBeNull();
      expect(failed?.parsed).toBeNull();
    } finally {
      await flaky.close();
    }
  });
});

describe("toPageRows", () => {
  it("maps a crawl to the audit_pages column shape", () => {
    const page: CrawlSummary["pages"][number] = {
      url: "https://example.com/",
      finalUrl: "https://example.com/home",
      depth: 0,
      status: 200,
      contentType: "text/html; charset=utf-8",
      byteSize: 1234,
      durationMs: 87,
      title: "Home",
      parsed: {
        title: "Home",
        lang: "en",
        metaDescription: null,
        metaRobots: null,
        canonical: null,
        baseHref: null,
        links: [],
        internalLinks: 0,
        externalLinks: 0,
        h1Count: 1,
        headings: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        images: 0,
        imagesWithoutAlt: 0,
        textLength: 12,
        nofollow: false,
      },
      error: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    const failed: CrawlSummary["pages"][number] = {
      ...page,
      url: "https://example.com/gone",
      finalUrl: "https://example.com/gone",
      depth: 1,
      status: null,
      contentType: null,
      byteSize: 0,
      title: null,
      parsed: null,
      error: "timeout",
    };

    const rows = toPageRows("audit-1", [page, failed]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      audit_id: "audit-1",
      url: "https://example.com/",
      final_url: "https://example.com/home",
      http_status: 200,
      duration_ms: 87,
      fetch_error: null,
      fetched_at: "2026-01-01T00:00:00.000Z",
    });
    expect(rows[0]?.parsed).toMatchObject({ title: "Home", h1Count: 1 });
    expect(rows[1]).toMatchObject({ http_status: null, parsed: null, fetch_error: "timeout" });
  });

  it("fits a stored title into the column, and treats a blank title as missing", () => {
    const longTitle = "T".repeat(400);
    const base: CrawlSummary["pages"][number] = {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      depth: 0,
      status: 200,
      contentType: "text/html",
      byteSize: 10,
      durationMs: 1,
      title: longTitle,
      parsed: null,
      error: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };

    const [row] = toPageRows("audit-1", [base, { ...base, title: "   " }]);

    // `audit_pages.title` is `char_length between 1 and 300 or null`; 400 characters would abort
    // the insert and lose the row that proves the page was seen.
    expect(row?.title).toHaveLength(300);
    expect(toPageRows("audit-1", [{ ...base, title: "   " }])[0]?.title).toBeNull();
  });
});
