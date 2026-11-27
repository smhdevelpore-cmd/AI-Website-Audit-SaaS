# Supabase: local setup, migrations, auth

Phase 2 stores the accounts and the audit records the later phases fill in. Nothing here
fetches a website or runs a scan.

- Schema: `supabase/migrations/`
- API auth: `apps/api/src/auth/`, `apps/api/src/data/`
- Browser auth: `apps/web/src/auth/` (`AuthProvider`, `operations.ts`, `ProtectedRoute`)
- Tests: `tests/integration/schema-migrations.test.ts`, `rls.test.ts`, `api-auth.test.ts`,
  `supabase-adapter.test.ts`, `tests/unit/auth-token.test.ts`, `web-auth.test.ts`,
  `web-auth-operations.test.ts`

## 1. What the database contains

| Table | One row per | Owner |
|---|---|---|
| `profiles` | account, created by a trigger on `auth.users` | the user |
| `audits` | requested scan | the user who asked |
| `audit_pages` | page a crawl fetched | the audit |
| `audit_findings` | issue found on a page or globally | the audit |
| `audit_metrics` | measured value (`NULL` = unavailable, never 0) | the audit |
| `audit_reports` | rendered PDF | the audit |
| `usage_records` | metered unit (page, provider call, token, report) | the user |

Ownership is `audits.user_id`; every child row reaches its owner only through that audit.

## 2. Running a Supabase project locally

Supabase runs as a set of containers (Postgres, Auth, PostgREST, Storage, Studio).

```bash
# once
npm install -g supabase        # or: brew install supabase/tap/supabase
supabase start                 # pulls images, prints URL and keys

# every time the migrations change
supabase db reset              # drops the local database, replays every migration in order
```

`supabase start` prints the values for `.env`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key>            # public; also goes to the browser as VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=<service key> # server and worker only, never VITE_
SUPABASE_JWT_SECRET=<jwt secret>        # "JWT Secret" in `supabase status`
```

Then, with `docker-compose.yml` not created yet (PLAN open question) and no Docker on this
machine, the API and web app are started separately:

```bash
cp .env.example .env      # fill in the four Supabase values
npm run dev -w apps/api
npm run dev -w apps/web
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `apps/web/.env` (or the same root `.env`
if your tooling loads it there). The web build **fails at startup** if a server-only key is
present under a `VITE_` name — `packages/config` checks the raw document before parsing.

### Pointing at a hosted project

```bash
supabase link --project-ref <ref>
supabase db push           # applies migrations not yet recorded in the remote history
```

`db push` refuses to run if the remote history has migrations the repository does not — that is
the guard against a hotfix applied by hand in the dashboard.

## 3. Migration policy

- **One direction only.** Supabase records applied migrations; it does not run "down". A mistake
  is corrected with a new migration, never by editing one that has run. Editing an applied file
  makes every environment disagree with every other.
- **Naming:** `<14-digit timestamp>_<lower_snake_case>.sql`. The CLI generates it:
  `supabase migration new add_reports_retention`.
- **Ordering:** lexicographic by filename. The test suite asserts the filenames match the
  pattern and that every file applies.
- **RLS lives beside the schema.** `docs/PLAN.md` initially said each table's policy would be in
  the same file that creates it. It is instead in `20261127090200_row_level_security.sql`,
  because it reads better in one block — and the invariant that mattered is enforced harder: a
  test asserts that **every** table in `public` has RLS enabled and at least one policy, and that
  no policy is visible to `anon` or `public`. A table added later without a policy fails the
  suite.
- **Repeatability is tested, not assumed.** `schema-migrations.test.ts` migrates two independent
  empty databases from the same files and compares columns, constraints, indexes, policies and
  triggers. If a migration depends on something already present by accident, the two catalogs
  differ and the build fails.

### What "repeatable" does and does not mean

| Checked by | Not checked |
|---|---|
| fresh database → same catalog every time | performance under production data volume |
| every migration applies in order from empty | Supabase CLI's own history bookkeeping |
| `CHECK` lists match `shared-types` enums | storage bucket policies (no storage in this phase) |

## 4. Row Level Security

Two independent gates:

1. **RLS**, driven by `auth.uid()` from the caller's JWT. The API never queries with the service
   role on a user's behalf; it forwards the caller's token to PostgREST, so the database is what
   decides visibility.
2. **The ownership helper** (`apps/api/src/data/audits.ts`), which compares `user_id` with the
   verified token's subject and answers `404` for both "does not exist" and "not yours" — a `403`
   would confirm that an id exists.

Privileges narrow RLS further: `authenticated` may read its own children, but only the worker
(`service_role`) can write findings, metrics, pages, reports and usage rows. The one
user-writable child column is `audit_findings.status`, for triage.

`service_role` bypasses RLS. It is used by the worker and by server-side jobs only. It is not
read by `apps/api/src/data/supabase.ts` at all — a request path that never loads the key cannot
leak it.

### How the RLS tests run without Docker

`tests/support/database.ts` starts **PGlite**, PostgreSQL compiled to WebAssembly, creates the
`anon` / `authenticated` / `service_role` roles and an `auth.users` table with Supabase's own
`auth.uid()` definition, then applies the migration files **unmodified**. Each assertion then
runs under `set role authenticated` with a `request.jwt.claim.sub` value, which is exactly the
state PostgREST puts a connection in per request.

Covered: two-user isolation on all seven tables, unauthenticated access, child access through
ownership, cross-tenant writes, audit-status tampering, usage-ledger immutability, cascades,
profile provisioning.

Not covered, and not claimed: Supabase Auth's HTTP endpoints (signup, login, refresh, reset
mail), PostgREST's own request parsing, storage buckets, and hosted-project differences. Those
need `supabase start` and a browser; see §6.

## 5. Auth

The browser signs in with `supabase-js` (PKCE, session persisted, token auto-refreshed). The API
verifies the access token itself with `jose`:

- `SUPABASE_JWT_SECRET` → HS256 (legacy shared secret),
- otherwise `SUPABASE_JWKS_URL` → RS256/ES256 against the project's published keys.

Checks applied to every token: signature, `exp`, `aud = "authenticated"`, optional `iss`, a
`sub` that is a UUID, and a `role` claim that is absent or exactly `authenticated`. A
`service_role` token presented as a user token is rejected — otherwise an operator key would
become every tenant's key.

With neither key configured, the API still serves `/health` and the contract probe, and answers
auth-protected routes with `503 service_unavailable`. It does not pretend a token was checked.

The browser bundle contains the **names** in `SERVER_ONLY_ENV_KEYS` — that list is the web
build's own guard, and it has to exist in the bundle to run there. Names are not values: a real
service-role key in a `VITE_` variable fails the guard before the build produces a file.

Endpoints in this phase: `GET /api/v1/me`, `GET|PATCH /api/v1/profile`, `GET /api/v1/audits/:id`.
There is no create endpoint: creating an audit means enqueuing a job, and no queue exists yet.

## 6. What still has to be done by hand

1. `supabase start` and `supabase db reset` on a machine with Docker, confirming the CLI accepts
   the migration files.
2. Sign up, confirm the email, sign in, sign out, reset the password — through the real Auth
   service, in a browser. The calls the screens make are tested against a fake client
   (`web-auth-operations.test.ts`); the service answering them is not.
3. Two real accounts, one audit each, signed in as each in turn: the other's audit must 404.
4. A hosted project's JWKS URL, to exercise the asymmetric path against the real endpoint (the
   key resolver is tested with a locally generated key pair; the HTTPS fetch is not).

None of these can run in this environment: no Docker, no Supabase CLI, no browser.
