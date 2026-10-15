-- Milestone 3: live driver location and proximity dispatch
--
--  * Drivers only see (and can only accept) open requests whose pickup is within the dispatch radius
--    of their last known position, and only while that position is fresh.
--  * Passengers can ask for anonymous positions of nearby available drivers (booking map and counts).
--  * Passengers can see how long ago their driver's position was updated through the existing
--    driver_profiles read policy (counterparty), so the app can show a moving car.
--
-- Run after 20261015000000_foundation.sql.

alter table public.platform_settings
  add column dispatch_radius_km numeric(5, 1) not null default 8 check (dispatch_radius_km between 1 and 100);

-- How old a position may be before the driver counts as "not nearby" (also used by the apps: 5 minutes)
create function public.location_is_fresh(p_at timestamptz) returns boolean
language sql stable as $$
  select p_at is not null and p_at > now() - interval '5 minutes'
$$;

-- May the calling driver take a request for this tier and pickup point?
create function public.driver_can_serve(p_tier public.vehicle_tier, p_lat double precision, p_lng double precision)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.driver_profiles d, public.platform_settings s
    where d.id = auth.uid()
      and d.approval = 'approved' and d.is_online and d.tier = p_tier
      and d.lat is not null and public.location_is_fresh(d.location_updated_at)
      and public.km_between(d.lat, d.lng, p_lat, p_lng) <= s.dispatch_radius_km
  )
$$;

drop policy rides_read_open_offers on public.rides;
create policy rides_read_open_offers on public.rides for select to authenticated
  using (status = 'REQUESTED' and public.driver_can_serve(tier, pickup_lat, pickup_lng));
drop function public.driver_can_offer(public.vehicle_tier);

-- Same rules as before, plus: the pickup must be within the dispatch radius of the driver
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

-- Anonymous positions (rounded to about 100 m, no ids) of available drivers near a point.
-- Available = approved, online, fresh position, within the dispatch radius, and not on a ride.
create function public.nearby_drivers(p_lat double precision, p_lng double precision)
returns table (tier public.vehicle_tier, lat double precision, lng double precision)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.tier, round(d.lat::numeric, 3)::double precision, round(d.lng::numeric, 3)::double precision
  from public.driver_profiles d, public.platform_settings s
  where auth.uid() is not null
    and p_lat between -90 and 90 and p_lng between -180 and 180
    and d.approval = 'approved' and d.is_online
    and d.lat is not null and public.location_is_fresh(d.location_updated_at)
    and public.km_between(d.lat, d.lng, p_lat, p_lng) <= s.dispatch_radius_km
    and not exists (
      select 1 from public.rides r
      where r.driver_id = d.id and r.status in ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS')
    )
  order by public.km_between(d.lat, d.lng, p_lat, p_lng)
  limit 40
$$;

-- Function privileges for the new functions
revoke all on function public.location_is_fresh(timestamptz), public.driver_can_serve(public.vehicle_tier, double precision, double precision),
  public.nearby_drivers(double precision, double precision) from public, anon, authenticated;
grant execute on function
  public.location_is_fresh(timestamptz),
  public.driver_can_serve(public.vehicle_tier, double precision, double precision), -- used inside a row level security policy
  public.nearby_drivers(double precision, double precision)
to authenticated;
