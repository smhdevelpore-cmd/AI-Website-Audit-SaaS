# AI-Website-Audit-SaaS

Audits a public website URL, collects real measurements, explains findings in plain language,
prioritises the fixes and produces a client-ready PDF.

**Status: Phase 1, contracts.** Nothing audits a website yet. See
[`docs/PLAN.md`](docs/PLAN.md) for the phase plan, risks and open questions.

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

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint 9, flat config, TypeScript rules |
| `npm run format` / `npm run format:check` | Prettier write / verify |
| `npm run typecheck` | `tsc -b` over the project graph, then the test projects and the web app |
| `npm run test` | Vitest across packages and `tests/` |
| `npm run build` | `tsc -b` for every Node package, Vite for the web app |
| `npm run ci` | all of the above, in the order CI runs them |
| `npm run clean` | removes every `dist/` and `.tsbuildinfo` |

Verified on this machine, 2026-11-27: lint 0, format:check 0, typecheck 0, 133 tests passing,
build 0 across all eight workspaces.

## Layout

```
apps/
  web/          Vite + React shell          (npm run dev -w @siteaudit/web)
  api/          Express, GET /health        (npm run start -w @siteaudit/api)
  worker/       queue consumer, not wired   (no Redis yet)
packages/
  shared-types/ domain enums, entity types, error codes and API envelopes
  validation/   URL safety gate (SSRF) + Zod request contracts
  config/       environment schemas, one per process, validated at startup
  audit-rules/  rule interface, empty registry
  report-template/ template version + snapshot metadata
tests/          unit tests for the API envelope and env guards, plus integration/e2e
supabase/migrations/   empty by design
docs/           the specification and the plan
```

## Rules that are not negotiable

- Measurements and deterministic rules are authoritative. AI may explain evidence; it may not
  invent metrics, findings, scores or certainty.
- The target URL and everything fetched from it is untrusted. No fetch happens before
  `packages/validation` says the URL is safe.
- No fake data in production flows. Fixtures belong in tests or clearly labelled development mode.
- Secrets stay server-side. Nothing privileged goes into a `VITE_` variable: those are compiled
  into the browser bundle.
