-- ---------------------------------------------------------------------------
-- audit_pages: the fields a crawl actually records
--
-- TRD §7 requires the page snapshot to carry the requested URL, the URL the content came from
-- (after redirects), the response time, the failure code when there was no page, and the minimal
-- parsed data the rules read. The Phase 2 schema had only the request URL, status, size and title,
-- because nothing crawled yet. This migration adds the rest rather than making a later phase
-- re-fetch to reconstruct them.
--
-- Additive only: no column is dropped or retyped, so a database that already has audit_pages rows
-- keeps them. `final_url` is backfilled from `url` for the rows that predate it.
-- ---------------------------------------------------------------------------

alter table public.audit_pages
  add column final_url text,
  add column duration_ms integer,
  add column fetch_error text,
  add column parsed jsonb;

update public.audit_pages set final_url = url where final_url is null;

alter table public.audit_pages
  alter column final_url set not null,
  add constraint audit_pages_final_url_length check (char_length(final_url) between 1 and 2048),
  -- A response time is a measurement, so it is never negative, and a value that suggests a clock
  -- mistake (an hour for one page) is refused rather than stored as truth.
  add constraint audit_pages_duration_ms_range check (duration_ms is null or duration_ms between 0 and 3600000),
  -- The crawler's failure codes are lower_snake_case (`unsafe_target`, `non_html`, `timeout`).
  -- The check keeps exception text and host names out of the column by construction.
  add constraint audit_pages_fetch_error_shape
    check (fetch_error is null or (fetch_error ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(fetch_error) <= 64)),
  -- `parsed` is a JSON object (never an array or a bare scalar), because the rules read it by key.
  add constraint audit_pages_parsed_object check (parsed is null or jsonb_typeof(parsed) = 'object');

comment on column public.audit_pages.final_url is
  'Where the content came from after redirects; equals url when no redirect happened.';
comment on column public.audit_pages.fetch_error is
  'Crawler failure code when no page was read. A code only: never error text, addresses or host names.';
comment on column public.audit_pages.parsed is
  'Minimal parsed data (title, lang, links, headings, image counts). Bounded by the crawl limits.';
