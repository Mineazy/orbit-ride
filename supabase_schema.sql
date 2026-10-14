-- OrbitRide Supabase Schema
-- Requires Supabase Auth with anonymous sign-ins enabled (see the RLS section). Safe to re-run.

-- 1. Enable Auth extension
create extension if not exists "uuid-ossp";

-- 2. Profiles table (linked to auth users)
create table if not exists public.profiles (
    id uuid references auth.users on delete cascade primary key,
    full_name text,
    role text check (role in ('passenger', 'driver', 'admin')) default 'passenger',
    avatar text,
    created_at timestamptz default now() not null
);

-- 3. Drivers Table
create table if not exists public.drivers (
    id text primary key,
    name text not null,
    car text not null,
    rating double precision default 5.0,
    status text not null default 'OFFLINE' check (status in ('OFFLINE', 'ONLINE_IDLE', 'EN_ROUTE_PICKUP', 'EN_ROUTE_DROPOFF')),
    coords double precision[] not null,
    earnings double precision default 0.0,
    tier text not null check (tier in ('OrbitX', 'OrbitXL', 'OrbitFly')),
    active_ride_id text,
    avatar text,
    profile_id uuid references profiles(id) on delete set null,
    updated_at timestamptz default now() not null
);

-- 4. Passenger Client Table
create table if not exists public.passenger_client (
    id text primary key,
    name text not null,
    coords double precision[] not null,
    active_ride_id text,
    rating double precision default 5.0,
    balance double precision default 500.0 check (balance >= 0),
    avatar text,
    profile_id uuid references profiles(id) on delete set null,
    updated_at timestamptz default now() not null
);

-- 5. Rides Table
create table if not exists public.rides (
    id text primary key,
    passenger_id text not null references passenger_client(id) on delete cascade,
    passenger_name text not null,
    passenger_avatar text,
    driver_id text references drivers(id) on delete set null,
    pickup_name text not null,
    dropoff_name text not null,
    pickup_coords double precision[] not null,
    dropoff_coords double precision[] not null,
    distance double precision not null check (distance > 0),
    fare double precision not null check (fare > 0),
    status text not null default 'REQUESTED' check (status in ('REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    tier text not null check (tier in ('OrbitX', 'OrbitXL', 'OrbitFly')),
    route_points double precision[][],
    current_route_index integer default 0,
    timestamp bigint not null,
    updated_at timestamptz default now() not null
);

-- 6. Operations Logs Table
create table if not exists public.logs (
    id double precision primary key,
    time text not null,
    text text not null,
    type text not null default 'info' check (type in ('info', 'success', 'warning', 'driver', 'passenger', 'system')),
    created_at timestamptz default now() not null
);

-- 7. System Metrics Table
create table if not exists public.metrics (
    id text primary key default 'global_metrics',
    total_trips integer default 32 check (total_trips >= 0),
    total_revenue double precision default 542.80 check (total_revenue >= 0),
    avg_rating double precision default 4.91 check (avg_rating between 0 and 5)
);

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
--
-- Access model: the web/native clients sign in with Supabase ANONYMOUS auth
-- (Authentication > Providers > "Allow anonymous sign-ins" must be enabled).
-- Anonymous users get the `authenticated` role, so unauthenticated requests
-- (anon key only, no session) are rejected, while every simulation client can
-- read and update the shared simulation state.
--
-- This is deliberately NOT per-user security: the simulation has one shared
-- passenger row and a shared driver roster, so there is no user-owned data to
-- scope policies to. Do not reuse these policies for a product with real
-- accounts; tie rows to auth.uid() there.

-- Enable RLS on all tables
alter table public.drivers enable row level security;
alter table public.passenger_client enable row level security;
alter table public.rides enable row level security;
alter table public.logs enable row level security;
alter table public.metrics enable row level security;
alter table public.profiles enable row level security;

-- Drop any policies from earlier versions of this script so it can be re-run safely
drop policy if exists "Authenticated users can read drivers" on public.drivers;
drop policy if exists "Authenticated users can read passenger client" on public.passenger_client;
drop policy if exists "Authenticated users can read rides" on public.rides;
drop policy if exists "Authenticated users can read logs" on public.logs;
drop policy if exists "Authenticated users can read metrics" on public.metrics;
drop policy if exists "Authenticated users can read profiles" on public.profiles;
drop policy if exists "Authenticated users can insert rides" on public.rides;
drop policy if exists "Authenticated users can insert logs" on public.logs;
drop policy if exists "Passengers can update own profile" on public.passenger_client;
drop policy if exists "Drivers can update own profile" on public.drivers;
drop policy if exists "Authenticated users can update metrics" on public.metrics;
drop policy if exists "Authenticated users can update own balance" on public.passenger_client;
drop policy if exists "Service role full access" on public.drivers;
drop policy if exists "sim_select" on public.drivers;
drop policy if exists "sim_select" on public.passenger_client;
drop policy if exists "sim_select" on public.rides;
drop policy if exists "sim_select" on public.logs;
drop policy if exists "sim_select" on public.metrics;
drop policy if exists "sim_select" on public.profiles;
drop policy if exists "sim_insert" on public.drivers;
drop policy if exists "sim_insert" on public.rides;
drop policy if exists "sim_insert" on public.logs;
drop policy if exists "sim_update" on public.drivers;
drop policy if exists "sim_update" on public.passenger_client;
drop policy if exists "sim_update" on public.rides;
drop policy if exists "sim_update" on public.metrics;

-- SELECT: any signed-in (including anonymous) client can read simulation state
create policy "sim_select" on public.drivers          for select to authenticated using (true);
create policy "sim_select" on public.passenger_client for select to authenticated using (true);
create policy "sim_select" on public.rides            for select to authenticated using (true);
create policy "sim_select" on public.logs             for select to authenticated using (true);
create policy "sim_select" on public.metrics          for select to authenticated using (true);
-- Profiles hold real user data: each user may only read their own
create policy "sim_select" on public.profiles         for select to authenticated using (id = auth.uid());

-- INSERT: the app creates drivers (registerDriver), rides (requestRide) and log entries
create policy "sim_insert" on public.drivers for insert to authenticated with check (true);
create policy "sim_insert" on public.rides   for insert to authenticated with check (true);
create policy "sim_insert" on public.logs    for insert to authenticated with check (true);

-- UPDATE: ride lifecycle, driver status/position/earnings, passenger balance, global metrics
create policy "sim_update" on public.drivers          for update to authenticated using (true) with check (true);
create policy "sim_update" on public.passenger_client for update to authenticated using (true) with check (true);
create policy "sim_update" on public.rides            for update to authenticated using (true) with check (true);
create policy "sim_update" on public.metrics          for update to authenticated
    using (id = 'global_metrics') with check (id = 'global_metrics');

-- There are intentionally no DELETE policies, so clients cannot delete rows.
-- For admin/server-side work use the service role key, which bypasses RLS.
-- Never ship SUPABASE_SERVICE_ROLE_KEY in the client bundle.

-- ==========================================
-- REALTIME SUBSCRIPTION CONFIGURATION
-- ==========================================
-- (profiles is intentionally not published: it holds per-user data and the app doesn't subscribe to it)

do $$
declare t text;
begin
    foreach t in array array['drivers', 'rides', 'logs', 'passenger_client', 'metrics'] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;

-- ==========================================
-- SEED DATA
-- ==========================================

-- Insert seed profiles (must be done after auth users exist in production)
-- For development simulation, these work with the anonymous/local mode

-- Insert seed drivers
insert into public.drivers (id, name, car, rating, status, coords, earnings, tier, avatar)
values
    ('driver-1', 'Elena Rostova', 'Tesla Model Y (White)', 4.92, 'OFFLINE', array[-22.5720, 17.0810], 124.50, 'OrbitXL', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80'),
    ('driver-2', 'Alex Mercer', 'Toyota Camry (Silver)', 4.85, 'OFFLINE', array[-22.5900, 17.0750], 85.00, 'OrbitX', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80'),
    ('driver-3', 'Sarah Chen', 'Lucid Air (Nebula Blue)', 4.98, 'OFFLINE', array[-22.5500, 17.0650], 210.00, 'OrbitFly', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80')
on conflict (id) do nothing;

-- Insert seed passenger
insert into public.passenger_client (id, name, coords, rating, balance, avatar)
values
    ('passenger-client', 'Hanzu (You)', array[-22.5615, 17.0835], 4.95, 500.00, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80')
on conflict (id) do nothing;

-- Insert seed metrics
insert into public.metrics (id, total_trips, total_revenue, avg_rating)
values
    ('global_metrics', 32, 542.80, 4.91)
on conflict (id) do nothing;

-- Create function to get driver stats (utility function)
create or replace function public.get_driver_stats(p_driver_id text)
returns table (name text, rating double precision, earnings double precision, total_rides integer) as $$
begin
    return query
    select d.name, d.rating, d.earnings, count(r.id)::integer as total_rides
    from public.drivers d
    left join public.rides r on r.driver_id = d.id and r.status = 'COMPLETED'
    where d.id = p_driver_id
    group by d.name, d.rating, d.earnings;
end;
$$ language plpgsql security definer;

-- Create function to calculate fare (utility function)
create or replace function public.calculate_fare(
    p_base double precision,
    p_per_km double precision,
    p_distance double precision,
    p_surge double precision default 1.0,
    p_weather_factor double precision default 1.0
)
returns double precision as $$
begin
    return round((p_base + p_per_km * p_distance) * p_surge * p_weather_factor, 2);
end;
$$ language plpgsql immutable;
