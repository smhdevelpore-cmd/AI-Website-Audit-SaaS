# Migrations

Applied in filename order. One direction: a mistake is fixed by a new migration, never by
editing one that has already run (docs/SUPABASE.md §3).

| File | What it creates |
|---|---|
| `20261127090000_schema.sql` | the seven tables, constraints, foreign keys, indexes, `updated_at` triggers |
| `20261127090100_profile_provisioning.sql` | the signup trigger that creates a profile, plus a backfill |
| `20261127090200_row_level_security.sql` | RLS policies and the privileges that narrow them |
| `20261127090300_audit_page_snapshot.sql` | `final_url`, `duration_ms`, `fetch_error` and `parsed` on `audit_pages` (additive, backfilled) |
| `20261127090400_audit_scores.sql` | `overall_score`, `category_scores` and `scoring_version` on `audits`, with the constraints that tie a finished audit to its score |
| `20261127090500_ai_explanations.sql` | `audit_findings.ai_explanation`, `audits.ai_summary/ai_status/ai_model`, and the constraints that keep AI output beside a result rather than inside one |

RLS is in its own file rather than beside each table, and
`tests/integration/schema-migrations.test.ts` enforces the invariant that mattered anyway:
every table in `public` has RLS enabled, at least one policy, and no policy visible to `anon`
or `public`.

The `CHECK` lists in the schema mirror the const arrays in
`packages/shared-types/src/domain.ts`. SQL cannot import TypeScript, so the test reads the
constraints back out of the catalog and fails if the two disagree.

Local commands, the repeatability check and what the RLS tests do and do not cover:
`docs/SUPABASE.md`.
