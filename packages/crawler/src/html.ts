/**
 * What we keep from a page.
 *
 * Deliberately not "the page": no inline scripts, no styles, no full body text. These fields are
 * the ones Phase 6's deterministic rules ask for (title, description, headings, alt text, lang,
 * canonical, robots policy), and they are bounded — a page with 50 000 anchors keeps 500 of them.
 *
 * Cheerio parses; it does not execute. No script runs, no resource is fetched, and the HTML is
 * treated as data throughout.
 */

import { load } from "cheerio";

import { normalizeUrl } from "./normalize.js";

export interface ParsedPage {
  readonly title: string | null;
  readonly lang: string | null;
  readonly metaDescription: string | null;
  readonly metaRobots: string | null;
  readonly canonical: string | null;
  readonly baseHref: string | null;
  /** Absolute http(s) links found on the page, de-duplicated, capped. */
  readonly links: readonly string[];
  readonly internalLinks: number;
  readonly externalLinks: number;
  readonly h1Count: number;
  readonly headings: Readonly<Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", number>>;
  readonly imagesWithoutAlt: number;
  readonly images: number;
  /** Rough visible-text length, a cheap proxy for "is this a real page or a shell". */
  readonly textLength: number;
  /** `nofollow` in a robots meta tag: the site asked us not to follow its links. */
  readonly nofollow: boolean;
}

export interface ParseOptions {
  readonly maxLinks: number;
}

function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed;
}

function count(collection: { length: number }): number {
  return collection.length;
}

export function parsePage(html: string, pageUrl: string, options: ParseOptions): ParsedPage {
  const $ = load(html);
  const baseHref = clean($("base[href]").first().attr("href"));
  // A `<base>` changes what every relative link means, so it is applied before resolution.
  const resolutionBase = baseHref === null ? pageUrl : (normalizeUrl(baseHref, pageUrl)?.href ?? pageUrl);

  const nofollowDirective = ($('meta[name="robots" i]').attr("content") ?? "").toLowerCase();

  const links = new Set<string>();
  let internalLinks = 0;
  let externalLinks = 0;
  const origin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return "";
    }
  })();

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (href === undefined) return;
    const normalized = normalizeUrl(href, resolutionBase);
    if (normalized === null) return;
    if (normalized.origin === origin) internalLinks += 1;
    else externalLinks += 1;
    if (links.size < options.maxLinks) links.add(normalized.href);
  });

  const headingCounts = {
    h1: count($("h1")),
    h2: count($("h2")),
    h3: count($("h3")),
    h4: count($("h4")),
    h5: count($("h5")),
    h6: count($("h6")),
  };

  let images = 0;
  let imagesWithoutAlt = 0;
  $("img").each((_index, element) => {
    images += 1;
    const alt = $(element).attr("alt");
    if (alt === undefined || alt.trim() === "") imagesWithoutAlt += 1;
  });

  // Text length is measured on a copy with the parts a user does not read removed.
  const bodyText = $("body").clone();
  bodyText.find("script, style, noscript, template, svg").remove();
  const textLength = bodyText.text().replace(/\s+/g, " ").trim().length;

  return {
    title: clean($("head > title").first().text()) ?? clean($("title").first().text()),
    lang: clean($("html").attr("lang")),
    metaDescription: clean($('meta[name="description" i]').attr("content")),
    metaRobots: clean($('meta[name="robots" i]').attr("content")),
    canonical: (() => {
      const href = $('link[rel="canonical" i]').attr("href");
      if (href === undefined) return null;
      return normalizeUrl(href, resolutionBase)?.href ?? clean(href);
    })(),
    baseHref,
    links: [...links],
    internalLinks,
    externalLinks,
    h1Count: headingCounts.h1,
    headings: headingCounts,
    images,
    imagesWithoutAlt,
    textLength,
    nofollow: nofollowDirective.includes("nofollow"),
  };
}
