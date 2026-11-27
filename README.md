# AI-Website-Audit-SaaS

A web SaaS that audits a public website URL, collects real measurements, explains findings in
plain language, prioritises the fixes and produces a client-ready PDF.

## Source of truth

The product specification lives in [`docs/`](docs/). Read it before changing behaviour:

- [`docs/PRD.md`](docs/PRD.md) — scope, users, functional requirements, release criteria
- [`docs/Design.md`](docs/Design.md) — IA, page specs, tokens, states, PDF design
- [`docs/TRD.md`](docs/TRD.md) — stack, API contracts, job flow, crawler security, DB/RLS, tests
- [`docs/ARD.md`](docs/ARD.md) — architecture, decisions, trust boundaries, threat model

If a requirement conflicts with these documents, stop and report the conflict. Do not silently
change scope.

## Where the project is

Phase 1 (foundation + URL safety gate) is in place. There is **no API, no crawler, no web app
and no database yet** — do not assume them.

| Path | What it is |
|---|---|
| [`packages/validation/`](packages/validation/src/) | Typed, tested URL-safety gate (SSRF) and the Zod request contracts |
| `docs/` | The specification, unchanged from the documentation pack |
| [`index.html`](index.html) | A pre-spec design prototype. **Pending a decision**: it does not follow `docs/Design.md` |
| [`AGENTS.md`](AGENTS.md), `skills/` | How work is done in this repo. The docs outrank them |
| `tools/sloplint/` | Vendored design-floor linter (MIT) |

## Commands

```bash
npm install          # once
npm run typecheck    # tsc -b, strict, all packages
npm test             # vitest run
```

Measured on this machine, 2026-11-27: `tsc -b` exits 0, `vitest run` reports 80 passed (2 files).

## Rules that are not negotiable

- Measurements and deterministic rules are authoritative. AI may explain evidence; it may not
  invent metrics, findings, scores or certainty.
- The target URL and everything fetched from it is untrusted. No fetch happens before the URL
  safety gate in `packages/validation`.
- No fake data in production flows. Fixtures belong in tests or clearly labelled development mode.
- Secrets stay server-side. Nothing privileged goes into a `VITE_` variable.
