// Row shapes returned by the production database (see supabase/migrations/20261015000000_foundation.sql)

export type UserRole = 'passenger' | 'driver' | 'admin';
export type Tier = 'OrbitX' | 'OrbitXL' | 'OrbitFly';
export type DriverApproval = 'pending' | 'approved' | 'rejected' | 'suspended';
export type PaymentMethod = 'cash' | 'wallet';
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
  payment_method: PaymentMethod;
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

export interface NearbyDriver {
  tier: Tier;
  lat: number;
  lng: number;
}

export interface WalletInfo {
  balance: number;
  held: number;
  available: number;
}

export interface LedgerEntry {
  id: number;
  amount: number;
  balance_after: number;
  kind: 'topup' | 'ride_payment' | 'commission' | 'withdrawal' | 'adjustment';
  ride_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Topup {
  id: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed';
  created_at: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  status: 'requested' | 'paid' | 'rejected';
  created_at: string;
}

export interface FinanceSummary {
  platform_earned: number;
  topped_up: number;
  paid_out: number;
  drivers_owe: number;
  owed_to_drivers: number;
  pending_withdrawals: number;
}

export const ACTIVE_STATUSES: RideStatus[] = ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];
