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
  /** Heading levels in document order, capped — a skip from h1 to h4 is a hierarchy defect. */
  readonly headingSequence: readonly number[];
  /** Images with no `alt` attribute at all. `alt=""` is decoration and is not counted. */
  readonly imagesWithoutAlt: number;
  readonly images: number;
  /** Anchors with no accessible name: no text, no `aria-label`, no image alt, no `title`. */
  readonly linksWithoutText: number;
  /** Non-hidden inputs with no associated label, `aria-label` or `aria-labelledby`. */
  readonly inputsWithoutLabel: number;
  /** `<meta name="viewport" content>`, which decides whether a phone can read the page. */
  readonly viewport: string | null;
  /** Open Graph property names present, e.g. `og:title`. A social preview needs three of them. */
  readonly ogTags: readonly string[];
  /** Rough visible-text length, a cheap proxy for "is this a real page or a shell". */
  readonly textLength: number;
  /** `nofollow` in a robots meta tag: the site asked us not to follow its links. */
  readonly nofollow: boolean;
}

export interface ParseOptions {
  readonly maxLinks: number;
  /** Headings and Open Graph tags kept: enough to judge structure, not enough to bloat a row. */
  readonly maxStructuralTags?: number;
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

  const structuralCap = options.maxStructuralTags ?? 100;
  const headingSequence: number[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_index, element) => {
    if (headingSequence.length >= structuralCap) return;
    const tag = (element as { tagName?: string }).tagName ?? "";
    const level = Number.parseInt(tag.slice(1), 10);
    if (Number.isInteger(level)) headingSequence.push(level);
  });

  const ogTags: string[] = [];
  $('meta[property^="og:" i]').each((_index, element) => {
    if (ogTags.length >= structuralCap) return;
    const property = clean($(element).attr("property"));
    if (property !== null) ogTags.push(property.toLowerCase());
  });

  let images = 0;
  let imagesWithoutAlt = 0;
  $("img").each((_index, element) => {
    images += 1;
    // `alt=""` is the correct way to mark an image as decorative, so it is not a defect. Only a
    // missing attribute is: a screen reader then reads the file name instead of the picture.
    if ($(element).attr("alt") === undefined) imagesWithoutAlt += 1;
  });

  // A link is usable by a screen reader only if something names it: text, an aria-label, a title,
  // or an image inside it that carries an alt.
  let linksWithoutText = 0;
  $("a[href]").each((_index, element) => {
    const link = $(element);
    const text = link.text().replace(/\s+/g, "").length;
    const labelled = (link.attr("aria-label") ?? "").trim().length > 0;
    const titled = (link.attr("title") ?? "").trim().length > 0;
    const imageAlt =
      link.find("img[alt]").filter((_i, img) => ($(img).attr("alt") ?? "").trim().length > 0).length > 0;
    if (text === 0 && !labelled && !titled && !imageAlt) linksWithoutText += 1;
  });

  // An input needs a `<label for>`, a wrapping label, `aria-label` or `aria-labelledby`.
  const labelledInputIds = new Set<string>();
  $("label[for]").each((_index, element) => {
    const id = $(element).attr("for");
    if (id !== undefined) labelledInputIds.add(id);
  });
  let inputsWithoutLabel = 0;
  $("input:not([type=hidden]), select, textarea").each((_index, element) => {
    const field = $(element);
    if (field.closest("label").length > 0) return;
    const id = field.attr("id");
    if (id !== undefined && labelledInputIds.has(id)) return;
    if ((field.attr("aria-label") ?? "").trim().length > 0) return;
    if ((field.attr("aria-labelledby") ?? "").trim().length > 0) return;
    inputsWithoutLabel += 1;
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
    headingSequence,
    images,
    imagesWithoutAlt,
    linksWithoutText,
    inputsWithoutLabel,
    viewport: clean($('meta[name="viewport" i]').attr("content")),
    ogTags,
    textLength,
    nofollow: nofollowDirective.includes("nofollow"),
  };
}
