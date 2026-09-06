-- OrbitRide Supabase Schema
-- Requires Supabase Auth to be enabled

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

-- Enable RLS on all tables
alter table public.drivers enable row level security;
alter table public.passenger_client enable row level security;
alter table public.rides enable row level security;
alter table public.logs enable row level security;
alter table public.metrics enable row level security;
alter table public.profiles enable row level security;

-- Create RLS Policies for authenticated users only
-- SELECT policies: allow authenticated users to read
create policy "Authenticated users can read drivers"
    on public.drivers for select
    using (auth.role() = 'authenticated');

create policy "Authenticated users can read passenger client"
    on public.passenger_client for select
    using (auth.role() = 'authenticated');

create policy "Authenticated users can read rides"
    on public.rides for select
    using (auth.role() = 'authenticated');

create policy "Authenticated users can read logs"
    on public.logs for select
    using (auth.role() = 'authenticated');

create policy "Authenticated users can read metrics"
    on public.metrics for select
    using (auth.role() = 'authenticated');

create policy "Authenticated users can read profiles"
    on public.profiles for select
    using (auth.role() = 'authenticated');

-- INSERT policies: authenticated users can insert their own data
create policy "Authenticated users can insert rides"
    on public.rides for insert
    with check (auth.role() = 'authenticated' and passenger_id = auth.jwt() ->> 'sub');

create policy "Authenticated users can insert logs"
    on public.logs for insert
    with check (auth.role() = 'authenticated');

-- UPDATE policies: users can update their own records
create policy "Passengers can update own profile"
    on public.passenger_client for update
    using (auth.role() = 'authenticated' and id = (select auth.jwt() ->> 'sub'))
    with check (auth.role() = 'authenticated' and id = (select auth.jwt() ->> 'sub'));

create policy "Drivers can update own profile"
    on public.drivers for update
    using (auth.role() = 'authenticated' and profile_id = (select auth.jwt() ->> 'sub'))
    with check (auth.role() = 'authenticated' and profile_id = (select auth.jwt() ->> 'sub'));

create policy "Authenticated users can update metrics"
    on public.metrics for update
    using (auth.role() = 'authenticated' and id = 'global_metrics')
    with check (auth.role() = 'authenticated' and id = 'global_metrics');

create policy "Authenticated users can update own balance"
    on public.passenger_client for update
    using (auth.role() = 'authenticated' and id = (select auth.jwt() ->> 'sub'));

-- Service role bypass (for server-side operations from server.js)
create policy "Service role full access"
    on public.drivers for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- Note: In production, use the SUPABASE_SERVICE_ROLE_KEY on the server
-- to bypass RLS completely for admin operations.
-- The anon key used by the client will respect these policies.

-- ==========================================
-- REALTIME SUBSCRIPTION CONFIGURATION
-- ==========================================

alter publication supabase_realtime add table public.drivers;
alter publication supabase_realtime add table public.rides;
alter publication supabase_realtime add table public.logs;
alter publication supabase_realtime add table public.passenger_client;
alter publication supabase_realtime add table public.metrics;
alter publication supabase_realtime add table public.profiles;

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
