// Edge function: POST /functions/v1/route  { pickup: [lat, lng], dropoff: [lat, lng] }
//   -> { distance_km, exp, sig, pickup, dropoff, source }
//
// Measures the street distance on the server and signs it for request_ride (see _shared/routeToken.ts).
//
// Deploy:   supabase functions deploy route
// Secrets:  supabase secrets set ROUTE_SIGNING_SECRET=<long random string> ROADS_URL=https://your-site/tiles/windhoek-roads.json
// The SAME secret must be stored in the database: see docs/server-routing.md.
// JWT verification stays ON (the default): only signed-in users can call it.

import { loadRoadRouter } from '../_shared/roadRouter.ts';
import { handleRoute } from '../_shared/routeService.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // the road graph is fetched once per server instance, then kept in memory
  const url = Deno.env.get('ROADS_URL');
  const router = url ? await loadRoadRouter(url) : null;

  const res = await handleRoute(req, {
    secret: Deno.env.get('ROUTE_SIGNING_SECRET'),
    router,
    now: () => Math.floor(Date.now() / 1000),
  });
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
