/**
 * Design.md §2 proposes tokens and §7 requires sufficient contrast. Two of those tokens fail
 * against their own intended use (white on #53B107 is 2.74:1), so the app uses darker text and
 * split status colours. This test recomputes every ratio from the CSS that actually ships, so a
 * later palette edit cannot quietly undo the fix.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS_PATH = fileURLToPath(new URL("../../apps/web/src/styles/index.css", import.meta.url));

function tokens(): Map<string, string> {
  const css = readFileSync(CSS_PATH, "utf8");
  const map = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/gi)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) map.set(name.toLowerCase(), value.toLowerCase());
  }
  return map;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const palette = tokens();
const colour = (name: string): string => {
  const value = palette.get(name);
  if (value === undefined) throw new Error(`--color-${name} is missing from index.css`);
  return value;
};

describe("design tokens", () => {
  it("defines the whole palette from Design.md §2", () => {
    for (const name of [
      "canvas",
      "surface",
      "ink",
      "muted",
      "line",
      "line-strong",
      "primary",
      "on-primary",
      "primary-strong",
      "critical",
      "critical-strong",
      "warning",
      "warning-strong",
      "success",
      "success-strong",
    ]) {
      expect(palette.has(name), `--color-${name}`).toBe(true);
    }
    // The specified hexes are kept exactly where they were usable.
    expect(colour("primary")).toBe("#53b107");
    expect(colour("canvas")).toBe("#f7f8fa");
    expect(colour("surface")).toBe("#ffffff");
    expect(colour("ink")).toBe("#17202a");
    expect(colour("critical")).toBe("#dc2626");
    expect(colour("warning")).toBe("#d97706");
    expect(colour("success")).toBe("#16a34a");
  });
});

describe("body text contrast (WCAG AA, 4.5:1)", () => {
  it("is readable on both surfaces", () => {
    expect(contrast(colour("ink"), colour("surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour("ink"), colour("canvas"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour("muted"), colour("surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour("muted"), colour("canvas"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every badge tint readable", () => {
    const pairs: Array<[string, string]> = [
      ["ink", "tint-neutral"],
      ["primary-strong", "tint-brand"],
      ["success-strong", "tint-success"],
      ["warning-strong", "tint-warning"],
      ["critical-strong", "tint-critical"],
    ];
    for (const [foreground, background] of pairs) {
      expect(
        contrast(colour(foreground), colour(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the documented primary button", () => {
  it("uses charcoal on green, because white on green is not readable", () => {
    // Design.md's own pairing, kept here as a warning rather than a rule.
    expect(contrast("#ffffff", colour("primary"))).toBeLessThan(4.5);

    expect(contrast(colour("on-primary"), colour("primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("uses a darker green wherever green is the text colour", () => {
    expect(contrast(colour("primary-strong"), colour("surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour("primary-strong"), colour("canvas"))).toBeGreaterThanOrEqual(4.5);
  });

  it("uses white only on a red dark enough to carry it", () => {
    expect(contrast("#ffffff", colour("critical"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("non-text contrast (WCAG 1.4.11, 3:1)", () => {
  it("gives inputs a border that is visible against the surface", () => {
    expect(contrast(colour("line-strong"), colour("surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(colour("line-strong"), colour("canvas"))).toBeGreaterThanOrEqual(3);
  });

  it("uses a focus outline that survives every background it lands on", () => {
    expect(contrast(colour("ink"), colour("surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(colour("ink"), colour("canvas"))).toBeGreaterThanOrEqual(3);
    expect(contrast(colour("ink"), colour("primary"))).toBeGreaterThanOrEqual(3);
  });
});
