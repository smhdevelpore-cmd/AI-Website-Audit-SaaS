# AI-Website-Audit-SaaS

Audits a public website URL, collects real measurements, explains findings in plain language,
prioritises the fixes and produces a client-ready PDF.

**Status: Phase 4, audit submission and jobs.** You can sign up, submit an address, watch it move
from `queued` to a finished state, filter and cancel your history, and edit your profile.
**Nothing crawls a website yet** — the worker validates the target and records that this build
cannot scan, so no audit invents a score. Submissions need Redis; without it the API answers
`503` rather than queueing a job nothing will run.

- [`docs/PLAN.md`](docs/PLAN.md) — phase plan, risks, decisions, open questions
- [`docs/UI.md`](docs/UI.md) — tokens, contrast measurements, components, accessibility, what is absent and why
- [`docs/QUEUES.md`](docs/QUEUES.md) — submission, the job contract, retry rules, cancellation, what is unproven
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

Verified on this machine, 2026-11-27: lint 0, format:check 0, typecheck 0, 353 tests passing,
build 0 across all nine workspaces. Two tests are skipped by design: the BullMQ suite
runs only with `REDIS_TEST_URL`.

## Layout

```
apps/
  web/          Vite + React + Tailwind + TanStack Query: landing, auth, shell, audits, settings
  api/          Express: token verification, profile, audit create/list/read/cancel
  worker/       BullMQ consumer: claims audits, validates targets, reports status
packages/
  shared-types/ domain enums, entity types, error codes and API envelopes
  validation/   URL safety gate (SSRF) + Zod request contracts
  queue/        queue contract, BullMQ adapter, in-memory queue for tests
  config/       environment schemas, one per process, validated at startup
  audit-rules/  rule interface, empty registry
  report-template/ template version + snapshot metadata
tests/          unit, component (jsdom) and integration: RLS isolation, migrations, API auth, UI
supabase/migrations/   schema, profile provisioning, row-level security
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
