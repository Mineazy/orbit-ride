-- Push notifications
--
--   device_tokens   one row per phone or browser that agreed to notifications (FCM token for Android and iOS apps,
--                   a Web Push subscription for browsers). Apps register through register_device().
--   push_outbox     a message waiting to be delivered. Database triggers fill it when something happens (a ride request
--                   near a driver, a driver accepting, arriving, a cancellation, an approval, a payout).
--   delivery        the `send-push` edge function (supabase/functions/send-push) reads the outbox and talks to Firebase
--                   Cloud Messaging and the browsers' push services. The trigger on push_outbox wakes it through pg_net
--                   as soon as a row is added; a periodic sweep retries failures. Setup: docs/push-notifications.md.
--
-- Nothing here can break a ride: every trigger swallows its own errors.
--
-- Run after 20261020000000_signed_routes.sql.

-- ---------- devices ----------
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  token text not null unique check (char_length(token) between 10 and 4000), -- FCM token, or the Web Push endpoint
  subscription jsonb, -- Web Push only: { endpoint, keys: { p256dh, auth } }
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index device_tokens_user on public.device_tokens (user_id);
alter table public.device_tokens enable row level security;
create policy device_tokens_read_own on public.device_tokens for select to authenticated using (user_id = auth.uid());

create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 300),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0
);
create index push_outbox_unsent on public.push_outbox (id) where sent_at is null;
alter table public.push_outbox enable row level security; -- no policies: only the server side reads it
revoke all on public.push_outbox from anon, authenticated;

-- ---------- registering a device ----------
create function public.register_device(p_platform text, p_token text, p_subscription jsonb default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_platform not in ('android', 'ios', 'web') or p_token is null or char_length(p_token) < 10 or char_length(p_token) > 4000 then
    raise exception 'invalid_device' using errcode = 'P0001';
  end if;
  if p_platform = 'web' and (p_subscription is null or p_subscription -> 'keys' ->> 'p256dh' is null or p_subscription -> 'keys' ->> 'auth' is null) then
    raise exception 'invalid_device' using errcode = 'P0001';
  end if;

  -- the same phone signing in as someone else takes the token over
  insert into public.device_tokens (user_id, platform, token, subscription)
  values (uid, p_platform, p_token, case when p_platform = 'web' then p_subscription end)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, subscription = excluded.subscription, last_seen_at = now();

  -- keep at most 10 devices per person (the 10 most recently seen)
  delete from public.device_tokens where user_id = uid and id not in (
    select id from public.device_tokens where user_id = uid order by last_seen_at desc limit 10
  );
end;
$$;

create function public.unregister_device(p_token text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.device_tokens where token = p_token and user_id = auth.uid()
$$;

-- ---------- queueing a message ----------
create function public.queue_push(p_user uuid, p_title text, p_body text, p_data jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.push_outbox (user_id, title, body, data) values (p_user, left(p_title, 120), left(p_body, 300), coalesce(p_data, '{}'::jsonb));
end;
$$;

-- Wake the sender as soon as a message is queued. Needs the pg_net extension and two secrets (docs/push-notifications.md);
-- without them messages simply wait in the outbox for the sweep.
create function public.push_outbox_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hook_url text;
  hook_secret text;
begin
  select value into hook_url from public.server_secrets where name = 'push_webhook_url';
  select value into hook_secret from public.server_secrets where name = 'push_webhook_secret';
  if hook_url is not null and hook_secret is not null and to_regnamespace('net') is not null then
    -- pg_net: net.http_post(url, body, params, headers, timeout) runs in the background
    perform net.http_post(
      url := hook_url,
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', hook_secret)
    );
  end if;
  return new;
exception when others then
  return new; -- never block the ride because a notification could not be sent
end;
$$;
create trigger push_outbox_wake after insert on public.push_outbox
  for each row execute function public.push_outbox_notify();

-- ---------- who gets told what ----------
-- Drivers who can take a ride: approved, online, right vehicle type, fresh position inside the dispatch radius, not on a ride
create function public.notify_nearby_drivers(p_ride public.rides, p_exclude uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record;
begin
  for d in
    select dp.id
    from public.driver_profiles dp, public.platform_settings s
    where dp.approval = 'approved' and dp.is_online and dp.tier = p_ride.tier and dp.id is distinct from p_exclude
      and dp.lat is not null and public.location_is_fresh(dp.location_updated_at)
      and public.km_between(dp.lat, dp.lng, p_ride.pickup_lat, p_ride.pickup_lng) <= s.dispatch_radius_km
      and not exists (select 1 from public.rides r where r.driver_id = dp.id and r.status in ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
    order by public.km_between(dp.lat, dp.lng, p_ride.pickup_lat, p_ride.pickup_lng)
    limit 10
  loop
    perform public.queue_push(d.id, 'New ride request', left(p_ride.pickup_name, 80) || ' to ' || left(p_ride.dropoff_name, 80),
      jsonb_build_object('type', 'ride_request', 'ride_id', p_ride.id));
  end loop;
end;
$$;

create function public.rides_push_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notify_nearby_drivers(new);
  exception when others then
    null;
  end;
  return new;
end;
$$;
create trigger rides_push_insert after insert on public.rides
  for each row execute function public.rides_push_insert();

create function public.rides_push_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who record;
  data jsonb := jsonb_build_object('ride_id', new.id);
begin
  begin
    if new.status = old.status and new.driver_id is not distinct from old.driver_id then
      return new;
    end if;

    if new.status = 'ACCEPTED' and old.status = 'REQUESTED' then
      select p.full_name, d.vehicle, d.plate into who
      from public.profiles p join public.driver_profiles d on d.id = p.id where p.id = new.driver_id;
      perform public.queue_push(new.passenger_id, 'Driver on the way',
        coalesce(nullif(who.full_name, ''), 'Your driver') || ' · ' || coalesce(who.vehicle, '') || ' ' || coalesce(who.plate, ''),
        data || '{"type":"ride_accepted"}');
    elsif new.status = 'ARRIVED' then
      perform public.queue_push(new.passenger_id, 'Your driver has arrived', 'Meet them at ' || left(new.pickup_name, 80),
        data || '{"type":"driver_arrived"}');
    elsif new.status = 'COMPLETED' then
      perform public.queue_push(new.passenger_id, 'You have arrived', 'Rate your trip. Fare N$' || to_char(new.fare, 'FM999990.00'),
        data || '{"type":"ride_completed"}');
    elsif new.status = 'REQUESTED' and old.status in ('ACCEPTED', 'ARRIVED') then
      -- the driver handed the ride back: tell the passenger, and offer it to other drivers
      perform public.queue_push(new.passenger_id, 'Looking for another driver', 'Your driver could not make it. We are finding you another one.',
        data || '{"type":"ride_released"}');
      perform public.notify_nearby_drivers(new, old.driver_id); -- not the driver who just gave it up
    elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
      -- tell whoever did not cancel it
      if old.driver_id is not null and new.cancelled_by is distinct from old.driver_id then
        perform public.queue_push(old.driver_id, 'Ride cancelled', 'The passenger cancelled the ride to ' || left(new.dropoff_name, 80) || '.',
          data || '{"type":"ride_cancelled"}');
      end if;
      if new.cancelled_by is distinct from new.passenger_id then
        perform public.queue_push(new.passenger_id, 'Ride cancelled', 'Your ride was cancelled.',
          data || '{"type":"ride_cancelled"}');
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
create trigger rides_push_update after update on public.rides
  for each row execute function public.rides_push_update();

create function public.driver_push_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.approval is distinct from old.approval then
      if new.approval = 'approved' then
        perform public.queue_push(new.id, 'You are approved', 'You can now go online and take rides.', '{"type":"driver_approved"}');
      elsif new.approval = 'rejected' then
        perform public.queue_push(new.id, 'Application not approved', 'Contact support if you think this is a mistake.', '{"type":"driver_rejected"}');
      elsif new.approval = 'suspended' and old.approval = 'approved' then
        perform public.queue_push(new.id, 'Account suspended', 'Contact support to find out why.', '{"type":"driver_suspended"}');
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
create trigger driver_push_update after update of approval on public.driver_profiles
  for each row execute function public.driver_push_update();

create function public.withdrawals_push_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status is distinct from old.status then
      if new.status = 'paid' then
        perform public.queue_push(new.user_id, 'Payout sent', 'N$' || to_char(new.amount, 'FM999990.00') || ' is on its way to your bank account.', '{"type":"payout_paid"}');
      elsif new.status = 'rejected' then
        perform public.queue_push(new.user_id, 'Payout not paid', 'Your payout request was not paid. The money is back in your wallet.', '{"type":"payout_rejected"}');
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
create trigger withdrawals_push_update after update of status on public.withdrawals
  for each row execute function public.withdrawals_push_update();

-- ---------- privileges ----------
revoke all on function
  public.register_device(text, text, jsonb), public.unregister_device(text), public.queue_push(uuid, text, text, jsonb),
  public.push_outbox_notify(), public.notify_nearby_drivers(public.rides, uuid), public.rides_push_insert(), public.rides_push_update(),
  public.driver_push_update(), public.withdrawals_push_update()
from public, anon, authenticated;
grant execute on function public.register_device(text, text, jsonb), public.unregister_device(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, update, delete on public.push_outbox to service_role;
    grant select, delete on public.device_tokens to service_role;
  end if;
end $$;
