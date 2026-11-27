-- ---------------------------------------------------------------------------
-- PageSpeed Insights metrics (TRD §10, PRD FR-06)
--
-- `audit_metrics` already had the columns a measurement needs: category, key, label, value, unit,
-- source, status. Three things were missing for a *third-party* measurement, and they are the
-- whole of this migration:
--
--   - **strategy** — Lighthouse answers a different question for mobile and for desktop. Two runs
--     of the same audit are two different rows, not a conflict.
--   - **reason** — a provider that returned nothing has a cause (quota, timeout, malformed), and a
--     report that says "unavailable" without saying why is a dead end for whoever reads it.
--   - **a bounded raw payload** — TRD §10 asks for the selected raw response. It is kept on the
--     score row only, bounded by a size check, because a full Lighthouse JSON is megabytes and the
--     rest of the numbers are already extracted into typed columns.
--
-- And at the audit level, one status of its own: `metrics_status`. The audit's own `status` says
-- whether the *scan* succeeded; this says whether the provider did. Folding them together would
-- make "PageSpeed was out of quota" indistinguishable from "the site failed to load".
-- ---------------------------------------------------------------------------

alter table public.audit_metrics
  add column strategy text,
  add column reason text,
  add column raw jsonb,
  add constraint audit_metrics_strategy_valid
    check (strategy is null or strategy in ('MOBILE', 'DESKTOP')),
  add constraint audit_metrics_reason_valid
    check (reason is null or reason in
      ('not_configured', 'quota', 'timeout', 'invalid_url', 'http_error', 'malformed_response')),
  add constraint audit_metrics_raw_object
    check (raw is null or jsonb_typeof(raw) = 'object'),
  -- A stored raw payload is a sample, not an archive: the cap keeps a row small enough to read.
  add constraint audit_metrics_raw_size
    check (raw is null or length(raw::text) <= 20000);

-- The Phase 2 index deduplicated on (audit, page, key) only. Once a run records which strategy it
-- used, mobile and desktop are two different measurements of the same key and must both be
-- storable, so the narrower index is replaced by one that includes the source and the strategy.
drop index if exists public.audit_metrics_scope_key;

-- One row per audit, page, metric, source and strategy. A retried audit replaces its own metrics
-- instead of doubling them; a second strategy is a second row.
create unique index audit_metrics_dedupe
  on public.audit_metrics (
    audit_id,
    coalesce(page_id::text, 'global'),
    metric_key,
    source,
    coalesce(strategy, '')
  );

alter table public.audits
  add column metrics_status text not null default 'skipped',
  add column metrics_reason text,
  add column metrics_strategy text,
  add column metrics_provider_version text,
  add column metrics_measured_at timestamptz,
  add constraint audits_metrics_status_valid
    check (metrics_status in ('ok', 'partial', 'unavailable', 'skipped')),
  add constraint audits_metrics_reason_valid
    check (metrics_reason is null or metrics_reason in
      ('not_configured', 'quota', 'timeout', 'invalid_url', 'http_error', 'malformed_response')),
  -- A reason only exists for a provider that did not fully answer.
  add constraint audits_metrics_reason_has_failure
    check (metrics_reason is null or metrics_status in ('partial', 'unavailable')),
  add constraint audits_metrics_strategy_valid
    check (metrics_strategy is null or metrics_strategy in ('MOBILE', 'DESKTOP')),
  add constraint audits_metrics_provider_version_length
    check (metrics_provider_version is null or char_length(metrics_provider_version) <= 60);

comment on column public.audits.metrics_status is
  'ok = every metric returned; partial = some; unavailable = the provider failed; skipped = no key.';
comment on column public.audit_metrics.strategy is
  'Lighthouse strategy. Mobile and desktop are different measurements, not duplicates.';
