import { getBackend } from './backend';
import { round5, type LatLng, type SignedRoute } from '../../supabase/functions/_shared/routeToken';

export interface ServerRoute extends SignedRoute {
  pickup: LatLng;
  dropoff: LatLng;
  source: 'roads' | 'estimate';
}

/**
 * Ask the server for the street distance between two points. The answer is signed: request_ride accepts only this
 * distance, for these (rounded) points, for this user, for a few minutes. Throws if the server cannot be reached.
 */
export async function fetchRoute(pickup: LatLng, dropoff: LatLng): Promise<ServerRoute> {
  const client = await getBackend();
  const body = { pickup: [round5(pickup[0]), round5(pickup[1])], dropoff: [round5(dropoff[0]), round5(dropoff[1])] };
  const { data, error } = await client.functions.invoke('route', { body });
  if (error || !data) throw error ?? new Error('route unavailable');
  return data as ServerRoute;
}
