# The crawler

`@siteaudit/crawler` is the only code in this repository that talks to someone else's website. It
answers one question — *which pages exist on this site, and what did they return?* — under limits
that the site's owner and our bill both depend on.

This document records what is enforced, what is only *recommended* (and must be enforced outside
the process), and what is deliberately not done yet.

## 1. Modules

| File | Responsibility |
|---|---|
| `limits.ts` | every bound as data: `DEFAULT_FETCH_LIMITS`, `DEFAULT_CRAWL_LIMITS`, the user agent, request headers |
| `fetch.ts` | one safe request — target gate, DNS, pinning, redirects, byte cap, timeouts; returns a value, never throws for a bad site |
| `normalize.ts` | is this link the same page as that one (`normalizeUrl`), and is it a page we crawl at all (`shouldFollow`) |
| `robots.ts` | `robots.txt` parsing and matching, plus the sitemaps it declares |
| `sitemap.ts` | `<loc>` extraction from `urlset` and `sitemapindex` |
| `html.ts` | `parsePage`: title, lang, meta, canonical, links, headings, image alt counts, visible text length |
| `crawl.ts` | `crawlSite`: the bounded breadth-first walk |
| `page-rows.ts` | `toPageRows`: crawl → `audit_pages` rows |

The fetcher and the crawler are one package because they share one limits object and one target
gate. Splitting them would mean two copies of `limits.ts` or a package that exists only to be
imported by its sibling.

## 2. What makes a request safe

Four rules, in the order they run. Each has tests whose names read like the rule.

1. **Validate the target.** `parseTargetUrl` (in `@siteaudit/validation`) rejects a scheme that is
   not `http`/`https`, embedded credentials, a port other than 80/443, a URL over 2 048
   characters, and any hostname or literal address in a private, loopback, link-local, multicast,
   reserved, metadata or unspecified range — IPv4, IPv6, IPv4-mapped IPv6, NAT64 and 6to4 forms
   included.
2. **Validate every answer.** The hostname is resolved and *every* returned address goes through
   `assertPublicAddress`. One public and one private answer is refused; a resolver that changes
   its answer between two lookups gets no second chance to be believed (see §5.2).
3. **Pin the connection.** The address that was checked is the address the socket connects to:
   `lookup` is replaced with a function that returns the validated answer and never consults DNS
   again. TLS still verifies the certificate against the *hostname*, so pinning weakens nothing.
4. **Validate every hop.** A `Location` is not followed blindly: the new URL goes through steps 1
   and 2 again. A redirect to `169.254.169.254`, to `10.0.0.5`, to `http://user:pass@host` or to
   `file:` fails on exactly the same rules as a first hop would. A redirect chain cannot escape
   by starting on a public host: only the *destination* is ever fetched, and it is checked.

Everything a server controls is bounded by destroying the socket rather than by trusting a header:
bytes are counted while streaming (a `Content-Length` that lies does not help), per-hop and total
deadlines are separate timers, and a body that trickles in one byte a second hits the total
deadline.

## 3. Failure codes

`FetchFailureCode` is the whole vocabulary of "no page". The stored value is always a code; the
human-readable `detail` stays in logs because it can contain an address or a host name.

| Code | Meaning | Worth retrying? |
|---|---|---|
| `unsafe_target` | the URL itself is refused (scheme, credentials, port, length, hostname shape) | no |
| `blocked_address` | a resolved address or a literal is in a blocked range | no |
| `unsupported_scheme` | not `http`/`https` | no |
| `dns_failed` | the resolver failed or returned nothing usable | maybe — a transient resolver error |
| `connection_failed` | TCP/TLS failure, or a certificate we will not accept | maybe |
| `timeout` | connect, per-hop or total deadline reached | maybe |
| `too_large` | declared or actual body over `maxBytes` | no |
| `too_many_redirects` | more than `maxRedirects` hops | no |
| `redirect_loop` | a URL repeated inside one redirect chain | no |
| `non_html` | `Content-Type` is not `text/html` or `application/xhtml+xml` | no |
| `aborted` | the caller's `AbortSignal` fired | no |

A crawl records these as `audit_pages.fetch_error`, so the report can say "we could not read this
page, and here is the category" rather than silently missing a page.

## 4. Limits

Defaults, all in `limits.ts`, all overridable per call (`fetchLimits`, `crawlLimits`):

| Bound | Default | Why this number |
|---|---|---|
| connect timeout | 5 s | a server that will not accept a connection in 5 s is not a useful audit target |
| per-hop timeout | 10 s | one slow page must not consume the audit |
| total timeout | 12 s | the cap for one URL, redirects included |
| response body | 2 MiB | an HTML page that is larger is a different kind of problem |
| redirects | 5 | enough for `http → https`, `www → apex`, a trailing slash and a CDN hop |
| URL length | 2 048 | matches `audit_pages_url_length` |
| pages | 10 | PRD's free-audit page allowance; also `audits.max_pages` |
| depth | 2 | homepage, its sections, and one level below them |
| concurrency per host | 2 | polite, and enough to hide latency |
| sitemap URLs | 100 | a sitemap with 50 000 URLs must not become a 50 000-entry queue |
| policy file size | 512 KiB | `robots.txt` and `sitemap.xml` are small by convention |
| links per page | 500 | a nav-heavy page still fits in memory |

`MAX_CRAWL_DEPTH` is 10 because `audit_pages.depth` refuses anything deeper; the crawl clamps to it
rather than discovering the limit at the first failed insert.

## 5. Discovery

Order: **robots.txt → sitemaps → start page → links**, breadth-first.

### 5.1 Policy

- `robots.txt` is read first because it is the site's stated policy and it names the sitemaps.
- Our product token (`siteauditbot`) wins over `*`; longest match wins; `Allow` wins a tie;
  an empty `Disallow:` means "allow everything".
- **The start page is fetched even when robots.txt disallows it**, because the user named that page
  and asked us to audit it. Every *discovered* URL — including URLs taken from the sitemap — obeys
  robots.txt.
- A page with `<meta name="robots" content="nofollow">` is recorded, and its links are not followed.
- Login, sign-up, logout, password, cart, checkout, admin and `cgi-bin` paths are never followed.
  We never send a cookie, so a crawl cannot hold a session; the rule is about not spending an
  audit on a form.
- Anything with a file extension (`pdf`, `zip`, images, fonts, CSS, JS, media, office documents) is
  never fetched. `Content-Type` is checked as second line of defence: a page-shaped URL that
  answers with a PDF becomes a `non_html` row, not a download.
- Only same-origin URLs are followed. External links are counted in `parsed.externalLinks` so a
  rule can report them, never fetched.

### 5.2 What a crawl reports

`CrawlSummary.skipped` counts what was *not* fetched and why — `robots`, `pageCap`, `assets`,
`offOrigin`. Those counters are the audit's "limitations" section: "we did not look at 14 pages
because the ten-page allowance ran out" is a different statement from "the site has ten pages".

### 5.3 DNS rebinding

The window a rebinding attack needs is between "we resolved and checked" and "the socket connects".
Pinning (§2.3) closes it for the request itself. The residual cases, none of which the crawler can
close on its own:

- **A proxy in the path.** `HTTP_PROXY`/`HTTPS_PROXY` are *not* honoured — this module uses
  `node:http`/`node:https` directly. If a future change adds proxy support, the proxy's own
  resolution must be pinned too, or the gate means nothing.
- **A compromised `lookup`.** The pinned function is a replacement, not a hook, so a
  monkey-patched `dns` module cannot re-open the window; a compromised *process* can do anything.
- **A CNAME chain.** `lookup` returns the final addresses, and every one is checked, so a CNAME
  pointing at a private address is refused. What is *not* re-checked is anything the target does
  after it has the connection (an HTTP redirect to an internal host from a public one is checked —
  that is §2.4).

### 5.4 Recommended: restrict egress

The blocklist is a strong control, not a complete one. The deployment should also make the
metadata service unreachable from the worker's network:

- **Allow egress only to 80/443 on the public internet.** Deny `169.254.0.0/16`,
  `fd00:ec2::254`, RFC 1918, CGNAT and IPv6 ULA ranges at the network layer (security group,
  NetworkPolicy, or a NAT gateway with a route table that has no route to the VPC's own ranges).
- **Disable IMDSv1 and require IMDSv2** on AWS, or block `169.254.169.254` entirely: this crawler
  never needs it.
- **Run the worker without a cloud identity** that can be used through an instance metadata
  credential. A worker with no role has nothing for a metadata request to steal.
- **Do not run the worker inside a trusted network segment.** It is the one process whose job is to
  fetch arbitrary URLs on a stranger's behalf.

## 6. What is stored

`toPageRows(auditId, pages)` produces `audit_pages` rows; the columns come from
`supabase/migrations/20261127090300_audit_page_snapshot.sql`:

| Column | Source |
|---|---|
| `url` | the URL requested |
| `final_url` | where the content came from, after redirects |
| `depth` | link distance from the start page (0 = start page) |
| `http_status` | response status, or `NULL` when there was no response |
| `content_type`, `byte_size`, `duration_ms` | response metadata; timing is the request's own total |
| `title` | trimmed and bounded to the column's 300 characters |
| `fetch_error` | a `FetchFailureCode`, or `NULL` |
| `parsed` | the extractor's object: title, lang, meta, canonical, links, heading counts, image counts, text length, `nofollow` |
| `fetched_at` | when the request started |

The parsed shape is stored so Phase 6's rules read data instead of re-fetching, and so a report can
explain what was seen without the page still being reachable. It is bounded (500 links per page,
300-character title) so a hostile page cannot choose the size of our row.

## 7. Test-only overrides

Three options exist so a test can point the crawler at a fixture on `127.0.0.1`. None is used by
`apps/api` or `apps/worker`, and each has a companion test proving the *default* refuses the thing
the override allows:

| Option | What it relaxes | Companion test |
|---|---|---|
| `parseTargetUrl(..., { allowedPorts })` / `SafeFetchOptions.allowedPorts` / `CrawlOptions.allowedPorts` | ports 80/443 only | "refuses a non-standard port when no port policy is injected" |
| `SafeFetchOptions.assertAddress` / `CrawlOptions.assertAddress` | public-address rule | "refuses a loopback literal when only the port is allowed" |
| `SafeFetchOptions.resolver` / `CrawlOptions.resolver` | real DNS | "refuses a hostname that resolves to loopback when no address policy is injected" |

## 8. Tests

| File | Covers |
|---|---|
| `tests/unit/crawler-parse.test.ts` | normalisation, discovery policy, robots matching, sitemap parsing, HTML extraction |
| `tests/integration/crawler-fetch.test.ts` | every refusal: literals (v4, v6, mapped, NAT64), private and metadata addresses, all-answers rule, rebinding, redirect escapes and loops, size and time caps, content-type, user agent |
| `tests/integration/crawler-crawl.test.ts` | the bounds and the policy: page cap, depth cap, per-host concurrency, robots (including sitemap URLs), start-page exemption, `nofollow`, assets, off-origin, redirects, failure rows, `toPageRows` |
| `tests/integration/schema-migrations.test.ts` | the snapshot columns exist and refuse impossible values |

No test reaches the public internet. Every target is a local `node:http` fixture
(`tests/support/fixture-server.ts`) reached through the three overrides above, so CI cannot be
affected by a real site's uptime or by our own reputation with it.

## 9. Not done yet

- **Worker wiring.** `apps/worker`'s `SCAN_STEPS` is still empty, so a queued audit stops at
  `failed/scanner_not_ready`. Phase 5 delivers the crawler; Phase 6 owns the pipeline that calls it,
  writes the rows and runs the rules. `toPageRows` is the intended seam.
- **Rate limiting across audits.** Per-host concurrency is bounded, but two audits of the same site
  still run as two independent crawls. That belongs to the queue phase that can see both.
- **JavaScript rendering.** Cheerio parses the served HTML without executing anything, so a
  client-rendered site will look emptier than it is. This is a limitation to report, not a bug to
  hide: the alternative is running a browser, which is a different security story.
