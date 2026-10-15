import { getRoadRouter, loadRoadRouter, polylineLength } from './roadRouter';

// Calculate distance between coordinates in km (Haversine formula)
export const calculateDistance = (coords1, coords2) => {
  const [lat1, lon1] = coords1;
  const [lat2, lon2] = coords2;
  const R = 6371.0; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const ROADS_URL = new URL(`${import.meta.env.BASE_URL}tiles/windhoek-roads.json`, window.location.href).href;

const distanceCache = new Map<string, number>();

/**
 * Driving distance in km along streets (what fares are based on). Falls back to the straight-line
 * distance while the road graph is loading or when no street route exists. Never shorter than the
 * straight line, since a route between snapped road points can undercut pins that sit off the roads.
 */
export const routeDistance = (from, to): number => {
  const straight = calculateDistance(from, to);
  const router = getRoadRouter();
  if (!router) return straight;
  const key = `${from[0].toFixed(5)},${from[1].toFixed(5)}|${to[0].toFixed(5)},${to[1].toFixed(5)}`;
  let km = distanceCache.get(key);
  if (km === undefined) {
    const road = router.route(from, to);
    km = road && road.length > 1 ? polylineLength(road) / 1000 : straight;
    distanceCache.set(key, km);
  }
  return Math.max(km, straight);
};

/** Resolves once the road graph has loaded (or failed to), so callers can re-price with street distances. */
export const roadsReady = () => loadRoadRouter(ROADS_URL);

