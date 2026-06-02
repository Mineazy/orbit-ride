-- Supabase Database Schema for OrbitRide

-- 1. Create Drivers Table
CREATE TABLE IF NOT EXISTS public.drivers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    car TEXT NOT NULL,
    rating DOUBLE PRECISION DEFAULT 5.0,
    status TEXT NOT NULL DEFAULT 'OFFLINE', -- OFFLINE, ONLINE_IDLE, EN_ROUTE_PICKUP, EN_ROUTE_DROPOFF
    coords DOUBLE PRECISION[] NOT NULL, -- [latitude, longitude]
    earnings DOUBLE PRECISION DEFAULT 0.0,
    tier TEXT NOT NULL, -- OrbitX, OrbitXL, OrbitFly
    active_ride_id TEXT,
    avatar TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create Passenger Client Table (For active user and simulated bots)
CREATE TABLE IF NOT EXISTS public.passenger_client (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    coords DOUBLE PRECISION[] NOT NULL, -- [latitude, longitude]
    active_ride_id TEXT,
    rating DOUBLE PRECISION DEFAULT 5.0,
    balance DOUBLE PRECISION DEFAULT 500.0,
    avatar TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create Rides Table
CREATE TABLE IF NOT EXISTS public.rides (
    id TEXT PRIMARY KEY,
    passenger_id TEXT NOT NULL,
    passenger_name TEXT NOT NULL,
    passenger_avatar TEXT,
    driver_id TEXT,
    pickup_name TEXT NOT NULL,
    dropoff_name TEXT NOT NULL,
    pickup_coords DOUBLE PRECISION[] NOT NULL,
    dropoff_coords DOUBLE PRECISION[] NOT NULL,
    distance DOUBLE PRECISION NOT NULL,
    fare DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED', -- REQUESTED, ACCEPTED, ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED
    tier TEXT NOT NULL,
    route_points DOUBLE PRECISION[][], -- Multi-dimensional array representing grid waypoints
    current_route_index INTEGER DEFAULT 0,
    timestamp BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create Operations Logs Table
CREATE TABLE IF NOT EXISTS public.logs (
    id DOUBLE PRECISION PRIMARY KEY,
    time TEXT NOT NULL,
    text TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info', -- info, success, warning, driver, passenger, system
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Create System Metrics Table
CREATE TABLE IF NOT EXISTS public.metrics (
    id TEXT PRIMARY KEY DEFAULT 'global_metrics',
    total_trips INTEGER DEFAULT 32,
    total_revenue DOUBLE PRECISION DEFAULT 542.80,
    avg_rating DOUBLE PRECISION DEFAULT 4.91
);

-- ==========================================
-- SEED DATA (Initialize default drivers and passenger)
-- ==========================================

INSERT INTO public.drivers (id, name, car, rating, status, coords, earnings, tier, avatar)
VALUES 
('driver-1', 'Elena Rostova', 'Tesla Model Y (White)', 4.92, 'OFFLINE', ARRAY[37.7850, -122.4120], 124.50, 'OrbitXL', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.drivers (id, name, car, rating, status, coords, earnings, tier, avatar)
VALUES 
('driver-2', 'Alex Mercer', 'Toyota Camry (Silver)', 4.85, 'OFFLINE', ARRAY[37.7680, -122.4500], 85.00, 'OrbitX', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.drivers (id, name, car, rating, status, coords, earnings, tier, avatar)
VALUES 
('driver-3', 'Sarah Chen', 'Lucid Air (Nebula Blue)', 4.98, 'OFFLINE', ARRAY[37.8020, -122.4250], 210.00, 'OrbitFly', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.passenger_client (id, name, coords, rating, balance, avatar)
VALUES 
('passenger-client', 'Hanzu (You)', ARRAY[37.7876, -122.4075], 4.95, 500.00, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metrics (id, total_trips, total_revenue, avg_rating)
VALUES 
('global_metrics', 32, 542.80, 4.91)
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- ROW LEVEL SECURITY (RLS) & REPLICATION
-- ==========================================

-- Enable Row-Level Security on tables
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies for Anon/Public Access (Permit all operations for demonstration)
CREATE POLICY "Public Read Access" ON public.drivers FOR SELECT USING (true);
CREATE POLICY "Public Write Access" ON public.drivers FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Read Access" ON public.passenger_client FOR SELECT USING (true);
CREATE POLICY "Public Write Access" ON public.passenger_client FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Read Access" ON public.rides FOR SELECT USING (true);
CREATE POLICY "Public Write Access" ON public.rides FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Read Access" ON public.logs FOR SELECT USING (true);
CREATE POLICY "Public Write Access" ON public.logs FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Read Access" ON public.metrics FOR SELECT USING (true);
CREATE POLICY "Public Write Access" ON public.metrics FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime Replication on tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
ALTER PUBLICATION supabase_realtime ADD TABLE public.logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.passenger_client;
ALTER PUBLICATION supabase_realtime ADD TABLE public.metrics;
