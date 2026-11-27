# Implementation plan

Phase 0 is scaffolding only: nothing in this repository audits a website yet.

## Phases

Sliced so each phase ends with something that can be run and judged, and so the risky parts
(SSRF, RLS, AI grounding) are proven before anything depends on them.

| Phase | Scope | Done when |
|---|---|---|
| **0 · Foundation** | workspaces, strict TS, lint, format, test, CI, env docs, empty app/package skeletons | `npm ci && npm run ci` passes on a clean checkout |
| **1 · Contracts** | shared domain types and enums, Zod schemas for audits, findings, pagination, profile and AI output, env validation per process, typed errors and envelopes | contracts compile; invalid input produces one predictable code with a field path |
| **1b · URL safety** | `packages/validation`: scheme, credentials, ports, IP and DNS rules | unit tests cover every blocked range, including v4-mapped, NAT64, 6to4 |
| **2 · Supabase schema, auth, ownership** | seven tables, constraints, indexes, RLS, profile provisioning, token verification, ownership helper, browser auth flow | cross-tenant access fails in tests, not in production |
| **3 · Interface foundation** | design tokens, Tailwind, shared components, app shell, landing, auth screens, dashboard/history/settings shells, accessibility | responsive, labelled, no dead controls; contrast measured and tested |
| **4 · Audit submission + jobs** | `POST/GET/GET one/DELETE /audits`, server-side limits, BullMQ queue with idempotent jobs and bounded retries, worker with explicit status/stage transitions, Redis health, New Audit and history UI on TanStack Query | a submitted audit is persisted and queued; the UI shows its real status; a queue or database failure never produces a false success |
| **5 · Bounded crawler** | HTTP fetch pinned to validated addresses, redirect revalidation, size/time limits; robots.txt, sitemap and link discovery under a page/depth cap; HTML parser and page snapshots | tests: redirect to metadata, redirect loop, oversized body, rebind simulation, robots and sitemap policy, page/depth/concurrency caps, fixture crawl |
| **6 · Rules + scoring** | rule engine over the parsed pages, normalisation and deduplication, deterministic scoring with the FR-13 weights, worker pipeline wired end to end | fixture pages produce stable findings and a reproducible score; a finished audit carries its score and the version that produced it |
| **7 · AI + PDF** | evidence-only explanations, schema validation, PDF from stored snapshot | AI failure leaves deterministic findings intact; PDF renders from the snapshot alone |

Phases 0–6 are implemented. Phases 1 and 2 were written before this plan existed; see the note at
the end.

### Phase numbering changed

This plan originally had the bounded fetcher as phase 2 and persistence/auth as phase 5. Phase 2
was then issued as "Supabase schema, Auth and ownership", so that is what phase 2 became, and
the fetcher moved to phase 3.

Nothing crawls yet, so the reordering is safe: risk #1 below is about a fetcher that exists with
gaps, and no fetcher exists. The next phase still has to close redirects, the connected address
and response size before anything is allowed to fetch a real site.

Phase 3 then arrived as the interface foundation, which moved the fetcher again. Same argument:
a UI that cannot start a scan cannot leak a scan.

Phase 4 arrived as submission and jobs, which moved the fetcher once more. This one is worth
stating plainly, because it is the first reordering that could have gone wrong: the queue now
accepts work, so an audit can reach a worker. It cannot reach a *site* — the worker's step list
is empty, so the only thing it does with a target is validate it and record
`scanner_not_ready`. The crawler still has to exist before anything fetches a page, and the
fetcher phase is still the one that closes redirects, the connected address and response size.

Phase 5 finally arrived, as the *crawler* rather than only the fetcher: the TRD's discovery rules
(robots.txt, sitemaps, link depth, page cap) are useless without the fetch layer they are enforced
in, and writing them separately would have meant two limits objects. It is one package,
`@siteaudit/crawler`, and it is still not wired into the worker: `SCAN_STEPS` is empty, so nothing
in production fetches a page yet. Phase 6 owns that wiring and the rules that read the results.

Phase 6 arrived as rules and scoring, and it also did the wiring Phase 5 deferred: the worker now
runs `crawling → rules → scoring` and an audit can complete with a score. The PageSpeed provider
and the AI explanation are still absent, so `performance` is measured by the crawler (response time,
document weight) rather than by Lighthouse — labelled as ours everywhere it appears.

## What exists now

- `apps/api` — Express process: `GET /health` (auth + queue), the error envelope, bearer-token
  verification, `GET /api/v1/me`, `GET|PATCH /api/v1/profile`, the contract probe at
  `POST /api/v1/audits/validate`, and the audit endpoints: `POST /api/v1/audits` (validate,
  limit, persist, enqueue), `GET /api/v1/audits` (pagination, filter, search),
  `GET /api/v1/audits/:id` and `DELETE /api/v1/audits/:id` (queued audits only).
- `apps/web` — Tailwind + React: landing page, sign in / sign up / password reset, and a protected
  shell (overview, audit history, settings) that calls the API with the session's own token.
  Settings writes the profile; everything else shows an empty state because there is no data.
  See [`docs/UI.md`](UI.md).
- `apps/worker` — BullMQ consumer: claims an audit (`queued → running`), revalidates the target,
  records usage, then crawls, runs the rules and scores the result (`crawling → rules → scoring`).
  A page it could not read makes the audit `partial`; a site it could not reach fails it without a
  score. See [`docs/QUEUES.md`](QUEUES.md). Retries are classified (infrastructure only), every write is conditional, and every stored
  message is generated from a code. See [`docs/QUEUES.md`](QUEUES.md).
- `packages/queue` — the queue contract, the BullMQ adapter and the in-memory queue the tests use.
- `packages/crawler` — the only code that talks to a third-party site: `safeFetch` (target gate, DNS
  answer checks, pinned connection, per-hop revalidation, byte and time caps), `crawlSite` (robots,
  sitemaps, links, page/depth/concurrency caps) and `toPageRows`. See
  [`docs/CRAWLER.md`](CRAWLER.md).
- `supabase/migrations/` — schema for the seven tables, profile provisioning, RLS policies.
- `tests/support/database.ts` — PGlite harness that runs those migrations unmodified
- `packages/validation` — the URL safety gate, plus Zod schemas for create-audit input,
  pagination and filters, profile updates and AI output (all tested).
- `packages/config` — one environment schema per process, validated at startup.
- `packages/shared-types` — domain types and status/stage/category unions, plus metric units,
  sources, report statuses and usage kinds (the lists the database constraints mirror).
- `packages/audit-rules` — the rule catalog (`rules-v1`: 30 rules over seven categories), the
  engine and the scorer. Every finding is a code plus evidence; the score is a pure function of the
  findings. See [`docs/RULES.md`](RULES.md).
- `packages/report-template` — template version and snapshot metadata types.
- `tests/` — unit, component and integration suites, including the PGlite schema/RLS suites and the
  crawler's local-fixture suites. Nothing in them reaches the public internet.

## Risks, ranked by what would hurt first

1. **SSRF, narrowed but not eliminated.** Phase 5 closes the request path: every hop is
   validated, every DNS answer is checked, the socket is pinned to the checked address, and
   response size, redirect count and time are bounded. What remains is outside the process — a
   blocklist is a control, not a proof, and a proxy, a compromised runtime or an egress path we do
   not own can still reach a private network. The network-level restriction the deployment must
   apply is written down in [`docs/CRAWLER.md`](CRAWLER.md) §5.4.
2. **Lighthouse/PageSpeed as a single point of failure.** Quota, latency and price are outside
   our control. The provider must be able to fail into a `partial` audit, never into a fabricated
   score.
3. **AI drifting into invention.** Every prompt carries only stored evidence and the output is
   schema-validated, but the failure mode is fluent prose that is wrong. Phase 7 needs a check
   that each sentence maps to an evidence field.
4. **RLS mistakes.** A missing policy exposes one client's audit to another. Phase 2 now runs
   as two users, as `anon`, and as the service role, against real PostgreSQL. Still unproven:
   the hosted project, PostgREST's own parsing and Supabase Auth's endpoints.
5. **PDF rendering untrusted text.** Scraped page text reaches the renderer; escaping and
   resource blocking are part of that phase, not polish.
6. **Scope creep.** The non-goals list in PRD §4 is the guard. Anything not on it waits.
7. **Bus factor of one.** Migrations, env docs and the runbook stay in the repo so the project
   survives a handover.

## Decisions made in Phase 6

| Decision | Why |
|---|---|
| One rule, one issue code | A code that means two things cannot be deduplicated, filtered or explained. The engine throws if a rule emits a code it does not own |
| Rules read the parsed page, not raw HTML | The parser lives in the crawler, so "what counts as a title" has one definition; a rule cannot disagree with what was stored |
| "Evaluated" is recorded separately from "found something" | Without it, a category with no findings would be indistinguishable from a category nobody checked, and N/A would silently become 100 |
| A category starts at 100 and loses points per distinct issue code, capped at 2× | Explainable in one sentence, and a single template defect cannot zero a whole category |
| Link findings are charged to Technical | FR-13 weights six categories and not links; reporting broken links yet scoring them 0% would make the number ignore the report. Recorded as a deviation in `docs/RULES.md` §4 |
| `alt=""` is not a defect | It is the correct way to mark an image as decorative; counting it produced a false positive on the first fixture |
| Scores live on `audits`, not in `audit_metrics` | `audit_metrics.category` only accepts the seven audit categories, and "overall" is not one; the history screen needs the score with the audit |
| `audits_finished_has_score` is a database constraint | A `completed` audit with no score is a claim nobody can check. The row cannot be written |
| The start page failing ends the audit; another page failing makes it `partial` | The site's own answer is not a transient error — retrying it three times only delays the truth |
| The audit detail shows the score and per-category weights | Once audits can complete, the old copy ("this build has no scanner yet") would have been false. The findings list and filters are still a later phase |

## Decisions made in Phase 5

| Decision | Why |
|---|---|
| One `@siteaudit/crawler` package, not `fetcher` + `crawler` | The fetch layer and the discovery policy share one limits object and one target gate. Two packages would mean two `limits.ts` or a package that exists only to be imported by its sibling |
| Pin the connection by replacing `lookup`, rather than checking an address and then fetching by name | A DNS server that changes its answer between the check and the connection would otherwise turn a validated host into a private one |
| Validate *every* DNS answer, not the first | A resolver that returns one public and one private address is either broken or hostile; both deserve a refusal |
| The start page is fetched even when robots.txt disallows it; everything discovered obeys robots.txt | The user named that page. A sitemap URL was not named by anyone, so it is discovered, not requested |
| A page that fails the content-type check becomes a row with `non_html`, not an exception | The report should say "we could not read this page"; an exception would lose the fact that we tried |
| `parsed` is stored, bounded, in `audit_pages` | Phase 6's rules then read data instead of re-fetching, and the report can explain what was seen even if the site has changed |
| A migration adds `final_url`, `duration_ms`, `fetch_error`, `parsed` | The Phase 2 table predates the crawler. Storing a redirect's destination and a failure's code is cheap now and a re-fetch later |
| Test-only overrides (`allowedPorts`, `assertAddress`, `resolver`) instead of weakening the default | A fixture on `127.0.0.1` must be reachable without making the shipped gate permissive. Each override has a test proving the default refuses the same target |
| Local `node:http` fixtures, never a real site, in CI | A test that depends on example.com's uptime is a test that fails for reasons the code did not cause |

## Decisions made in Phase 4

| Decision | Why |
|---|---|
| Job id = audit id | Idempotency without an extra table or a lock: `add` twice is one job |
| Create the row, then enqueue, and delete the row if enqueue fails | A `queued` row with no job is a lie the UI repeats until someone notices. The compensating delete is logged if it also fails |
| The worker classifies failures; BullMQ only retries what deserves it | Retrying a rejected target or a bug three times makes a broken site look like a flaky server |
| Every stored failure message is generated from a code | Exception text can contain a hostname, an IP or a connection string, and this text is rendered |
| Terminal writes are conditional in SQL (`completed_at is null`) | A retried job, a restart and a cancel-race all have to end in one defined state, not "last writer wins" |
| Only `queued` audits can be cancelled, and the row is deleted rather than marked `cancelled` | The schema grants users `delete`, not `update`: status belongs to the worker. `not-queued` still deletes, so a dead `queued` row cannot hang the UI |
| `authenticated` may insert a queued audit, so the API holds no service-role key | Usage metering moved to the worker instead. The request path never bypasses RLS |
| In-memory queue for tests, BullMQ behind the same contract | There is no Redis or Docker here. The adapter is typechecked and its URL parsing is tested; the Redis suite is opt-in and reported as skipped, not passed |
| 2 s budget on enqueue/cancel | ioredis buffers while reconnecting, so without a timeout a dead Redis holds an HTTP request open |
| The worker ends an audit `failed/scanner_not_ready` today | The alternative is a row stuck at `queued` forever. The UI shows the sentence, so nothing claims a scan happened |

## Decisions made in Phase 3

| Decision | Why |
|---|---|
| Kept `#53B107`, changed the text on it to charcoal | White on that green is 2.74:1 and Design.md §7 requires contrast. The brand colour is the thing clients chose; the text colour was never specified |
| Split amber and red into fill and text variants | White on `#D97706` is 3.19:1 — usable for an icon, not for a badge's word. A tinted background with a dark foreground keeps both readable |
| Added a `line-strong` border for controls | `#E5E7EB` is 1.24:1, fine for a separator and not fine for the edge of an input (WCAG 1.4.11 needs 3:1) |
| Contrast is a test, not a review comment | `design-tokens.test.ts` recomputes every pair from the shipped CSS; a palette edit that breaks one fails the build |
| Tailwind 4, deferred since Phase 0 | There is a UI to style now. Tokens live in `@theme`, so a utility and a CSS variable cannot disagree |
| No "New audit" item, no history rows, no metric cards | Design.md §11 forbids dead controls and §3 forbids showing unfinished sections. Empty states say what is true |
| The landing page checks addresses with its own small function | `packages/validation` imports `node:net`/`node:dns`; importing it into the browser had Vite externalise both modules and would have broken the CTA at runtime |
| Component tests in jsdom, per file | The database and API suites stay in the faster Node environment; only DOM tests pay for jsdom |
| No `jest-dom`, no snapshots | Roles, names and states are what a user meets; a snapshot of class names breaks on every restyle |
| No `react-hook-form` yet | Every form here has 1–5 fields and a small amount of validation; the dependency earns its place when a form does not fit on one screen |

## Decisions made in Phase 2

| Decision | Why |
|---|---|
| RLS in its own migration, with the invariant enforced by a test | `README.md` in `supabase/migrations/` asked for policies beside each table. One block reads better, and the test that every table has RLS enabled plus an authenticated-only policy is a stronger guarantee than file adjacency |
| SQL `CHECK` lists mirror `shared-types`, and a test compares them through the catalog | SQL cannot import TypeScript; a constraint that drifts from the enum would reject valid data or accept invalid data, silently |
| Users may not `UPDATE` `audits` | Status, stage and error fields are the worker's. A client that could write them could relabel a failed audit as a completed one. Cancel and re-audit become server-side actions |
| No `DELETE` policy on `profiles` | Deleting the auth user is account deletion and cascades. A browser-deletable profile would leave an auth user that cannot own an audit |
| `usage_records` is append-only for users | A meter a client can edit is not a meter |
| Only `audit_findings.status` is a user-writable child column | Triage is real (TRD §5); rewriting evidence is not |
| PGlite for the database tests | No Docker here, and a mocked RLS test proves nothing. The migrations run unmodified against real PostgreSQL |
| Tokens verified locally with `jose`, not by calling the Auth server | A signature is checkable with a key we hold; a network round trip per request is a dependency that fails under load |
| The API forwards the caller's token to PostgREST | RLS is the enforcement point, not application code. The service-role key is absent from `apps/api/src/data/supabase.ts`, so a request path cannot use it |
| `404` for both "not yours" and "does not exist" | A `403` confirms an id exists; that is an enumeration oracle |
| Profile created by a trigger on `auth.users` | A client that forgets to create one leaves an account that can own nothing; the trigger is idempotent and backfills |
| Auth routes answer `503` when Supabase is unconfigured | An API that cannot verify a token must say so, not accept one |

## Decisions made in Phase 0

| Decision | Why |
|---|---|
| npm workspaces | one lockfile, one install, no extra tooling; repo had no other package manager |
| TypeScript 5.9 and @types/node 22 pinned to the Node LTS | a major upgrade is a deliberate act, not a side effect of setup (`@types/node` must match the runtime) |
| Vitest 5 | 2.1.9 carried a critical advisory in `tinypool`; 5.1.2 runs the same 82 tests and `npm audit` is clean. Dev-only, but a critical finding is not something to leave standing |
| TypeScript project references | `tsc -b` builds in dependency order, so a clean checkout cannot fail on build order |
| Tests resolve packages from source (vitest alias + tsconfig paths) | `npm test` and `npm run typecheck` never require a build first |
| ESLint 9 flat config + Prettier | flat config is the current format; `eslint-config-prettier` stops the two fighting |
| Tailwind deferred | no UI exists to style; adding it now would be configuration without a consumer |
| Worker exits 0 with a message | a process that idles and pretends to work is worse than one that says it has nothing to do |
| `packages/config` added (not in TRD §3) | three processes need three different environments; duplicating the schemas per app is how a secret ends up in the browser schema |
| Enums declared once in `shared-types`, Zod enums built from them | a literal list that exists twice is two lists that disagree |
| AI output schemas are `.strict()` | an explanation step that returns a field we did not ask for should fail, not reach a report |

## Open questions

- `index.html` at the repo root is a pre-spec design prototype. It does not follow
  `docs/Design.md` and it is not part of the app. Keep, rebuild, or delete?
- ~~`docs/Design.md` §2 primary `#53B107` measures 2.74:1 with white text.~~ **Resolved in Phase 3**
  by instruction ("prioritise accessible contrast"): the green stays, the text on it becomes
  charcoal (6.00:1), status colours gained text-safe variants. Recorded in `docs/UI.md` §1 and
  enforced by `tests/unit/design-tokens.test.ts`.
- Redis is not provisioned; `docker-compose.yml` (TRD §3) is still not created. Supabase can be
  run with the CLI (`supabase start`), which needs Docker.
- The Supabase CLI has not been run against these migrations, and the Auth endpoints
  (signup, login, refresh, reset mail) have not been exercised against a real project: this
  machine has no Docker and no browser. `docs/SUPABASE.md` §6 lists the four checks that need a
  real project, so they are not mistaken for done.

## Note on phase order

`packages/validation` (Phase 1) was written before this plan was issued. It is tested, nothing
imports it yet, and deleting working safety code to make the phases tidy is the worse trade. It
is reported here rather than hidden; Phase 0 does not build on it beyond workspace wiring.

Phase 2 was issued while the fetcher was next in the plan. The fetcher is still not written, so
no crawl is waiting on the schema work: see "Phase numbering changed" above.
