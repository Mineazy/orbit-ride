-- OrbitRide production foundation
--
-- Replaces the demo schema (supabase_schema.sql, which lets any anonymous session edit everything)
-- with real accounts, per-user security and a server-run ride lifecycle:
--
--   * Users sign in (phone OTP) and get a profile with a role: passenger, driver or admin.
--   * Drivers register a vehicle and must be approved by an admin before they can go online.
--   * Clients can only READ the rows they are allowed to see. They cannot insert, update or delete
--     rides directly. Every state change goes through a SECURITY DEFINER function below, which checks
--     who is calling, validates the transition and computes fares and payouts on the server.
--
-- Payments in this version are cash only: the driver collects the fare and the platform fee is recorded.
-- Run with: supabase db push   (or paste into the SQL editor). See docs/production-roadmap.md.

-- ============================================================
-- Types
-- ============================================================
create type public.user_role as enum ('passenger', 'driver', 'admin');
create type public.driver_approval as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.vehicle_tier as enum ('OrbitX', 'OrbitXL', 'OrbitFly');
create type public.ride_status as enum ('REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- ============================================================
-- Tables
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'passenger',
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text unique,
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2000),
  created_at timestamptz not null default now()
);

create table public.driver_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  vehicle text not null check (char_length(vehicle) between 3 and 80),
  plate text not null check (char_length(plate) between 3 and 12),
  tier public.vehicle_tier not null,
  approval public.driver_approval not null default 'pending',
  is_online boolean not null default false,
  rating_sum integer not null default 0,
  rating_count integer not null default 0,
  rating numeric(3, 2) generated always as (
    case when rating_count = 0 then null else round(rating_sum::numeric / rating_count, 2) end
  ) stored,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  location_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.fare_config (
  tier public.vehicle_tier primary key,
  base_fare numeric(8, 2) not null check (base_fare >= 0),
  per_km numeric(8, 2) not null check (per_km >= 0),
  min_fare numeric(8, 2) not null default 0 check (min_fare >= 0)
);

create table public.platform_settings (
  id boolean primary key default true check (id), -- single row
  surge_multiplier numeric(3, 2) not null default 1.00 check (surge_multiplier between 1 and 5),
  commission_rate numeric(4, 3) not null default 0.200 check (commission_rate between 0 and 0.5),
  offer_min_factor numeric(3, 2) not null default 0.80 check (offer_min_factor between 0.1 and 1),
  offer_max_factor numeric(3, 2) not null default 2.00 check (offer_max_factor between 1 and 10)
);

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id),
  driver_id uuid references public.profiles (id),
  tier public.vehicle_tier not null,
  status public.ride_status not null default 'REQUESTED',
  pickup_name text not null check (char_length(pickup_name) between 1 and 200),
  dropoff_name text not null check (char_length(dropoff_name) between 1 and 200),
  pickup_lat double precision not null check (pickup_lat between -90 and 90),
  pickup_lng double precision not null check (pickup_lng between -180 and 180),
  dropoff_lat double precision not null check (dropoff_lat between -90 and 90),
  dropoff_lng double precision not null check (dropoff_lng between -180 and 180),
  distance_km numeric(7, 2) not null check (distance_km > 0 and distance_km <= 500),
  suggested_fare numeric(8, 2) not null check (suggested_fare > 0),
  fare numeric(8, 2) not null check (fare > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash')),
  platform_fee numeric(8, 2),
  driver_payout numeric(8, 2),
  passenger_rating smallint check (passenger_rating between 1 and 5), -- the passenger's rating of the driver
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  check (passenger_id <> driver_id)
);

-- One live ride per passenger and per driver; also makes concurrent accepts safe
create unique index rides_one_active_per_passenger on public.rides (passenger_id)
  where status in ('REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS');
create unique index rides_one_active_per_driver on public.rides (driver_id)
  where driver_id is not null and status in ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS');
create index rides_open_by_tier on public.rides (tier) where status = 'REQUESTED';
create index rides_by_passenger on public.rides (passenger_id, requested_at desc);
create index rides_by_driver on public.rides (driver_id, requested_at desc);

create table public.ride_events (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  event text not null,
  created_at timestamptz not null default now()
);
create index ride_events_by_ride on public.ride_events (ride_id, id);

insert into public.fare_config (tier, base_fare, per_km, min_fare) values
  ('OrbitX', 2.50, 0.75, 5.00),
  ('OrbitXL', 5.00, 1.25, 8.00),
  ('OrbitFly', 10.00, 2.15, 15.00);
insert into public.platform_settings (id) values (true);

-- ============================================================
-- Helpers (SECURITY DEFINER so policies can use them without recursion)
-- ============================================================
create function public.app_role() returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

-- Is p_uid the passenger or driver on a ride that involves the caller?
create function public.is_counterparty(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.rides r
    where r.status in ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED')
      and ((r.passenger_id = p_uid and r.driver_id = auth.uid())
        or (r.driver_id = p_uid and r.passenger_id = auth.uid()))
  )
$$;

-- May the caller see open requests for this tier? (approved, online driver of that tier)
create function public.driver_can_offer(p_tier public.vehicle_tier) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.driver_profiles d
    where d.id = auth.uid() and d.approval = 'approved' and d.is_online and d.tier = p_tier
  )
$$;

create function public.can_view_ride(p_ride uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.rides r
    where r.id = p_ride and (r.passenger_id = auth.uid() or r.driver_id = auth.uid())
  ) or public.is_admin()
$$;

create function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371.0 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ))
$$;

-- ============================================================
-- Sign-up: every auth user gets a profile. The role is chosen at sign-up but can only ever be
-- passenger or driver; admins are created by hand (see the roadmap doc).
-- ============================================================
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    case when requested = 'driver' then 'driver'::public.user_role else 'passenger'::public.user_role end,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    nullif(new.phone, '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their own name/avatar but never their role, phone or id
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.id is distinct from old.id or new.role is distinct from old.role or new.phone is distinct from old.phone then
      raise exception 'forbidden_field' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update before update on public.profiles
  for each row execute function public.profiles_guard();

-- ============================================================
-- Row level security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.fare_config enable row level security;
alter table public.platform_settings enable row level security;
alter table public.rides enable row level security;
alter table public.ride_events enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_read_counterparty on public.profiles for select to authenticated using (public.is_counterparty(id));
create policy profiles_read_admin on public.profiles for select to authenticated using (public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy drivers_read_own on public.driver_profiles for select to authenticated using (id = auth.uid());
create policy drivers_read_counterparty on public.driver_profiles for select to authenticated using (public.is_counterparty(id));
create policy drivers_read_admin on public.driver_profiles for select to authenticated using (public.is_admin());

create policy fare_config_read on public.fare_config for select to authenticated using (true);
create policy fare_config_admin on public.fare_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy settings_read on public.platform_settings for select to authenticated using (true);
create policy settings_admin on public.platform_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy rides_read_participant on public.rides for select to authenticated
  using (passenger_id = auth.uid() or driver_id = auth.uid());
create policy rides_read_open_offers on public.rides for select to authenticated
  using (status = 'REQUESTED' and public.driver_can_offer(tier));
create policy rides_read_admin on public.rides for select to authenticated using (public.is_admin());

create policy ride_events_read on public.ride_events for select to authenticated using (public.can_view_ride(ride_id));

-- Privileges: nothing for anon; authenticated may only read (and edit their own name/avatar).
-- Rides, drivers and events can only be changed through the functions below.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant update, insert, delete on public.fare_config, public.platform_settings to authenticated; -- RLS limits these to admins

-- ============================================================
-- Ride lifecycle (all state changes happen here)
-- ============================================================
create function public.log_ride_event(p_ride uuid, p_event text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.ride_events (ride_id, actor_id, event) values (p_ride, auth.uid(), p_event)
$$;

create function public.request_ride(
  p_pickup_name text, p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_name text, p_dropoff_lat double precision, p_dropoff_lng double precision,
  p_tier public.vehicle_tier, p_distance_km numeric, p_offer numeric default null
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
begin
  if uid is null or public.app_role() is distinct from 'passenger' then
    raise exception 'not_a_passenger' using errcode = 'P0001';
  end if;
  if p_pickup_lat not between -90 and 90 or p_dropoff_lat not between -90 and 90
     or p_pickup_lng not between -180 and 180 or p_dropoff_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = 'P0001';
  end if;

  straight := public.km_between(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  if straight < 0.05 then
    raise exception 'same_location' using errcode = 'P0001';
  end if;
  -- the client measures the street distance; the server only accepts a plausible one
  if p_distance_km is null or p_distance_km < straight * 0.95 or p_distance_km > greatest(straight * 4, straight + 3) then
    raise exception 'invalid_distance' using errcode = 'P0001';
  end if;

  select * into cfg from public.fare_config where tier = p_tier;
  select * into st from public.platform_settings where id;
  suggested := greatest(cfg.min_fare, round(((cfg.base_fare + cfg.per_km * p_distance_km) * st.surge_multiplier)::numeric, 2));

  if p_offer is null then
    final_fare := suggested;
  else
    if p_offer < suggested * st.offer_min_factor or p_offer > suggested * st.offer_max_factor then
      raise exception 'offer_out_of_range' using errcode = 'P0001';
    end if;
    final_fare := round(p_offer, 2);
  end if;

  begin
    insert into public.rides (
      passenger_id, tier, pickup_name, dropoff_name, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      distance_km, suggested_fare, fare
    ) values (
      uid, p_tier, left(trim(p_pickup_name), 200), left(trim(p_dropoff_name), 200),
      p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, round(p_distance_km, 2), suggested, final_fare
    ) returning * into ride;
  exception when unique_violation then
    raise exception 'active_ride_exists' using errcode = 'P0001';
  end;

  perform public.log_ride_event(ride.id, 'requested');
  return ride;
end;
$$;

create function public.accept_ride(p_ride_id uuid) returns public.rides
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

  select * into ride from public.rides where id = p_ride_id for update; -- serialises concurrent accepts
  if not found or ride.status <> 'REQUESTED' or ride.driver_id is not null then
    raise exception 'ride_unavailable' using errcode = 'P0001';
  end if;
  if ride.tier <> drv.tier then
    raise exception 'wrong_tier' using errcode = 'P0001';
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

-- Shared driver-side transition: ride must belong to the caller and be in p_from
create function public.driver_transition(p_ride_id uuid, p_from public.ride_status, p_to public.ride_status, p_event text)
returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ride public.rides;
begin
  select * into ride from public.rides where id = p_ride_id for update;
  if not found or ride.driver_id is distinct from auth.uid() then
    raise exception 'not_your_ride' using errcode = 'P0001';
  end if;
  if ride.status <> p_from then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.rides set
    status = p_to,
    arrived_at = case when p_to = 'ARRIVED' then now() else arrived_at end,
    started_at = case when p_to = 'IN_PROGRESS' then now() else started_at end,
    completed_at = case when p_to = 'COMPLETED' then now() else completed_at end
  where id = p_ride_id returning * into ride;

  perform public.log_ride_event(ride.id, p_event);
  return ride;
end;
$$;

create function public.mark_arrived(p_ride_id uuid) returns public.rides
language sql security definer set search_path = public, pg_temp as $$
  select * from public.driver_transition(p_ride_id, 'ACCEPTED', 'ARRIVED', 'arrived')
$$;

create function public.start_trip(p_ride_id uuid) returns public.rides
language sql security definer set search_path = public, pg_temp as $$
  select * from public.driver_transition(p_ride_id, 'ARRIVED', 'IN_PROGRESS', 'started')
$$;

create function public.complete_trip(p_ride_id uuid) returns public.rides
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
  return ride;
end;
$$;

-- Passenger (before the trip starts) or an admin (any live ride) cancels
create function public.cancel_ride(p_ride_id uuid, p_reason text default null) returns public.rides
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
  perform public.log_ride_event(ride.id, 'cancelled');
  return ride;
end;
$$;

-- A driver who can no longer do the job hands it back to the pool instead of cancelling the passenger
create function public.release_ride(p_ride_id uuid) returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ride public.rides;
begin
  select * into ride from public.rides where id = p_ride_id for update;
  if not found or ride.driver_id is distinct from auth.uid() then
    raise exception 'not_your_ride' using errcode = 'P0001';
  end if;
  if ride.status not in ('ACCEPTED', 'ARRIVED') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.rides set driver_id = null, status = 'REQUESTED', accepted_at = null, arrived_at = null
  where id = p_ride_id returning * into ride;
  perform public.log_ride_event(ride.id, 'released');
  return ride;
end;
$$;

create function public.rate_driver(p_ride_id uuid, p_stars integer) returns public.rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ride public.rides;
begin
  if p_stars not between 1 and 5 then
    raise exception 'invalid_rating' using errcode = 'P0001';
  end if;
  select * into ride from public.rides where id = p_ride_id for update;
  if not found or ride.passenger_id is distinct from auth.uid() then
    raise exception 'not_your_ride' using errcode = 'P0001';
  end if;
  if ride.status <> 'COMPLETED' or ride.passenger_rating is not null then
    raise exception 'cannot_rate' using errcode = 'P0001';
  end if;

  update public.rides set passenger_rating = p_stars where id = p_ride_id returning * into ride;
  update public.driver_profiles set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1
  where id = ride.driver_id;
  perform public.log_ride_event(ride.id, 'rated');
  return ride;
end;
$$;

-- ============================================================
-- Drivers
-- ============================================================
create function public.register_driver(p_vehicle text, p_plate text, p_tier public.vehicle_tier)
returns public.driver_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.driver_profiles;
begin
  if public.app_role() is distinct from 'driver' then
    raise exception 'not_a_driver' using errcode = 'P0001';
  end if;
  insert into public.driver_profiles (id, vehicle, plate, tier)
  values (auth.uid(), trim(p_vehicle), upper(trim(p_plate)), p_tier)
  on conflict (id) do update set vehicle = excluded.vehicle, plate = excluded.plate, tier = excluded.tier,
    -- changing the vehicle sends an approved driver back for review
    approval = case when public.driver_profiles.approval = 'approved' then 'pending' else public.driver_profiles.approval end,
    is_online = false
  returning * into d;
  return d;
end;
$$;

create function public.set_driver_online(p_online boolean) returns public.driver_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.driver_profiles;
begin
  select * into d from public.driver_profiles where id = auth.uid() for update;
  if not found or d.approval <> 'approved' then
    raise exception 'driver_not_approved' using errcode = 'P0001';
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

create function public.update_driver_location(p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = 'P0001';
  end if;
  update public.driver_profiles set lat = p_lat, lng = p_lng, location_updated_at = now() where id = auth.uid();
  if not found then
    raise exception 'not_a_driver' using errcode = 'P0001';
  end if;
end;
$$;

create function public.admin_set_driver_approval(p_driver uuid, p_approval public.driver_approval)
returns public.driver_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.driver_profiles;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  update public.driver_profiles set approval = p_approval, is_online = case when p_approval = 'approved' then is_online else false end
  where id = p_driver returning * into d;
  if not found then
    raise exception 'driver_not_found' using errcode = 'P0001';
  end if;
  return d;
end;
$$;

-- Passengers may know how many drivers are available per tier, never who or where they are
create function public.available_driver_counts() returns table (tier public.vehicle_tier, online_count integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.tier, count(d.id)::integer
  from (select unnest(enum_range(null::public.vehicle_tier)) as tier) t
  left join public.driver_profiles d
    on d.tier = t.tier and d.approval = 'approved' and d.is_online
    and not exists (
      select 1 from public.rides r
      where r.driver_id = d.id and r.status in ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS')
    )
  group by t.tier
  order by t.tier
$$;

-- ============================================================
-- Function privileges: only signed-in users may call the public API
-- ============================================================
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric),
  public.accept_ride(uuid),
  public.mark_arrived(uuid),
  public.start_trip(uuid),
  public.complete_trip(uuid),
  public.cancel_ride(uuid, text),
  public.release_ride(uuid),
  public.rate_driver(uuid, integer),
  public.register_driver(text, text, public.vehicle_tier),
  public.set_driver_online(boolean),
  public.update_driver_location(double precision, double precision),
  public.admin_set_driver_approval(uuid, public.driver_approval),
  public.available_driver_counts(),
  -- used inside row level security policies, which run as the calling user
  public.app_role(), public.is_admin(), public.is_counterparty(uuid), public.driver_can_offer(public.vehicle_tier),
  public.can_view_ride(uuid), public.km_between(double precision, double precision, double precision, double precision)
to authenticated;

-- ============================================================
-- Realtime (rides and driver availability; row level security applies to what each client receives)
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rides;
    alter publication supabase_realtime add table public.driver_profiles;
  end if;
end $$;
