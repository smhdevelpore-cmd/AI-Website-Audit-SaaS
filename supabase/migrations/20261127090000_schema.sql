-- Phase 2 · schema for profiles, audits and their children (TRD §13).
--
-- Every status/category/severity list below mirrors a const array in
-- packages/shared-types/src/domain.ts. SQL cannot import TypeScript, so the duplication is
-- unavoidable; tests/integration/schema-migrations.test.ts reads these CHECK constraints back
-- out of the catalog and fails if the two ever disagree.
--
-- Nothing here is fetched, scanned or generated: this phase stores what later phases produce.

-- ---------------------------------------------------------------------------
-- profiles — one row per Supabase auth user, created by trigger (0002)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  agency_name text,
  website text,
  timezone text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The same lengths `updateProfileSchema` enforces in packages/validation.
  constraint profiles_name_length check (char_length(name) between 1 and 80),
  constraint profiles_agency_name_length check (agency_name is null or char_length(agency_name) between 1 and 120),
  constraint profiles_website_length check (website is null or char_length(website) <= 2048),
  constraint profiles_timezone_length check (timezone is null or char_length(timezone) <= 64),
  constraint profiles_logo_url_length check (logo_url is null or char_length(logo_url) <= 2048)
);

comment on table public.profiles is
  'Display data for one auth user. Identity lives in auth.users; deleting that user cascades here.';

-- ---------------------------------------------------------------------------
-- audits — one row per requested scan; immutable once terminal
-- ---------------------------------------------------------------------------
create table public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  url text not null,
  host text not null,
  client_name text,
  project_name text,
  status text not null default 'queued',
  stage text,
  max_pages integer not null default 25,
  pages_scanned integer not null default 0,
  was_partial boolean not null default false,
  scoring_version text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint audits_status_valid
    check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  constraint audits_stage_valid
    check (stage is null or stage in ('validating', 'crawling', 'performance', 'rules', 'links', 'scoring', 'ai', 'persisting')),
  constraint audits_url_http
    check (url ~* '^https?://' and char_length(url) <= 2048),
  constraint audits_host_length
    check (char_length(host) between 1 and 253),
  constraint audits_max_pages_range
    check (max_pages between 1 and 25),
  constraint audits_pages_scanned_non_negative
    check (pages_scanned >= 0),
  constraint audits_client_name_length
    check (client_name is null or char_length(client_name) <= 120),
  constraint audits_project_name_length
    check (project_name is null or char_length(project_name) <= 120),
  -- A sanitized message the UI may show. Short on purpose: stack traces do not belong in a row.
  constraint audits_error_message_length
    check (error_message is null or char_length(error_message) <= 500),
  -- Terminal statuses are exactly the ones that must carry a finish time, and vice versa.
  constraint audits_terminal_timestamp
    check ((status in ('completed', 'partial', 'failed', 'cancelled')) = (completed_at is not null))
);

comment on table public.audits is
  'One scan request. Terminal statuses must carry completed_at (audits_terminal_timestamp).';

-- ---------------------------------------------------------------------------
-- audit_pages — what the crawl actually fetched
-- ---------------------------------------------------------------------------
create table public.audit_pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  url text not null,
  depth integer not null default 0,
  http_status integer,
  content_type text,
  byte_size integer,
  title text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),

  constraint audit_pages_url_length check (char_length(url) between 1 and 2048),
  constraint audit_pages_depth_range check (depth between 0 and 10),
  constraint audit_pages_http_status_range check (http_status is null or http_status between 100 and 599),
  constraint audit_pages_byte_size_non_negative check (byte_size is null or byte_size >= 0),
  constraint audit_pages_title_length check (title is null or char_length(title) <= 300),
  -- The same URL appears once per audit, so a retried crawl cannot double-count a page.
  constraint audit_pages_unique_url unique (audit_id, url)
);

-- ---------------------------------------------------------------------------
-- audit_findings — deterministic and provider findings (TRD §8)
-- ---------------------------------------------------------------------------
create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  page_id uuid references public.audit_pages (id) on delete cascade,
  issue_code text not null,
  category text not null,
  severity text not null,
  title text not null,
  description text not null,
  -- `Finding.evidence` is a string in the shared contract; keep the column identical to it.
  evidence text not null,
  recommendation text,
  source text not null,
  confidence text not null,
  status text not null default 'open',
  -- 'global' findings have no page; the key makes the dedupe unique index possible.
  page_key text generated always as (coalesce(page_id::text, 'global')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint audit_findings_issue_code_shape check (issue_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint audit_findings_issue_code_length check (char_length(issue_code) <= 80),
  constraint audit_findings_category_valid
    check (category in ('performance', 'seo', 'technical', 'mobile', 'accessibility', 'security', 'links')),
  constraint audit_findings_severity_valid
    check (severity in ('critical', 'high', 'medium', 'low')),
  constraint audit_findings_source_valid check (source in ('rule', 'provider')),
  constraint audit_findings_confidence_valid check (confidence in ('observed', 'inferred', 'untestable')),
  constraint audit_findings_status_valid check (status in ('open', 'resolved', 'ignored')),
  constraint audit_findings_title_length check (char_length(title) between 1 and 200),
  -- TRD §6: writes are idempotent on audit + issue code + page scope.
  constraint audit_findings_dedupe unique (audit_id, issue_code, page_key)
);

-- ---------------------------------------------------------------------------
-- audit_metrics — measured numbers, where NULL is "unavailable", never zero
-- ---------------------------------------------------------------------------
create table public.audit_metrics (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  page_id uuid references public.audit_pages (id) on delete cascade,
  category text not null,
  metric_key text not null,
  label text not null,
  value numeric,
  unit text not null,
  source text not null,
  status text not null,
  provider_version text,
  measured_at timestamptz,
  created_at timestamptz not null default now(),

  constraint audit_metrics_category_valid
    check (category in ('performance', 'seo', 'technical', 'mobile', 'accessibility', 'security', 'links')),
  constraint audit_metrics_value_range check (value is null or (value >= -1000000000 and value <= 1000000000)),
  constraint audit_metrics_unit_valid check (unit in ('ms', 'score', 'ratio', 'count', 'bytes', 'none')),
  constraint audit_metrics_source_valid check (source in ('pagespeed', 'crawler', 'rule')),
  constraint audit_metrics_status_valid check (status in ('ok', 'unavailable', 'partial')),
  -- PRD FR-13: an unavailable metric may not carry a number, so it cannot be scored as zero.
  constraint audit_metrics_unavailable_has_no_value check (status <> 'unavailable' or value is null),
  constraint audit_metrics_key_length check (char_length(metric_key) between 1 and 120)
);

-- One measurement per key per scope; a retried module overwrites rather than duplicates.
create unique index audit_metrics_scope_key
  on public.audit_metrics (audit_id, metric_key, (coalesce(page_id::text, 'global')));

-- ---------------------------------------------------------------------------
-- audit_reports — a rendered PDF in private storage (TRD §12)
-- ---------------------------------------------------------------------------
create table public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'queued',
  template_version text not null,
  storage_path text,
  byte_size integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint audit_reports_status_valid check (status in ('queued', 'rendering', 'ready', 'failed')),
  constraint audit_reports_storage_path_length check (storage_path is null or char_length(storage_path) <= 512),
  constraint audit_reports_byte_size_non_negative check (byte_size is null or byte_size >= 0),
  constraint audit_reports_error_message_length check (error_message is null or char_length(error_message) <= 500),
  -- A ready report is one whose bytes exist at a path; anything else is a claim without a file.
  constraint audit_reports_ready_has_storage check (status <> 'ready' or storage_path is not null),
  constraint audit_reports_storage_path_unique unique (storage_path)
);

-- ---------------------------------------------------------------------------
-- usage_records — append-only meter for quota and cost (TRD §14)
-- ---------------------------------------------------------------------------
create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  audit_id uuid references public.audits (id) on delete set null,
  kind text not null,
  quantity numeric not null,
  estimated_cost_usd numeric(12, 6) not null default 0,
  recorded_at timestamptz not null default now(),

  constraint usage_records_kind_valid
    check (kind in ('audit', 'page', 'provider_call', 'ai_token', 'report', 'storage_byte')),
  constraint usage_records_quantity_non_negative check (quantity >= 0),
  constraint usage_records_cost_non_negative check (estimated_cost_usd >= 0)
);

comment on table public.usage_records is
  'Append-only. No update or delete path exists for users: a meter that can be edited is not a meter.';

-- ---------------------------------------------------------------------------
-- indexes (TRD §13) plus the ones the foreign keys need to avoid seq scans
-- ---------------------------------------------------------------------------
create index audits_user_created_idx on public.audits (user_id, created_at desc);
create index audits_status_created_idx on public.audits (status, created_at desc);
create index audit_pages_audit_idx on public.audit_pages (audit_id);
create index audit_findings_audit_idx on public.audit_findings (audit_id, category, severity);
create index audit_findings_page_idx on public.audit_findings (page_id);
create index audit_metrics_audit_idx on public.audit_metrics (audit_id, category);
create index audit_metrics_page_idx on public.audit_metrics (page_id);
create index audit_reports_user_audit_idx on public.audit_reports (user_id, audit_id);
create index audit_reports_audit_idx on public.audit_reports (audit_id);
create index usage_records_user_recorded_idx on public.usage_records (user_id, recorded_at desc);
create index usage_records_audit_idx on public.usage_records (audit_id);

-- ---------------------------------------------------------------------------
-- updated_at is maintained by the database, not by whichever caller remembers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger audits_touch_updated_at
  before update on public.audits
  for each row execute function public.touch_updated_at();

create trigger audit_findings_touch_updated_at
  before update on public.audit_findings
  for each row execute function public.touch_updated_at();

create trigger audit_reports_touch_updated_at
  before update on public.audit_reports
  for each row execute function public.touch_updated_at();
