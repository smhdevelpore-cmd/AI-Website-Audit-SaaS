# Migrations

Empty by design in Phase 0. The schema in `docs/TRD.md` §13 (profiles, audits, audit_pages,
audit_findings, audit_metrics, audit_reports, usage_records) lands with the persistence phase,
each table with its RLS policy in the same migration that creates it.
