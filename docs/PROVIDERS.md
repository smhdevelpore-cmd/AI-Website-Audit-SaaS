# External measurements: PageSpeed Insights

`@siteaudit/pagespeed` (PRD FR-06, TRD §10). The first third party in this system whose numbers
are *measurements* rather than prose, which is exactly why the boundary is written down.

One sentence: **the provider measures, we store what it measured and label it as its own; the score
stays ours.**

## Why the score does not move

PRD FR-13 gives Performance 25% of the score. Today that 25% is earned by our own deterministic
rules — response time, document weight, render-blocking markup — and PageSpeed's `performance-score`
does **not** replace it.

This is a deliberate deviation, recorded here rather than discovered later:

| Reason | What it means |
|---|---|
| A provider outage must not change a score | If Lighthouse's number were 25% of the score, a `429` would silently reprice every audit. The acceptance for this phase says a provider failure leaves the score intact; the only way to be sure is for the score never to read the provider |
| A score must be reproducible | Our rules are a pure function of the fetched HTML and headers. A Lighthouse run is a different machine, a different network and a different moment |
| Two numbers, labelled, beat one blended number | The report prints "Performance 100 (ours)" *and* "PageSpeed: 72". A client can see whose is whose |

When provider scores are allowed to feed the score, it will be a new scoring version
(`rules-v2`), with both numbers stored, and the report will say which produced the number. That has
not happened.

## What is asked for

One call per audit, one strategy (mobile by default), one Lighthouse category:

```
GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed
    ?url=<audited address>&strategy=MOBILE&category=performance
X-Goog-Api-Key: <PAGESPEED_API_KEY>
```

The key travels in a header, not the `?key=` parameter Google documents: a query string ends up in
proxy logs, browser history and error reports, and this key is billable.

Stored from the answer:

| Metric | Unit | Lighthouse source |
|---|---|---|
| `performance-score` | score | `categories.performance.score × 100` |
| `largest-contentful-paint` | ms | `audits.largest-contentful-paint.numericValue` |
| `first-contentful-paint` | ms | `audits.first-contentful-paint.numericValue` |
| `cumulative-layout-shift` | ratio | `audits.cumulative-layout-shift.numericValue` |
| `total-blocking-time` | ms | `audits.total-blocking-time.numericValue` |
| `speed-index` | ms | `audits.speed-index.numericValue` |
| `interaction-to-next-paint` | ms | `audits.interaction-to-next-paint.numericValue` |
| `server-response-time` | ms | `audits.server-response-time.numericValue` |

Plus, at the audit level: the strategy, the Lighthouse version, the provider's own `fetchTime`, and
up to five opportunities (id, title, estimated savings) sorted worst first.

**Nothing is defaulted.** Lighthouse reports `numericValue: null` when it could not run a test. That
becomes a metric with `value: null` and `status: "unavailable"`, and the database refuses the
alternative (`audit_metrics_unavailable_has_no_value`).

## Statuses, and what they mean

Two levels, because they answer different questions.

**The call** (`PerformanceReport.status`):

| Status | Meaning | Audit outcome |
|---|---|---|
| `ok` | Every metric returned | Audit unchanged |
| `partial` | Some metrics returned, some missing | Audit marked **partial** |
| `unavailable` | Nothing returned. `reason` says why | Audit marked **partial** |

**The audit** (`audits.metrics_status`):

| Value | Meaning |
|---|---|
| `ok` | Provider ran and everything came back |
| `partial` | Provider ran; some metrics missing |
| `unavailable` | Provider ran and failed. `metrics_reason` holds the cause |
| `skipped` | No key configured: no call was made, and none is claimed |

`audits_metrics_reason_has_failure` enforces that a reason exists only for `partial` or
`unavailable`: a successful run has nothing to explain.

The reason vocabulary is fixed (`quota`, `timeout`, `invalid_url`, `http_error`,
`malformed_response`, `not_configured`) and the report turns each into a sentence — *"the provider's
quota was exhausted"* — rather than printing a code at a client.

## Why a provider failure makes the audit `partial`

`partial` has meant "the results cover only part of what this audit is meant to show" since Phase 6,
when a page could not be read. A provider that returned nothing is the same situation one level up:
the performance section is missing because a third party did not answer, not because the site
performed badly. Findings and the score are already written by then and are untouched.

An audit with **no provider configured** is different: it is `completed`, `metrics_status` is
`skipped`, and the report says performance was measured by our own crawl. Nothing is missing that
was ever promised.

## Failure handling, in code

`createPagespeedClient` resolves for every answer that is about the target or the quota. It does not
reject — only a bug in this process rejects — because a third party's bad day must not reach the
audit's exception path (which would retry the whole job):

| Answer | Reason |
|---|---|
| `429` | `quota` |
| `400` mentioning invalid URL/host | `invalid_url` |
| other `4xx`/`5xx` | `http_error` |
| body is not JSON, or is JSON without `lighthouseResult` | `malformed_response` |
| no answer within 45 s, or the audit's budget is spent | `timeout` |

The step also catches a thrown client and records `http_error`: a provider step that fails must fail
*into a stored absence*, not into a failed audit.

## Storage

`audit_metrics` is one row per metric, with `source: "pagespeed"`, `strategy`, `provider_version`,
`measured_at`, and `reason`. `audit_metrics_dedupe` is unique on
(audit, page scope, key, source, strategy) — replacing the Phase 2 index that ignored strategy — so a
retried audit overwrites its own rows and a mobile run and a desktop run coexist.

`raw` exists for TRD §10's "selected raw response", bounded to 20 kB by
`audit_metrics_raw_size`. Nothing writes it today: the eight numbers and five opportunities are
extracted into typed columns, and a full Lighthouse JSON is megabytes. A future field needs the raw
payload stored, and this document is where that should be recorded.

## Configuration and cost

| Variable | Effect |
|---|---|
| `PAGESPEED_API_KEY` | Absent: no call, `metrics_status = "skipped"`, worker logs `pagespeed: "absent"` |

One call per audit. PageSpeed Insights quota is per key per day; `quota` is the reason you will see
first in a busy deployment, and it costs an audit nothing but its `partial` label.

## Tests

- `tests/unit/pagespeed.test.ts` — the parser against complete, partial, empty and non-Lighthouse
  bodies; every client failure code; the key never appearing in a URL.
- `tests/integration/worker-pagespeed.test.ts` — real crawl, rules and score with a fake provider:
  metrics stored; the score identical to a run without a provider; a refusal marking the audit
  `partial` while findings and score are unchanged; a throwing client surviving.
- `tests/integration/schema-migrations.test.ts` — the constraints above, run against PGlite.
- `tests/integration/report-api.test.ts` and `tests/unit/report.test.ts` — the provider section in
  the PDF, including the "not measured" case.
