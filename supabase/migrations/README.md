# Migrations

Applied in filename order. One direction: a mistake is fixed by a new migration, never by
editing one that has already run (docs/SUPABASE.md §3).

| File | What it creates |
|---|---|
| `20261127090000_schema.sql` | the seven tables, constraints, foreign keys, indexes, `updated_at` triggers |
| `20261127090100_profile_provisioning.sql` | the signup trigger that creates a profile, plus a backfill |
| `20261127090200_row_level_security.sql` | RLS policies and the privileges that narrow them |
| `20261127090300_audit_page_snapshot.sql` | `final_url`, `duration_ms`, `fetch_error` and `parsed` on `audit_pages` (additive, backfilled) |

RLS is in its own file rather than beside each table, and
`tests/integration/schema-migrations.test.ts` enforces the invariant that mattered anyway:
every table in `public` has RLS enabled, at least one policy, and no policy visible to `anon`
or `public`.

The `CHECK` lists in the schema mirror the const arrays in
`packages/shared-types/src/domain.ts`. SQL cannot import TypeScript, so the test reads the
constraints back out of the catalog and fails if the two disagree.

Local commands, the repeatability check and what the RLS tests do and do not cover:
`docs/SUPABASE.md`.
