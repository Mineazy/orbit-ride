-- Milestone 5: wallet and ledger
--
-- A double-entry ledger records every movement of money, so balances can always be explained and audited:
--
--   * every transfer writes two entries (one negative, one positive) that sum to zero, in one transaction
--   * entries can never be changed or deleted
--   * accounts: one per user, one for the platform (fees earned) and one for "external" (money entering or leaving
--     through the payment gateway or a bank payout)
--
-- Payment methods: 'cash' (the default) and 'wallet', which stays off until platform_settings.wallet_enabled is switched on.
--   cash ride:   the driver collects the fare; on completion the driver's wallet pays the platform fee, so a driver's
--                balance goes negative by the fees they owe. A driver whose debt passes driver_debt_limit cannot go online
--                or accept rides until they top up.
--   wallet ride: the fare is held in the passenger's wallet when requested, released if the ride is cancelled, and paid to
--                the driver when it completes (the platform fee is then taken from the driver).
--
-- Top-ups: create_topup() records the intent; the payment gateway webhook (a server running with the service role)
-- calls complete_topup() once the money has really arrived. complete_topup is idempotent, so a repeated webhook
-- never credits twice. Nothing here talks to a gateway: see docs/production-roadmap.md.
--
-- Run after 20261017000000_route_limits.sql.

alter table public.platform_settings
  add column wallet_enabled boolean not null default false,
  add column driver_debt_limit numeric(8, 2) not null default 200 check (driver_debt_limit >= 0),
  add column min_topup numeric(8, 2) not null default 10 check (min_topup > 0),
  add column max_topup numeric(8, 2) not null default 2000 check (max_topup >= min_topup);

-- ---------- ledger ----------
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('user', 'platform', 'external')),
  owner uuid unique references public.profiles (id),
  balance numeric(12, 2) not null default 0,
  held numeric(12, 2) not null default 0 check (held >= 0), -- part of the balance reserved for a pending ride or withdrawal
  check ((kind = 'user') = (owner is not null))
);
create unique index ledger_accounts_singletons on public.ledger_accounts (kind) where kind <> 'user';
insert into public.ledger_accounts (kind) values ('platform'), ('external');

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transfer_id uuid not null,
  account_id uuid not null references public.ledger_accounts (id),
  amount numeric(12, 2) not null check (amount <> 0), -- negative = money leaves the account
  balance_after numeric(12, 2) not null,
  kind text not null check (kind in ('topup', 'ride_payment', 'commission', 'withdrawal', 'adjustment')),
  ride_id uuid references public.rides (id),
  note text,
  created_at timestamptz not null default now()
);
create index ledger_entries_account on public.ledger_entries (account_id, id desc);
create index ledger_entries_transfer on public.ledger_entries (transfer_id);
-- a ride can be paid for and charged a fee only once
create unique index ledger_entries_once_per_ride on public.ledger_entries (ride_id, kind, account_id) where ride_id is not null;

create function public.ledger_entries_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'ledger_entries are append-only';
end;
$$;
create trigger ledger_entries_no_update before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_immutable();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function public.ledger_entries_immutable();

create table public.topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  amount numeric(8, 2) not null check (amount > 0),
  provider text not null default 'manual',
  provider_ref text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index topups_user on public.topups (user_id, created_at desc);

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);
create index withdrawals_user on public.withdrawals (user_id, created_at desc);

alter table public.rides drop constraint rides_payment_method_check;
alter table public.rides add constraint rides_payment_method_check check (payment_method in ('cash', 'wallet'));
alter table public.rides add column fare_held numeric(8, 2) not null default 0 check (fare_held >= 0);

-- ---------- internal helpers (not callable by apps) ----------
create function public.ledger_account(p_owner uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acct uuid;
begin
  select id into acct from public.ledger_accounts where owner = p_owner;
  if acct is null then
    insert into public.ledger_accounts (kind, owner) values ('user', p_owner)
    on conflict (owner) do nothing;
    select id into acct from public.ledger_accounts where owner = p_owner;
  end if;
  return acct;
end;
$$;

create function public.platform_account() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.ledger_accounts where kind = 'platform'
$$;

create function public.external_account() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.ledger_accounts where kind = 'external'
$$;

-- The only way money moves: two balanced entries, accounts locked in a fixed order to avoid deadlocks
create function public.post_transfer(p_from uuid, p_to uuid, p_amount numeric, p_kind text, p_ride uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tid uuid := gen_random_uuid();
  new_from numeric;
  new_to numeric;
begin
  if p_amount is null or p_amount <= 0 or p_from = p_to then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  perform 1 from public.ledger_accounts where id in (p_from, p_to) order by id for update;
  update public.ledger_accounts set balance = balance - p_amount where id = p_from returning balance into new_from;
  update public.ledger_accounts set balance = balance + p_amount where id = p_to returning balance into new_to;
  insert into public.ledger_entries (transfer_id, account_id, amount, balance_after, kind, ride_id, note) values
    (tid, p_from, -p_amount, new_from, p_kind, p_ride, p_note),
    (tid, p_to, p_amount, new_to, p_kind, p_ride, p_note);
  return tid;
end;
$$;

-- Is this driver allowed to work, or do they owe the platform too much?
create function public.driver_debt_ok(p_driver uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select a.balance from public.ledger_accounts a where a.owner = p_driver), 0)
         >= -(select driver_debt_limit from public.platform_settings where id)
$$;

-- ---------- RLS: people read their own money records, nobody writes directly ----------
alter table public.ledger_accounts enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.topups enable row level security;
alter table public.withdrawals enable row level security;

create policy ledger_accounts_read on public.ledger_accounts for select to authenticated
  using (owner = auth.uid() or public.is_admin());
create policy ledger_entries_read on public.ledger_entries for select to authenticated
  using (public.is_admin() or exists (select 1 from public.ledger_accounts a where a.id = account_id and a.owner = auth.uid()));
create policy topups_read on public.topups for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy withdrawals_read on public.withdrawals for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------- the public API ----------
create function public.my_wallet() returns table (balance numeric, held numeric, available numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acct uuid;
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  acct := public.ledger_account(auth.uid());
  return query select a.balance, a.held, a.balance - a.held from public.ledger_accounts a where a.id = acct;
end;
$$;

create function public.create_topup(p_amount numeric) returns public.topups
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  st public.platform_settings;
  t public.topups;
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  select * into st from public.platform_settings where id;
  if not st.wallet_enabled then
    raise exception 'wallet_disabled' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < st.min_topup or p_amount > st.max_topup then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  insert into public.topups (user_id, amount) values (auth.uid(), round(p_amount, 2)) returning * into t;
  return t;
end;
$$;

-- Called by the payment gateway webhook (service role) once the money has really arrived. Safe to call twice.
create function public.complete_topup(p_topup_id uuid, p_provider_ref text, p_provider text default 'gateway') returns public.topups
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.topups;
begin
  if p_provider_ref is null or length(trim(p_provider_ref)) = 0 then
    raise exception 'invalid_reference' using errcode = 'P0001';
  end if;
  select * into t from public.topups where id = p_topup_id for update;
  if not found then
    raise exception 'topup_not_found' using errcode = 'P0001';
  end if;
  if t.status = 'paid' then
    return t; -- already credited
  end if;
  if t.status = 'failed' then
    raise exception 'topup_failed' using errcode = 'P0001';
  end if;
  update public.topups set status = 'paid', paid_at = now(), provider_ref = p_provider_ref, provider = p_provider
  where id = p_topup_id returning * into t;
  perform public.post_transfer(public.external_account(), public.ledger_account(t.user_id), t.amount, 'topup', null, 'top-up ' || t.id);
  return t;
end;
$$;

create function public.fail_topup(p_topup_id uuid) returns public.topups
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.topups;
begin
  update public.topups set status = 'failed' where id = p_topup_id and status = 'pending' returning * into t;
  if not found then
    raise exception 'topup_not_found' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

-- A driver asks to be paid out some of a positive balance. The money is held until an admin pays it by bank transfer.
create function public.request_withdrawal(p_amount numeric) returns public.withdrawals
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acct uuid;
  w public.withdrawals;
begin
  if public.app_role() is distinct from 'driver' then
    raise exception 'not_a_driver' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  acct := public.ledger_account(auth.uid());
  perform 1 from public.ledger_accounts where id = acct for update;
  if (select a.balance - a.held from public.ledger_accounts a where a.id = acct) < p_amount then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;
  update public.ledger_accounts set held = held + round(p_amount, 2) where id = acct;
  insert into public.withdrawals (user_id, amount) values (auth.uid(), round(p_amount, 2)) returning * into w;
  return w;
end;
$$;

create function public.admin_resolve_withdrawal(p_id uuid, p_status text) returns public.withdrawals
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w public.withdrawals;
  acct uuid;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_status not in ('paid', 'rejected') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  select * into w from public.withdrawals where id = p_id for update;
  if not found or w.status <> 'requested' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  acct := public.ledger_account(w.user_id);
  update public.ledger_accounts set held = held - w.amount where id = acct;
  if p_status = 'paid' then
    perform public.post_transfer(acct, public.external_account(), w.amount, 'withdrawal', null, 'payout ' || w.id);
  end if;
  update public.withdrawals set status = p_status, resolved_at = now(), resolved_by = auth.uid() where id = p_id returning * into w;
  return w;
end;
$$;

-- An admin records money a driver handed over outside the app (cash or bank transfer), settling fees they owe.
-- Use a negative amount to correct a mistake. The note is kept in the ledger.
create function public.admin_record_payment(p_driver uuid, p_amount numeric, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.driver_profiles where id = p_driver) then
    raise exception 'driver_not_found' using errcode = 'P0001';
  end if;
  if p_amount > 0 then
    perform public.post_transfer(public.external_account(), public.ledger_account(p_driver), round(p_amount, 2), 'adjustment', null, left(coalesce(p_note, 'payment received'), 300));
  else
    perform public.post_transfer(public.ledger_account(p_driver), public.external_account(), round(-p_amount, 2), 'adjustment', null, left(coalesce(p_note, 'correction'), 300));
  end if;
end;
$$;

create function public.admin_finance_summary() returns table (
  platform_earned numeric, topped_up numeric, paid_out numeric, drivers_owe numeric, owed_to_drivers numeric, pending_withdrawals numeric
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return query select
    (select a.balance from public.ledger_accounts a where a.kind = 'platform'),
    coalesce((select sum(e.amount) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
              where e.kind = 'topup' and a.kind = 'user'), 0),
    coalesce(-(select sum(e.amount) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
               where e.kind = 'withdrawal' and a.kind = 'user'), 0),
    coalesce(-(select sum(a.balance) from public.ledger_accounts a join public.driver_profiles d on d.id = a.owner where a.balance < 0), 0),
    coalesce((select sum(a.balance) from public.ledger_accounts a join public.driver_profiles d on d.id = a.owner where a.balance > 0), 0),
    coalesce((select sum(w.amount) from public.withdrawals w where w.status = 'requested'), 0);
end;
$$;

-- ---------- redefined functions that now touch money ----------
drop function public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric);
create function public.request_ride(
  p_pickup_name text, p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_name text, p_dropoff_lat double precision, p_dropoff_lng double precision,
  p_tier public.vehicle_tier, p_distance_km numeric, p_offer numeric default null,
  p_payment_method text default 'cash'
) returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  cfg public.fare_config;
  st public.platform_settings;
  straight double precision;
  suggested numeric;
  final_fare numeric;
  ride public.rides;
  acct uuid;
  hold numeric := 0;
begin
  if uid is null or public.app_role() is distinct from 'passenger' then
    raise exception 'not_a_passenger' using errcode = 'P0001';
  end if;
  if p_pickup_lat not between -90 and 90 or p_dropoff_lat not between -90 and 90
     or p_pickup_lng not between -180 and 180 or p_dropoff_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = 'P0001';
  end if;

  select * into st from public.platform_settings where id;
  straight := public.km_between(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  if straight < 0.05 then
    raise exception 'same_location' using errcode = 'P0001';
  end if;
  -- the client measures the street distance; the server only accepts a plausible one
  if p_distance_km is null or p_distance_km < straight * 0.95
     or p_distance_km > greatest(straight * st.max_route_factor, straight + st.max_route_extra_km) then
    raise exception 'invalid_distance' using errcode = 'P0001';
  end if;

  select * into cfg from public.fare_config where tier = p_tier;
  suggested := greatest(cfg.min_fare, round(((cfg.base_fare + cfg.per_km * p_distance_km) * st.surge_multiplier)::numeric, 2));

  if p_offer is null then
    final_fare := suggested;
  else
    if p_offer < suggested * st.offer_min_factor or p_offer > suggested * st.offer_max_factor then
      raise exception 'offer_out_of_range' using errcode = 'P0001';
    end if;
    final_fare := round(p_offer, 2);
  end if;

  if p_payment_method = 'wallet' then
    if not st.wallet_enabled then
      raise exception 'wallet_disabled' using errcode = 'P0001';
    end if;
    acct := public.ledger_account(uid);
    perform 1 from public.ledger_accounts where id = acct for update; -- serialise with other spending
    if (select a.balance - a.held from public.ledger_accounts a where a.id = acct) < final_fare then
      raise exception 'insufficient_funds' using errcode = 'P0001';
    end if;
    hold := final_fare;
  elsif p_payment_method is distinct from 'cash' then
    raise exception 'invalid_payment_method' using errcode = 'P0001';
  end if;

  begin
    insert into public.rides (
      passenger_id, tier, pickup_name, dropoff_name, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      distance_km, suggested_fare, fare, payment_method, fare_held
    ) values (
      uid, p_tier, left(trim(p_pickup_name), 200), left(trim(p_dropoff_name), 200),
      p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, round(p_distance_km, 2), suggested, final_fare, p_payment_method, hold
    ) returning * into ride;
  exception when unique_violation then
    raise exception 'active_ride_exists' using errcode = 'P0001';
  end;

  if hold > 0 then
    update public.ledger_accounts set held = held + hold where id = acct;
  end if;

  perform public.log_ride_event(ride.id, 'requested');
  return ride;
end;
$$;

create or replace function public.accept_ride(p_ride_id uuid) returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  drv public.driver_profiles;
  ride public.rides;
begin
  select * into drv from public.driver_profiles where id = uid;
  if not found or drv.approval <> 'approved' or not drv.is_online then
    raise exception 'driver_not_available' using errcode = 'P0001';
  end if;

  if not public.driver_debt_ok(uid) then
    raise exception 'debt_limit_reached' using errcode = 'P0001';
  end if;

  select * into ride from public.rides where id = p_ride_id for update; -- serialises concurrent accepts
  if not found or ride.status <> 'REQUESTED' or ride.driver_id is not null then
    raise exception 'ride_unavailable' using errcode = 'P0001';
  end if;
  if ride.tier <> drv.tier then
    raise exception 'wrong_tier' using errcode = 'P0001';
  end if;
  if not public.driver_can_serve(ride.tier, ride.pickup_lat, ride.pickup_lng) then
    raise exception 'too_far' using errcode = 'P0001';
  end if;

  begin
    update public.rides set driver_id = uid, status = 'ACCEPTED', accepted_at = now()
    where id = p_ride_id returning * into ride;
  exception when unique_violation then
    raise exception 'driver_busy' using errcode = 'P0001';
  end;

  perform public.log_ride_event(ride.id, 'accepted');
  return ride;
end;
$$;

create or replace function public.set_driver_online(p_online boolean) returns public.driver_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.driver_profiles;
begin
  select * into d from public.driver_profiles where id = auth.uid() for update;
  if not found or d.approval <> 'approved' then
    raise exception 'driver_not_approved' using errcode = 'P0001';
  end if;
  if p_online and not public.driver_debt_ok(auth.uid()) then
    raise exception 'debt_limit_reached' using errcode = 'P0001';
  end if;
  if not p_online and exists (
    select 1 from public.rides where driver_id = auth.uid() and status in ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS')
  ) then
    raise exception 'ride_in_progress' using errcode = 'P0001';
  end if;
  update public.driver_profiles set is_online = p_online where id = auth.uid() returning * into d;
  return d;
end;
$$;

-- Passenger (before the trip starts) or an admin (any live ride) cancels
create or replace function public.cancel_ride(p_ride_id uuid, p_reason text default null) returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  ride public.rides;
begin
  select * into ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'ride_not_found' using errcode = 'P0001';
  end if;
  if ride.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if not (public.is_admin() or (ride.passenger_id = uid and ride.status in ('REQUESTED', 'ACCEPTED', 'ARRIVED'))) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  update public.rides set status = 'CANCELLED', cancelled_at = now(), cancelled_by = uid, cancel_reason = left(p_reason, 300)
  where id = p_ride_id returning * into ride;
  if ride.fare_held > 0 then
    update public.ledger_accounts set held = held - ride.fare_held where owner = ride.passenger_id;
    update public.rides set fare_held = 0 where id = p_ride_id returning * into ride;
  end if;
  perform public.log_ride_event(ride.id, 'cancelled');
  return ride;
end;
$$;

create or replace function public.complete_trip(p_ride_id uuid) returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ride public.rides;
  rate numeric;
  fee numeric;
begin
  select * into ride from public.driver_transition(p_ride_id, 'IN_PROGRESS', 'COMPLETED', 'completed');
  select commission_rate into rate from public.platform_settings where id;
  fee := round(ride.fare * rate, 2);
  update public.rides set platform_fee = fee, driver_payout = ride.fare - fee
  where id = p_ride_id returning * into ride;

  -- Money moves. The platform fee is always taken from the driver's wallet: for a wallet ride the driver was just paid
  -- the full fare, for a cash ride the driver collected it in hand and now owes the fee.
  if ride.payment_method = 'wallet' then
    update public.ledger_accounts set held = held - ride.fare_held where owner = ride.passenger_id;
    perform public.post_transfer(public.ledger_account(ride.passenger_id), public.ledger_account(ride.driver_id), ride.fare, 'ride_payment', ride.id);
    update public.rides set fare_held = 0 where id = p_ride_id returning * into ride;
  end if;
  if fee > 0 then
    perform public.post_transfer(public.ledger_account(ride.driver_id), public.platform_account(), fee, 'commission', ride.id);
  end if;
  return ride;
end;
$$;

-- ---------- privileges ----------
revoke all on function
  public.ledger_account(uuid), public.platform_account(), public.external_account(),
  public.post_transfer(uuid, uuid, numeric, text, uuid, text), public.driver_debt_ok(uuid),
  public.my_wallet(), public.create_topup(numeric), public.complete_topup(uuid, text, text), public.fail_topup(uuid),
  public.request_withdrawal(numeric), public.admin_resolve_withdrawal(uuid, text), public.admin_finance_summary(), public.admin_record_payment(uuid, numeric, text),
  public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric, text)
from public, anon, authenticated;

grant execute on function
  public.my_wallet(), public.create_topup(numeric), public.request_withdrawal(numeric),
  public.admin_resolve_withdrawal(uuid, text), public.admin_finance_summary(), public.admin_record_payment(uuid, numeric, text),
  public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric, text)
to authenticated;

-- the payment gateway webhook runs with the service role
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.complete_topup(uuid, text, text), public.fail_topup(uuid) to service_role;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ledger_accounts;
    alter publication supabase_realtime add table public.withdrawals;
  end if;
end $$;
