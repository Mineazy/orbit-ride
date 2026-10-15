-- Milestone 6: hardening for launch
--
--  * delete_my_account(): the account deletion the Apple App Store and Google Play require. Personal details are erased;
--    rides and ledger entries stay (anonymised) because they are financial records.
--  * Rate limits on ride requests and top-ups, so a script or a stuck app cannot flood the system.
--  * client_errors: app crashes and errors reported by the apps, readable by admins, kept for 30 days.
--
-- Run after 20261018000000_wallet_ledger.sql.

-- ---------- account deletion ----------
alter table public.profiles add column deleted_at timestamptz;

-- The profile guard stops people changing their own phone or role. Account deletion has to clear the phone, so the
-- guard steps aside while a trusted function (never a client) has set this flag for the current transaction.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() and coalesce(current_setting('app.internal_update', true), '') <> 'on' then
    if new.id is distinct from old.id or new.role is distinct from old.role or new.phone is distinct from old.phone then
      raise exception 'forbidden_field' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  acct public.ledger_accounts;
begin
  if uid is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if public.is_admin() then
    raise exception 'not_allowed' using errcode = 'P0001'; -- admins are removed by another admin, in the dashboard
  end if;
  if exists (select 1 from public.rides where status in ('REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')
             and (passenger_id = uid or driver_id = uid)) then
    raise exception 'active_ride_exists' using errcode = 'P0001';
  end if;
  -- money must be settled first: nothing owed, nothing held, no payout pending
  select * into acct from public.ledger_accounts where owner = uid;
  if found and (acct.balance <> 0 or acct.held <> 0) then
    raise exception 'balance_not_settled' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.withdrawals where user_id = uid and status = 'requested') then
    raise exception 'balance_not_settled' using errcode = 'P0001';
  end if;

  perform set_config('app.internal_update', 'on', true);
  update public.profiles set full_name = 'Deleted user', phone = null, avatar_url = null, deleted_at = now() where id = uid;
  update public.driver_profiles set vehicle = 'Removed', plate = 'REMOVED', is_online = false, approval = 'suspended', lat = null, lng = null,
    location_updated_at = null where id = uid;
  update public.topups set provider_ref = null where user_id = uid and status <> 'paid';
  delete from public.client_errors where user_id = uid;

  -- free the phone number (so it can sign up again as a new person) and stop this identity signing in
  update auth.users set phone = null, raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity' where id = uid;
  perform set_config('app.internal_update', 'off', true);
end;
$$;

-- ---------- rate limits ----------
create function public.rides_rate_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.rides where passenger_id = new.passenger_id and requested_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger rides_rate_limit before insert on public.rides
  for each row execute function public.rides_rate_limit();

create function public.topups_rate_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.topups where user_id = new.user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger topups_rate_limit before insert on public.topups
  for each row execute function public.topups_rate_limit();

-- ---------- app error log ----------
create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  app text not null check (app in ('passenger', 'driver', 'admin', 'unknown')),
  message text not null,
  stack text,
  url text,
  created_at timestamptz not null default now()
);
create index client_errors_created on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
create policy client_errors_admin_read on public.client_errors for select to authenticated using (public.is_admin());

-- Anyone (even before sign-in, when sign-in itself is what crashed) may report, within limits:
-- 20 an hour per signed-in user, 100 an hour for everyone not signed in. Old rows are removed as new ones arrive.
create function public.report_client_error(p_app text, p_message text, p_stack text default null, p_url text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  recent int;
  max_per_hour int := 100;
begin
  if uid is not null then
    max_per_hour := 20;
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    return;
  end if;
  select count(*) into recent from public.client_errors
  where created_at > now() - interval '1 hour' and user_id is not distinct from uid;
  if recent >= max_per_hour then
    return; -- silently drop: reporting must never become the problem
  end if;
  delete from public.client_errors where created_at < now() - interval '30 days';
  insert into public.client_errors (user_id, app, message, stack, url)
  values (uid, case when p_app in ('passenger', 'driver', 'admin') then p_app else 'unknown' end,
          left(p_message, 500), left(p_stack, 2000), left(p_url, 300));
end;
$$;

-- ---------- privileges ----------
revoke all on function public.delete_my_account(), public.rides_rate_limit(), public.topups_rate_limit(),
  public.report_client_error(text, text, text, text) from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.report_client_error(text, text, text, text) to anon, authenticated;
