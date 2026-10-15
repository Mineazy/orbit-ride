-- Server-side routing: signed route distances
--
-- Until now the phone measured the street distance and the server only checked it was plausible (not shorter than
-- the straight line, not longer than max_route_factor times it). With signed routes the SERVER measures the distance
-- (the `route` edge function, supabase/functions/route) and signs it; request_ride then accepts only a distance carrying
-- a valid, unexpired signature for exactly that user and those two points. A modified app can no longer invent a distance.
--
-- Turn it on in this order (docs/server-routing.md):
--   1. deploy the `route` function with ROUTE_SIGNING_SECRET and ROADS_URL
--   2. store the same secret:  insert into public.server_secrets (name, value) values ('route_signing', '<the secret>');
--   3. update public.platform_settings set require_signed_routes = true;
-- Until step 3 the old plausibility check still applies, so nothing breaks while you set it up.
--
-- Run after 20261019000000_hardening.sql.

alter table public.platform_settings add column require_signed_routes boolean not null default false;

-- Secrets that only the database functions may read (no policies, no grants: not reachable through the API)
create table public.server_secrets (
  name text primary key,
  value text not null
);
alter table public.server_secrets enable row level security;
revoke all on public.server_secrets from public, anon, authenticated;

-- HMAC-SHA256 built from the standard sha256() so it needs no extension
create function public.hmac_sha256(p_key bytea, p_msg bytea) returns bytea
language plpgsql immutable as $$
declare
  k bytea := p_key;
  ipad bytea;
  opad bytea;
  i int;
begin
  if length(k) > 64 then
    k := sha256(k);
  end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k;
  opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);  -- 0x36
    opad := set_byte(opad, i, get_byte(k, i) # 92);  -- 0x5c
  end loop;
  return sha256(opad || sha256(ipad || p_msg));
end;
$$;

-- Must build exactly the text that supabase/functions/_shared/routeToken.ts signs: uid|lat|lng|lat|lng|km|exp
create function public.verify_route(
  p_uid uuid, p_plat double precision, p_plng double precision, p_dlat double precision, p_dlng double precision,
  p_km numeric, p_exp bigint, p_sig text
) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  secret text;
  msg text;
begin
  if p_sig is null or p_exp is null or p_km is null then
    return false;
  end if;
  if p_exp < extract(epoch from now()) then
    return false; -- expired
  end if;
  select value into secret from public.server_secrets where name = 'route_signing';
  if secret is null or length(secret) < 16 then
    return false;
  end if;
  msg := concat_ws('|', p_uid::text,
    round(p_plat::numeric, 5)::text, round(p_plng::numeric, 5)::text,
    round(p_dlat::numeric, 5)::text, round(p_dlng::numeric, 5)::text,
    round(p_km, 2)::text, p_exp::text);
  return encode(public.hmac_sha256(convert_to(secret, 'UTF8'), convert_to(msg, 'UTF8')), 'hex') = lower(p_sig);
end;
$$;

-- request_ride gains the signature parameters (and is otherwise unchanged)
drop function public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric, text);
create function public.request_ride(
  p_pickup_name text, p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_name text, p_dropoff_lat double precision, p_dropoff_lng double precision,
  p_tier public.vehicle_tier, p_distance_km numeric, p_offer numeric default null,
  p_payment_method text default 'cash', p_route_exp bigint default null, p_route_sig text default null
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
  if p_distance_km is null or p_distance_km < straight * 0.95 then
    raise exception 'invalid_distance' using errcode = 'P0001';
  end if;
  if st.require_signed_routes then
    -- the distance must be the one the server measured and signed for exactly this user and these two points
    if not public.verify_route(uid, p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_distance_km, p_route_exp, p_route_sig) then
      raise exception 'route_not_verified' using errcode = 'P0001';
    end if;
  elsif p_distance_km > greatest(straight * st.max_route_factor, straight + st.max_route_extra_km) then
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

revoke all on function public.hmac_sha256(bytea, bytea),
  public.verify_route(uuid, double precision, double precision, double precision, double precision, numeric, bigint, text),
  public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric, text, bigint, text)
from public, anon, authenticated;
grant execute on function
  public.request_ride(text, double precision, double precision, text, double precision, double precision, public.vehicle_tier, numeric, numeric, text, bigint, text)
to authenticated;
