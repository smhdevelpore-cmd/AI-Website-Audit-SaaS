# Implementation plan

Phase 0 is scaffolding only: nothing in this repository audits a website yet.

## Phases

Sliced so each phase ends with something that can be run and judged, and so the risky parts
(SSRF, RLS, AI grounding) are proven before anything depends on them.

| Phase | Scope | Done when |
|---|---|---|
| **0 · Foundation** | workspaces, strict TS, lint, format, test, CI, env docs, empty app/package skeletons | `npm ci && npm run ci` passes on a clean checkout |
| **1 · URL safety** | `packages/validation`: scheme, credentials, ports, IP and DNS rules | unit tests cover every blocked range, including v4-mapped, NAT64, 6to4 |
| **2 · Bounded fetcher** | HTTP fetch pinned to validated addresses, redirect revalidation, size/time limits | tests: redirect to metadata, redirect loop, oversized body, rebind simulation |
| **3 · Rules + scoring** | HTML parse, rule engine, normalisation, deterministic scoring with weights from PRD FR-13 | fixture pages produce stable findings and a reproducible score |
| **4 · Jobs** | Redis + BullMQ, worker lifecycle, stage reporting, partial results | a real site is audited end to end without holding an HTTP request open |
| **5 · Persistence + auth** | Supabase schema, RLS, ownership, history | cross-tenant access fails in tests, not in production |
| **6 · AI + PDF** | evidence-only explanations, schema validation, PDF from stored snapshot | AI failure leaves deterministic findings intact; PDF renders from the snapshot alone |

Phase 1 was already implemented before this plan was written; see the note at the end.

## What exists now

- `apps/api` — Express process, `GET /health`, nothing else.
- `apps/web` — Vite + React shell that renders one sentence.
- `apps/worker` — prints that no queue exists and exits 0.
- `packages/validation` — the URL safety gate and the Zod request contracts (tested).
- `packages/shared-types` — domain types and status/stage/category unions.
- `packages/audit-rules` — the rule interface and an empty registry.
- `packages/report-template` — template version and snapshot metadata types.
- `tests/`, `supabase/migrations/` — empty by design.

## Risks, ranked by what would hurt first

1. **SSRF through the parts not built yet.** The URL gate validates the first hop only.
   Redirects, the socket's actual destination (DNS rebinding) and response size are still open.
   Nothing may crawl until Phase 2 closes them.
2. **Lighthouse/PageSpeed as a single point of failure.** Quota, latency and price are outside
   our control. The provider must be able to fail into a `partial` audit, never into a fabricated
   score.
3. **AI drifting into invention.** Every prompt carries only stored evidence and the output is
   schema-validated, but the failure mode is fluent prose that is wrong. Phase 6 needs a check
   that each sentence maps to an evidence field.
4. **RLS mistakes.** A missing policy exposes one client's audit to another. Phase 5 tests run
   as two users, not one.
5. **PDF rendering untrusted text.** Scraped page text reaches the renderer; escaping and
   resource blocking are part of that phase, not polish.
6. **Scope creep.** The non-goals list in PRD §4 is the guard. Anything not on it waits.
7. **Bus factor of one.** Migrations, env docs and the runbook stay in the repo so the project
   survives a handover.

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

## Open questions

- `index.html` at the repo root is a pre-spec design prototype. It does not follow
  `docs/Design.md` and it is not part of the app. Keep, rebuild, or delete?
- `docs/Design.md` §2 primary `#53B107` measures 2.74:1 with white text, below the 4.5:1 that
  the same document requires in §7. Additive fix proposed: charcoal text on the green fill
  (6.00:1) plus darker text variants for warning/success. Needs a decision before the first UI
  phase.
- Redis and Supabase are not provisioned. Local development needs `docker-compose.yml`
  (mentioned in TRD §3, not created yet) or a hosted instance.

## Note on phase order

`packages/validation` (Phase 1) was written before this plan was issued. It is tested, nothing
imports it yet, and deleting working safety code to make the phases tidy is the worse trade. It
is reported here rather than hidden; Phase 0 does not build on it beyond workspace wiring.
