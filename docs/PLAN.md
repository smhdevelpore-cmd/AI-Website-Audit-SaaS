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
| **4 · Bounded fetcher** | HTTP fetch pinned to validated addresses, redirect revalidation, size/time limits | tests: redirect to metadata, redirect loop, oversized body, rebind simulation |
| **5 · Rules + scoring** | HTML parse, rule engine, normalisation, deterministic scoring with weights from PRD FR-13 | fixture pages produce stable findings and a reproducible score |
| **6 · Jobs** | Redis + BullMQ, worker lifecycle, stage reporting, partial results | a real site is audited end to end without holding an HTTP request open |
| **7 · AI + PDF** | evidence-only explanations, schema validation, PDF from stored snapshot | AI failure leaves deterministic findings intact; PDF renders from the snapshot alone |

Phases 0–3 are implemented. Phases 1 and 2 were written before this plan existed; see the note at
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

## What exists now

- `apps/api` — Express process: `GET /health`, a contract probe at
  `POST /api/v1/audits/validate` (validates, queues nothing), the error envelope, bearer-token
  verification, `GET /api/v1/me`, `GET|PATCH /api/v1/profile` and `GET /api/v1/audits/:id`.
- `apps/web` — Tailwind + React: landing page, sign in / sign up / password reset, and a protected
  shell (overview, audit history, settings) that calls the API with the session's own token.
  Settings writes the profile; everything else shows an empty state because there is no data.
  See [`docs/UI.md`](UI.md).
- `apps/worker` — prints that no queue exists and exits 0.
- `supabase/migrations/` — schema for the seven tables, profile provisioning, RLS policies.
- `tests/support/database.ts` — PGlite harness that runs those migrations unmodified
- `packages/validation` — the URL safety gate, plus Zod schemas for create-audit input,
  pagination and filters, profile updates and AI output (all tested).
- `packages/config` — one environment schema per process, validated at startup.
- `packages/shared-types` — domain types and status/stage/category unions, plus metric units,
  sources, report statuses and usage kinds (the lists the database constraints mirror).
- `packages/audit-rules` — the rule interface and an empty registry.
- `packages/report-template` — template version and snapshot metadata types.
- `tests/`, `supabase/migrations/` — empty by design.

## Risks, ranked by what would hurt first

1. **SSRF through the parts not built yet.** The URL gate validates the first hop only.
   Redirects, the socket's actual destination (DNS rebinding) and response size are still open.
   Nothing may crawl until phase 3 closes them.
2. **Lighthouse/PageSpeed as a single point of failure.** Quota, latency and price are outside
   our control. The provider must be able to fail into a `partial` audit, never into a fabricated
   score.
3. **AI drifting into invention.** Every prompt carries only stored evidence and the output is
   schema-validated, but the failure mode is fluent prose that is wrong. Phase 6 needs a check
   that each sentence maps to an evidence field.
4. **RLS mistakes.** A missing policy exposes one client's audit to another. Phase 2 now runs
   as two users, as `anon`, and as the service role, against real PostgreSQL. Still unproven:
   the hosted project, PostgREST's own parsing and Supabase Auth's endpoints.
5. **PDF rendering untrusted text.** Scraped page text reaches the renderer; escaping and
   resource blocking are part of that phase, not polish.
6. **Scope creep.** The non-goals list in PRD §4 is the guard. Anything not on it waits.
7. **Bus factor of one.** Migrations, env docs and the runbook stay in the repo so the project
   survives a handover.

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
