// Server-side routing: street distance between two points, and the request handler that signs it.
// Pure logic with injected dependencies, so it runs under Deno (the edge function) and Node (the tests).

import { haversine, polylineLength, type RoadRouter } from './roadRouter.ts';
import { round5, signRoute, type LatLng } from './routeToken.ts';

/** A signed distance stays valid for this long (long enough to choose a ride type, short enough to be useless later) */
export const TOKEN_TTL_SECONDS = 600;

/** Used only when a point is too far from any mapped road to snap: a typical city detour over the straight line */
const FALLBACK_DETOUR = 1.3;

export interface RouteResult {
  km: number;
  source: 'roads' | 'estimate';
}

/**
 * Street distance in km. Never shorter than the straight line (pins can sit off the roads, and a snapped route
 * can undercut them). Falls back to an estimate when no street route exists.
 */
export function routeKm(router: RoadRouter | null, from: LatLng, to: LatLng): RouteResult {
  const straight = haversine(from, to) / 1000;
  const path = router?.route(from, to);
  if (path && path.length > 1) return { km: Math.max(polylineLength(path) / 1000, straight), source: 'roads' };
  return { km: straight * FALLBACK_DETOUR, source: 'estimate' };
}

export interface RouteDeps {
  secret: string | undefined;
  router: RoadRouter | null;
  /** current time in seconds since 1970 */
  now: () => number;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The user id (`sub`) from a Supabase access token. The platform has already verified the signature (verify_jwt). */
export function userFromAuthHeader(header: string | null): string | null {
  const token = header?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' && /^[0-9a-f-]{36}$/i.test(payload.sub) && payload.role === 'authenticated' ? payload.sub : null;
  } catch {
    return null;
  }
}

const isPoint = (p: unknown): p is LatLng =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

export async function handleRoute(req: Request, deps: RouteDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const uid = userFromAuthHeader(req.headers.get('Authorization'));
  if (!uid) return json(401, { error: 'not_signed_in' });
  if (!deps.secret) return json(500, { error: 'not_configured' });
  if (!deps.router) return json(503, { error: 'routing_unavailable' });

  let body: { pickup?: unknown; dropoff?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  if (!isPoint(body.pickup) || !isPoint(body.dropoff)) return json(400, { error: 'invalid_request' });

  const pickup: LatLng = [round5(body.pickup[0]), round5(body.pickup[1])];
  const dropoff: LatLng = [round5(body.dropoff[0]), round5(body.dropoff[1])];
  if (haversine(pickup, dropoff) < 50) return json(400, { error: 'same_location' });

  const { km, source } = routeKm(deps.router, pickup, dropoff);
  if (km > 500) return json(400, { error: 'invalid_distance' });
  const signed = await signRoute(deps.secret, uid, pickup, dropoff, km, deps.now() + TOKEN_TTL_SECONDS);
  return json(200, { ...signed, pickup, dropoff, source });
}
