/**
 * robots.txt, read as a *policy* rather than as a security control (TRD §7 says exactly that).
 *
 * The file is untrusted input written by whoever runs the site, so the parser is small, total
 * (every input produces a policy) and bounded (the caller stops reading at a byte limit). It is
 * not an XML/HTML parser and it never resolves an entity.
 *
 * Matching follows the widely implemented conventions:
 *  - only the group that matches our product token applies, else the `*` group;
 *  - the longest matching rule wins;
 *  - on a tie, `Allow` wins.
 *
 * A missing or unreadable robots.txt means "allowed": the file is a courtesy, and a site that
 * fails to serve it has not asked us to stay away.
 */

export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: ReadonlyArray<{ readonly allow: boolean; readonly path: string }>;
}

export interface RobotsPolicy {
  /** True when a robots.txt was read and parsed. */
  readonly present: boolean;
  readonly groups: readonly RobotsGroup[];
  /** Absolute or relative `Sitemap:` values, in file order. */
  readonly sitemaps: readonly string[];
  /** True when our product token matched a group of its own. */
  readonly matchedOwnGroup: boolean;
}

export const EMPTY_ROBOTS: RobotsPolicy = {
  present: false,
  groups: [],
  sitemaps: [],
  matchedOwnGroup: false,
};

/** Extracts the product token from a UA: `SiteAuditBot/0.1 (+…)` → `siteauditbot`. */
export function productToken(userAgent: string): string {
  const first = userAgent.split(" ")[0] ?? "";
  const token = first.split("/")[0] ?? "";
  return token.toLowerCase();
}

export function parseRobots(text: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  const sitemaps: string[] = [];

  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    // Comments start at `#`; anything after is not part of the rule.
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (line === "") continue;

    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (value === "" && field !== "disallow") continue;

    if (field === "user-agent") {
      // A second User-agent line continues the same group; a new group starts after a rule.
      if (current === null || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;

    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    if (current === null) continue;
    if (field === "allow") current.rules.push({ allow: true, path: value });
    else if (field === "disallow") {
      // `Disallow:` with no value means "allow everything"; storing it would be a rule that
      // matches every path, which is the opposite of what the site asked for.
      if (value !== "") current.rules.push({ allow: false, path: value });
    }
    // Crawl-delay, Request-rate and friends are ignored on purpose: we honour the byte and page
    // caps instead of a number a site cannot enforce on us.
  }

  return { present: true, groups, sitemaps, matchedOwnGroup: false };
}

function matchesRule(rulePath: string, path: string): boolean {
  if (rulePath === "") return false;
  // `*` is a wildcard and a trailing `$` anchors the end, per the de-facto standard.
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const expression = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
  return expression.test(path);
}

/** A path-only view of a URL, which is what robots rules are written against. */
export function robotsPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function isAllowedByRobots(policy: RobotsPolicy, url: string, userAgent: string): boolean {
  if (!policy.present) return true;

  const token = productToken(userAgent);
  const own = policy.groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && token.startsWith(agent)),
  );
  const wildcard = policy.groups.filter((group) => group.agents.includes("*"));
  const applicable = own.length > 0 ? own : wildcard;
  if (applicable.length === 0) return true;

  const path = robotsPath(url);
  let best: { allow: boolean; length: number } | null = null;

  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!matchesRule(rule.path, path)) continue;
      const length = rule.path.length;
      if (best === null || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
  }

  return best === null ? true : best.allow;
}

/** Sitemap locations that are ours to fetch: same origin as the site being crawled. */
export function sameOriginSitemaps(policy: RobotsPolicy, origin: string, limit: number): string[] {
  const found: string[] = [];
  for (const raw of policy.sitemaps) {
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin) found.push(url.href);
    } catch {
      // A malformed Sitemap: line is the site's problem, not a reason to fail the crawl.
    }
    if (found.length >= limit) break;
  }
  return found;
}
