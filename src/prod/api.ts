import { getBackend } from './backend';
import type { DriverApproval, DriverProfile, FinanceSummary, NearbyDriver, PaymentMethod, Ride, Tier, Topup, WalletInfo, Withdrawal } from './types';

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
  paymentMethod?: PaymentMethod;
}

export const api = {
  // passenger
  requestRide: (r: RideRequest) =>
    rpc<Ride>('request_ride', {
      p_pickup_name: r.pickupName, p_pickup_lat: r.pickupLat, p_pickup_lng: r.pickupLng,
      p_dropoff_name: r.dropoffName, p_dropoff_lat: r.dropoffLat, p_dropoff_lng: r.dropoffLng,
      p_tier: r.tier, p_distance_km: Math.round(r.distanceKm * 100) / 100, p_offer: r.offer ?? null,
      p_payment_method: r.paymentMethod ?? 'cash',
    }),
  cancelRide: (rideId: string, reason?: string) => rpc<Ride>('cancel_ride', { p_ride_id: rideId, p_reason: reason ?? null }),
  rateDriver: (rideId: string, stars: number) => rpc<Ride>('rate_driver', { p_ride_id: rideId, p_stars: stars }),

  nearbyDrivers: (lat: number, lng: number) => rpc<NearbyDriver[]>('nearby_drivers', { p_lat: lat, p_lng: lng }),

  // wallet (the `num()` helper in ./ui converts the numeric strings the database returns)
  myWallet: () => rpc<{ balance: number | string; held: number | string; available: number | string }>('my_wallet').then(w => ({
    balance: Number(w.balance), held: Number(w.held), available: Number(w.available),
  }) as WalletInfo),
  createTopup: (amount: number) => rpc<Topup>('create_topup', { p_amount: amount }),
  /** Local test backend only: stands in for the payment gateway confirming the money arrived */
  devCompleteTopup: (topupId: string) => rpc<Topup>('dev_complete_topup', { p_topup_id: topupId }),
  requestWithdrawal: (amount: number) => rpc<Withdrawal>('request_withdrawal', { p_amount: amount }),

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

  // account
  deleteAccount: () => rpc<void>('delete_my_account'),

  // admin
  resolveWithdrawal: (id: string, status: 'paid' | 'rejected') => rpc<Withdrawal>('admin_resolve_withdrawal', { p_id: id, p_status: status }),
  recordPayment: (driverId: string, amount: number, note: string) => rpc<void>('admin_record_payment', { p_driver: driverId, p_amount: amount, p_note: note }),
  financeSummary: () => rpc<Record<string, number | string>>('admin_finance_summary').then(r => ({
    platform_earned: Number(r.platform_earned), topped_up: Number(r.topped_up), paid_out: Number(r.paid_out),
    drivers_owe: Number(r.drivers_owe), owed_to_drivers: Number(r.owed_to_drivers), pending_withdrawals: Number(r.pending_withdrawals),
  }) as FinanceSummary),
  setApproval: (driverId: string, approval: DriverApproval) =>
    rpc<DriverProfile>('admin_set_driver_approval', { p_driver: driverId, p_approval: approval }),
};
