# AI-Website-Audit-SaaS

Audits a public website URL, collects real measurements, explains findings in plain language,
prioritises the fixes and produces a client-ready PDF.

**Status: Phase 7, explanations and the report.** You can sign up, submit an address, watch it move
from `queued` through `crawling`, `rules`, `scoring` and `ai`, and open the finished audit to read
its score, each category's weight and every finding with the evidence behind it. **The scan is
real**: a bounded crawl, deterministic rules over what was fetched, and a weighted score with the
formula's version stored beside it. A finished audit downloads as a **PDF built only from stored
rows**. Where an `LLM_API_KEY` is configured, a model explains the findings in client language —
stored beside the result, never inside it — and its absence is labelled rather than blank.

Lighthouse/PageSpeed metrics are not wired yet (Phase 8), so performance is measured by our own crawl
and labelled as ours everywhere it appears. Submissions need Redis; without it the API answers `503`
rather than queueing a job nothing will run.

- [`docs/PLAN.md`](docs/PLAN.md) — phase plan, risks, decisions, open questions
- [`docs/UI.md`](docs/UI.md) — tokens, contrast measurements, components, accessibility, what is absent and why
- [`docs/QUEUES.md`](docs/QUEUES.md) — submission, the job contract, retry rules, cancellation, what is unproven
- [`docs/CRAWLER.md`](docs/CRAWLER.md) — the fetch rules, failure codes, limits, discovery policy, residual SSRF risk and the egress recommendation
- [`docs/RULES.md`](docs/RULES.md) — every rule and its threshold, the scoring formula, the weights, why a category can be N/A
- [`docs/AI-EXPLAIN.md`](docs/AI-EXPLAIN.md) — what the model is sent, what it may return, every failure branch, why it cannot change a result
- [`docs/REPORT.md`](docs/REPORT.md) — the PDF: its sections, deterministic rendering, sanitising untrusted text, what it deliberately omits
- [`docs/SUPABASE.md`](docs/SUPABASE.md) — local setup, migrations, what the RLS tests cover

## Source of truth

The specification is in [`docs/`](docs/). Read it before changing behaviour:

- [`docs/PRD.md`](docs/PRD.md) — scope, users, functional requirements, release criteria
- [`docs/Design.md`](docs/Design.md) — IA, page specs, tokens, states, PDF design
- [`docs/TRD.md`](docs/TRD.md) — stack, API contracts, job flow, crawler security, DB/RLS, tests
- [`docs/ARD.md`](docs/ARD.md) — architecture, decisions, trust boundaries, threat model

If a requirement conflicts with these documents, stop and report the conflict. Do not silently
change scope.

## Setup

Prerequisites: **Node 22 LTS** (see `.nvmrc`) and npm 10.

```bash
nvm use                 # or any Node 22
npm ci                  # installs from the committed lockfile
cp .env.example .env    # fill in only what the part you are running needs
```

No environment variable is required to run lint, typecheck, tests or the builds. `apps/api`
starts without any of them and serves `GET /health`.

To submit audits you also need Redis; the compose file has one:

```bash
docker compose up -d redis
REDIS_URL=redis://localhost:6379 npm run dev --workspace @siteaudit/api
```

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint 9, flat config, TypeScript rules |
| `npm run format` / `npm run format:check` | Prettier write / verify |
| `npm run typecheck` | `tsc -b` over the project graph, then the test projects and the web app |
| `npm run test` | Vitest across packages and `tests/`, including the RLS suite (no Docker needed) |
| `npm run build` | `tsc -b` for every Node package, Vite + Tailwind for the web app |
| `npm run ci` | all of the above, in the order CI runs them |
| `npm run clean` | removes every `dist/` and `.tsbuildinfo` |

Verified on this machine, 2026-11-27: lint 0, format:check 0, typecheck 0, 535 tests passing
(36 files, 2 skipped), build 0 across all eleven workspaces (3 apps, 8 packages). Two tests are
skipped by design: the BullMQ suite runs only with `REDIS_TEST_URL`.

## Layout

```
apps/
  web/          Vite + React + Tailwind + TanStack Query: landing, auth, shell, audits, settings
  api/          Express: token verification, profile, audit create/list/read/cancel, findings, PDF
  worker/       BullMQ consumer: crawls, runs the rules, scores, explains, stores the result
packages/
  shared-types/ domain enums, entity types, error codes and API envelopes
  validation/   URL safety gate (SSRF) + Zod request contracts, including the AI output schema
  queue/        queue contract, BullMQ adapter, in-memory queue for tests
  crawler/      safe fetch, robots/sitemap/link discovery, HTML parser, audit_pages rows
  audit-rules/  30 rules over seven categories, the engine, and the weighted score
  ai-explain/   the explanation step: bounded prompt, validated reply, HTTP provider
  report-template/ snapshot from rows + PDF renderer (no browser, no network)
  config/       environment schemas, one per process, validated at startup
tests/          unit, component (jsdom) and integration: RLS isolation, migrations, API auth, UI,
                crawler against local fixture servers (never a real site)
supabase/migrations/   schema, profile provisioning, row-level security, audit page snapshots
docs/           the specification and the plan
```

## Rules that are not negotiable

- Measurements and deterministic rules are authoritative. AI may explain evidence; it may not
  invent metrics, findings, scores or certainty.
- The target URL and everything fetched from it is untrusted. No fetch happens before
  `packages/validation` says the URL is safe.
- No fake data in production flows. Fixtures belong in tests or clearly labelled development mode.
- Secrets stay server-side. Nothing privileged goes into a `VITE_` variable: those are compiled
  into the browser bundle. The service-role key never appears in a request path.
- Tenant isolation is the database's job: the API forwards the caller's own token to PostgREST
  and RLS decides what exists. The API's ownership check is a second gate, not the only one.
- No dead controls. If a screen cannot do the thing yet, it says so instead of rendering a button
  that does nothing — and no number is shown until a real one exists.
- Contrast is measured, not eyeballed. `docs/UI.md` §1 lists every ratio and a test recomputes them.
- A queued audit is never invented. If the queue is missing or refuses the job, the API creates
  nothing and says so; if the build cannot scan, the worker marks the audit failed with a
  sentence instead of leaving it waiting.
