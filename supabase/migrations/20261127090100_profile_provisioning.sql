-- Phase 2 · profiles are created by the database on signup, not by the browser.
--
-- If the client had to create its own profile, every client could forget, and an account
-- without a profile is an account that cannot own an audit (audits.user_id -> profiles.id).
-- The trigger runs as definer so it works before the new user holds any privilege.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposed_name text;
begin
  -- Metadata is optional and untrusted: fall back to the email local part, then to a literal.
  proposed_name := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
  if proposed_name = '' then
    proposed_name := btrim(split_part(coalesce(new.email, ''), '@', 1));
  end if;
  if proposed_name = '' then
    proposed_name := 'New account';
  end if;

  insert into public.profiles (id, name)
  values (new.id, left(proposed_name, 80))
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile row for a new auth user. Idempotent (on conflict do nothing).';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users who signed up before this trigger existed, and any account whose profile insert
-- failed, get a profile here. Safe to run repeatedly.
insert into public.profiles (id, name)
select
  u.id,
  left(
    coalesce(
      nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
      nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''),
      'New account'
    ),
    80
  )
from auth.users u
on conflict (id) do nothing;
