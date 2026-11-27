-- Phase 2 · tenant isolation (TRD §13, ARD §1).
--
-- Two independent gates, on purpose:
--   1. RLS decides which rows exist for the caller, using auth.uid() from the JWT.
--   2. The API also filters by user_id and returns 404 for anything else, so a policy mistake
--      is a bug rather than a leak, and an id probe cannot distinguish "not yours" from "absent".
--
-- The service role bypasses RLS. It is used by the worker and by server-side maintenance only,
-- never shipped to the browser (packages/config refuses to start the web build with its key).

alter table public.profiles enable row level security;
alter table public.audits enable row level security;
alter table public.audit_pages enable row level security;
alter table public.audit_findings enable row level security;
alter table public.audit_metrics enable row level security;
alter table public.audit_reports enable row level security;
alter table public.usage_records enable row level security;

-- ---------------------------------------------------------------------------
-- profiles — a user is exactly their own row
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Repair path only: the signup trigger creates the profile. If it ever fails, the user can
-- insert their own row and nobody else's.
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: deleting the auth user is the account-deletion path and cascades here.
-- Letting a browser delete its profile row would leave an auth user that cannot own an audit.

-- ---------------------------------------------------------------------------
-- audits — the ownership root every child table hangs from
-- ---------------------------------------------------------------------------
create policy audits_select_own on public.audits
  for select to authenticated
  using (user_id = auth.uid());

create policy audits_insert_own on public.audits
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'queued');

create policy audits_delete_own on public.audits
  for delete to authenticated
  using (user_id = auth.uid());

-- Deliberately no update policy. A user may ask for a cancel or a re-audit; they may not
-- write status, stage or error fields themselves, or a failed audit could be relabelled a
-- completed one. Status transitions belong to the worker and to server-side actions.

-- ---------------------------------------------------------------------------
-- children — visible only through an audit the caller owns
-- ---------------------------------------------------------------------------
create policy audit_pages_select_own on public.audit_pages
  for select to authenticated
  using (exists (
    select 1 from public.audits a
    where a.id = public.audit_pages.audit_id and a.user_id = auth.uid()
  ));

create policy audit_findings_select_own on public.audit_findings
  for select to authenticated
  using (exists (
    select 1 from public.audits a
    where a.id = public.audit_findings.audit_id and a.user_id = auth.uid()
  ));

-- The one user-writable child: triaging a finding (TRD §5 PATCH /findings/:id).
-- Column privileges restrict this to `status`, and `with check` stops a finding being moved to
-- an audit the caller does not own.
create policy audit_findings_update_own on public.audit_findings
  for update to authenticated
  using (exists (
    select 1 from public.audits a
    where a.id = public.audit_findings.audit_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.audits a
    where a.id = public.audit_findings.audit_id and a.user_id = auth.uid()
  ));

create policy audit_metrics_select_own on public.audit_metrics
  for select to authenticated
  using (exists (
    select 1 from public.audits a
    where a.id = public.audit_metrics.audit_id and a.user_id = auth.uid()
  ));

create policy audit_reports_select_own on public.audit_reports
  for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.audits a
    where a.id = public.audit_reports.audit_id and a.user_id = auth.uid()
  ));

create policy usage_records_select_own on public.usage_records
  for select to authenticated
  using (user_id = auth.uid());

-- Children are deleted by cascade when their audit is deleted, not one row at a time:
-- evidence that a client can quietly remove is not evidence.

-- ---------------------------------------------------------------------------
-- privileges — least privilege on top of RLS
--
-- RLS filters rows but does not grant them. Supabase grants ALL on public tables to anon and
-- authenticated by default, so this file narrows that: anon gets nothing at all, and
-- authenticated gets the columns its UI actually writes.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- profiles: read, self-insert, and update only the five display columns.
grant select on public.profiles to authenticated;
grant insert (id, name, agency_name, website, timezone, logo_url) on public.profiles to authenticated;
grant update (name, agency_name, website, timezone, logo_url) on public.profiles to authenticated;

-- audits: read, create an audit that starts queued, delete one's own history. No update.
grant select, insert, delete on public.audits to authenticated;

-- children: read; findings additionally allow triage of the status column only.
grant select on public.audit_pages to authenticated;
grant select on public.audit_findings to authenticated;
grant update (status) on public.audit_findings to authenticated;
grant select on public.audit_metrics to authenticated;
grant select on public.audit_reports to authenticated;
grant select on public.usage_records to authenticated;

-- Worker and server-side jobs. RLS does not apply to service_role (BYPASSRLS).
grant all on all tables in schema public to service_role;
