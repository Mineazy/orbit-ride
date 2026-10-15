import { getBackend } from './backend';
import type { DriverApproval, DriverProfile, NearbyDriver, Ride, Tier } from './types';

// Thin, typed wrappers over the server functions in supabase/migrations/20261015000000_foundation.sql.
// Each one throws the database error (use errorMessage() from ./errors to show it to a person).

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = await getBackend();
  const { data, error } = await client.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface RideRequest {
  pickupName: string;
  pickupLat: number;
  pickupLng: number;
  dropoffName: string;
  dropoffLat: number;
  dropoffLng: number;
  tier: Tier;
  distanceKm: number;
  /** Only send an offer when the passenger changed the suggested fare */
  offer?: number | null;
}

export const api = {
  // passenger
  requestRide: (r: RideRequest) =>
    rpc<Ride>('request_ride', {
      p_pickup_name: r.pickupName, p_pickup_lat: r.pickupLat, p_pickup_lng: r.pickupLng,
      p_dropoff_name: r.dropoffName, p_dropoff_lat: r.dropoffLat, p_dropoff_lng: r.dropoffLng,
      p_tier: r.tier, p_distance_km: Math.round(r.distanceKm * 100) / 100, p_offer: r.offer ?? null,
    }),
  cancelRide: (rideId: string, reason?: string) => rpc<Ride>('cancel_ride', { p_ride_id: rideId, p_reason: reason ?? null }),
  rateDriver: (rideId: string, stars: number) => rpc<Ride>('rate_driver', { p_ride_id: rideId, p_stars: stars }),

  nearbyDrivers: (lat: number, lng: number) => rpc<NearbyDriver[]>('nearby_drivers', { p_lat: lat, p_lng: lng }),

  // driver
  registerDriver: (vehicle: string, plate: string, tier: Tier) =>
    rpc<DriverProfile>('register_driver', { p_vehicle: vehicle, p_plate: plate, p_tier: tier }),
  setOnline: (online: boolean) => rpc<DriverProfile>('set_driver_online', { p_online: online }),
  updateLocation: (lat: number, lng: number) => rpc<DriverProfile>('update_driver_location', { p_lat: lat, p_lng: lng }),
  acceptRide: (rideId: string) => rpc<Ride>('accept_ride', { p_ride_id: rideId }),
  markArrived: (rideId: string) => rpc<Ride>('mark_arrived', { p_ride_id: rideId }),
  startTrip: (rideId: string) => rpc<Ride>('start_trip', { p_ride_id: rideId }),
  completeTrip: (rideId: string) => rpc<Ride>('complete_trip', { p_ride_id: rideId }),
  releaseRide: (rideId: string) => rpc<Ride>('release_ride', { p_ride_id: rideId }),

  // admin
  setApproval: (driverId: string, approval: DriverApproval) =>
    rpc<DriverProfile>('admin_set_driver_approval', { p_driver: driverId, p_approval: approval }),
};
