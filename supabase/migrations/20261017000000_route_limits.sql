-- Milestone 4: tighter route-distance check
--
-- The apps measure the street distance with the road router and send it with the request. The server cannot yet
-- recompute a route itself, so it only accepts a plausible number: not shorter than the straight line, and not longer
-- than max(straight * max_route_factor, straight + max_route_extra_km). Both limits are admin settings.
-- (Foundation allowed up to 4x; real Windhoek street routes are usually 1.1x to 1.6x.)
--
-- Run after 20261016000000_live_dispatch.sql.

alter table public.platform_settings
  add column max_route_factor numeric(3, 1) not null default 2.5 check (max_route_factor between 1.5 and 6),
  add column max_route_extra_km numeric(4, 1) not null default 2 check (max_route_extra_km between 0 and 20);

create or replace function public.request_ride(
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
