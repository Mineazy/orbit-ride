// Row shapes returned by the production database (see supabase/migrations/20261015000000_foundation.sql)

export type UserRole = 'passenger' | 'driver' | 'admin';
export type Tier = 'OrbitX' | 'OrbitXL' | 'OrbitFly';
export type DriverApproval = 'pending' | 'approved' | 'rejected' | 'suspended';
export type RideStatus = 'REQUESTED' | 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface DriverProfile {
  id: string;
  vehicle: string;
  plate: string;
  tier: Tier;
  approval: DriverApproval;
  is_online: boolean;
  rating: number | null; // null until the first rating
  rating_count: number;
  lat: number | null;
  lng: number | null;
  location_updated_at: string | null;
}

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  tier: Tier;
  status: RideStatus;
  pickup_name: string;
  dropoff_name: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number;
  suggested_fare: number;
  fare: number;
  payment_method: 'cash';
  platform_fee: number | null;
  driver_payout: number | null;
  passenger_rating: number | null;
  requested_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}

export interface TierCount {
  tier: Tier;
  online_count: number;
}

export const ACTIVE_STATUSES: RideStatus[] = ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];
