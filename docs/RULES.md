# Rules and scoring

`@siteaudit/audit-rules` turns one crawl into the findings a reviewer can act on, and one number
they can defend. Both are deterministic: the same pages produce the same findings and the same
score on any machine, in any order, on any day. Nothing here reads the clock, the network or the
database — that property is what lets a report explain every point it took away.

**Version:** `rules-v1` (`RULES_VERSION` and `SCORING_VERSION`). Stored on the audit as
`scoring_version`, because a score whose formula cannot be identified is not reproducible.

## 1. Two invariants

1. **A rule speaks only for its own issue code.** A rule that emits a different code — or a finding
   in another category — throws. A mislabelled row is worse than a failed run.
2. **"Evaluated" is not "found something".** A category counts as checked when a rule in it *ran*,
   whether or not it reported anything. That is the difference between "we looked and it is clean"
   (100) and "we did not look" (N/A), and the scoring depends on it entirely.

## 2. The catalogue

Every finding carries a stable `issue_code`, a category, a severity, a short description, the
evidence it was derived from, a recommendation and a confidence (`observed` — it comes from the
served response — or `inferred`).

A rule runs on a page only if `applies` says so — header rules run on the start page over HTTPS,
site rules run once. A page that failed to fetch has no parsed data, so no rule runs on it.

### SEO (`seo`, weight 25)

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `missing-title` | high | no non-empty `<title>` | states that none was found |
| `title-too-long` | low | title > 60 characters | the length and the title |
| `title-too-short` | low | title < 15 characters | the length and the title |
| `missing-meta-description` | medium | no `<meta name="description">` content | states that none was found |
| `meta-description-too-long` | low | description > 160 characters | the length and the description |
| `missing-h1` | high | no `<h1>` | heading counts |
| `multiple-h1` | low | more than one `<h1>` | the count |
| `heading-level-skip` | low | two or more levels jumped (h1 → h3) | the pair that jumped |
| `missing-lang` | medium | no `lang` on `<html>` | states that none was found |
| `noindex-page` | high | `noindex` in meta robots | the directive |
| `canonical-mismatch` | low | canonical resolves to a different URL than served | both URLs |
| `missing-open-graph` | low | `og:title`, `og:description` or `og:image` missing | which ones |

### Technical (`technical`, weight 20)

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `server-error` | critical | status ≥ 500 | the status and the response time |
| `client-error` | high | status 400–499 | the status and the URL |
| `missing-robots-txt` | low | `/robots.txt` was not readable (site-wide) | the URL tried |
| `missing-sitemap` | low | no sitemap declared or readable (site-wide) | what was looked for |

### Performance (`performance`, weight 25)

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `slow-server-response` | medium | the HTML response took > 2 500 ms | the measured time, labelled as ours, not Lighthouse |
| `large-page-weight` | medium | the HTML document is > 500 KB | the size in KB |

These are crawl measurements, not provider scores. The report must never present them as
Lighthouse numbers; Phase 7 adds the provider's LCP/CLS and its own score separately.

### Mobile (`mobile`, weight 15)

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `missing-viewport` | high | no `<meta name="viewport">` | states that none was found |
| `zoom-disabled` | medium | `user-scalable=no` or `maximum-scale` ≤ 1 | the viewport value |

### Accessibility (`accessibility`, weight 10)

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `images-missing-alt` | medium | an `<img>` has no `alt` attribute | how many of how many |
| `links-without-text` | medium | an `<a>` has no text, `aria-label`, `title` or image alt | the count |
| `inputs-without-label` | high | a field has no label, `aria-label` or `aria-labelledby` | the count |

`alt=""` is *not* counted: it is the correct way to mark an image as decorative. Alt text is filed
under accessibility rather than SEO because one finding that names the reader it affects is more
useful than two that split the blame.

### Security (`security`, weight 5)

Run on the start page only: these are properties of how the site is served, and five identical
findings across a small crawl would bury the one that matters.

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `insecure-http` | critical | the audit URL is `http://` (site-wide) | the origin and its scheme |
| `missing-hsts` | medium | no `Strict-Transport-Security` (HTTPS only) | the absent header |
| `missing-csp` | medium | no `Content-Security-Policy` | the absent header |
| `missing-content-type-options` | low | no `X-Content-Type-Options` | the absent header |
| `missing-frame-protection` | low | no `X-Frame-Options` and no CSP `frame-ancestors` | the absent header |
| `missing-referrer-policy` | low | no `Referrer-Policy` | the absent header |

This is not a vulnerability scan. The report says so in as many words.

### Links (`links`, weight 0 — charged to Technical)

| Code | Severity | Fires when | Evidence |
|---|---|---|---|
| `broken-internal-link` | high | a same-origin link on the page points at an address the crawl saw answer 4xx/5xx | up to three of the failing URLs |

A link whose destination the crawl never fetched is **unchecked**, not broken. The rule reads the
same crawl that produced the pages rather than issuing a second round of requests.

## 3. Scoring formula

A category starts at 100 and loses points for each distinct issue code:

```
deduction(code) = SEVERITY_DEDUCTIONS[severity] × min(2, 1 + 0.25 × (pagesAffected − 1))
categoryScore   = clamp(round(100 − Σ deduction), 0, 100)
overall         = round(Σ(categoryScore × weight) / Σ(weight))   over checked categories
```

| Severity | Deduction |
|---|---|
| critical | 25 |
| high | 12 |
| medium | 6 |
| low | 2 |

| Category | Weight (PRD FR-13) |
|---|---|
| performance | 25 |
| seo | 25 |
| technical | 20 |
| mobile | 15 |
| accessibility | 10 |
| security | 5 |
| links | 0 — charged to technical |

Why recurring issues cost more but stop at 2×: one template defect on 25 pages is one defect, and a
site should not be scored 0 because a footer link is wrong on every page.

Why the score is rounded once, at the end: intermediate rounding compounds, and a score that
depends on the order findings were discovered is not reproducible. The arithmetic is done in
quarter-point units so it stays exact.

## 4. Doc conflict: `links` has no weight in FR-13

PRD FR-13 names six categories and weights that total 100. The schema (and TRD §7's "link checks")
allow a seventh, `links`. A broken internal link is a real defect that a customer will pay to have
found, and FR-13 gives it no share of the score — so reporting it and scoring it 0% would mean the
number ignores work the report shows.

**Decision:** link findings are deducted from **Technical** (weight 20), and the `links` category
keeps a computed score at weight 0 for reporting. The weights themselves are exactly FR-13's, and
they still total 100. This is a deviation from the letter of FR-13 and is recorded here rather than
silently applied; if the weight table is meant to include links, that is a PRD change, not a code
change.

## 5. N/A and renormalisation

A category is N/A when no rule in it ran — for example a crawl where every page failed to fetch, or
a site that never got past the start page. Its weight is redistributed across the categories that
*were* checked (FR-13), and it is stored with `score: null`, never `0`.

If no category was checked at all, the overall score is `null` and the audit does not complete: an
audit without a score is honest, and a score of 0 would claim the site failed checks nobody ran.
The database enforces this: `audits_finished_has_score` refuses a `completed` or `partial` audit
without an `overall_score` and a `scoring_version`.

## 6. Where the results go

| Table | What | Written by |
|---|---|---|
| `audit_pages` | one row per fetched page: URL, final URL, status, size, timing, parsed data | `crawling` |
| `audit_findings` | one row per finding: code, category, severity, evidence, recommendation, page | `rules` |
| `audits.overall_score`, `audits.category_scores` | the score and per-category scores with their weights | `scoring` |

`audits.category_scores` is a JSON array of `{category, score, weight}`. The API passes it through
`toAuditView` with a shape check, so a malformed row cannot become a number a browser treats as a
fact.

## 7. Not checked, and why

- **Provider metrics** — LCP, CLS, INP, TBT, Speed Index, the Lighthouse score. Phase 7.
- **Rendered layout** — contrast, tap targets, overflow, layout shift. These need a browser; this
  build parses HTML and says so in the report's limitations.
- **JavaScript-rendered content** — cheerio does not execute scripts, so a client-rendered page
  looks emptier than it is. Reported as a limitation, not as a defect.
- **Link checks outside the crawl** — a link to a page beyond the page or depth cap is unchecked.
- **Anything requiring credentials or forms** — never crawled, by policy.

## 8. Changing a rule

1. Change the code, the threshold or the formula.
2. Bump `RULES_VERSION` and/or `SCORING_VERSION` — a stored score must name the formula that
   produced it.
3. Update a fixture test that pins the behaviour, and the table above.

A rule without a fixture is a rule nobody has seen fire.

## 9. Tests

| File | Covers |
|---|---|
| `tests/unit/rules.test.ts` | every rule against pages built by the real parser: one defect per test, a clean page with no findings, site scoping, determinism, the engine's guard |
| `tests/unit/scoring.test.ts` | the weights, every deduction, the recurrence cap, the clamp, N/A renormalisation, the links fold, order-independence |
| `tests/integration/worker-scan.test.ts` | crawl → rules → score against a local fixture site, and the terminal states it produces |
| `tests/integration/schema-migrations.test.ts` | the score columns and the constraints that refuse an unsupported score |
| `tests/component/audits.test.tsx` | the audit detail showing a real score, N/A, and no weight for links |
