// Signed route distances.
//
// The server (the `route` edge function) measures the street distance of a trip and signs it with a secret that only the
// server and the database know. request_ride accepts a distance only with a valid, unexpired signature that matches the
// user, the two points and the distance, so a modified app cannot make up a longer route.
//
// The signed text and the SQL function public.verify_route (supabase/migrations/20261020000000_signed_routes.sql) must
// build exactly the same string; tests/unit/route.test.mjs checks that the two agree.

export type LatLng = [number, number];

/** Coordinates are rounded to 5 decimals (about 1 m) everywhere before they are signed or stored */
export const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

const fixed = (n: number, digits: number): string => {
  const s = n.toFixed(digits);
  return s === '-0.00000' ? '0.00000' : s;
};

export const canonicalRoute = (uid: string, pickup: LatLng, dropoff: LatLng, distanceKm: number, exp: number): string =>
  [uid, fixed(pickup[0], 5), fixed(pickup[1], 5), fixed(dropoff[0], 5), fixed(dropoff[1], 5), fixed(distanceKm, 2), String(exp)].join('|');

const toHex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export interface SignedRoute {
  distance_km: number;
  exp: number;
  sig: string;
}

export async function signRoute(secret: string, uid: string, pickup: LatLng, dropoff: LatLng, distanceKm: number, exp: number): Promise<SignedRoute> {
  const km = Math.round(distanceKm * 100) / 100;
  return { distance_km: km, exp, sig: await hmacHex(secret, canonicalRoute(uid, pickup, dropoff, km, exp)) };
}
