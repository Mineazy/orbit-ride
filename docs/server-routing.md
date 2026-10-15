# Server-side routing

The street distance of a trip decides the fare. If the phone measured it alone, a modified app could send a longer
distance and overcharge, or a shorter one. With server-side routing **the server measures the distance and signs it**,
and the database only accepts a signed distance.

```
phone ──(pickup, dropoff)──▶ `route` edge function ──▶ { distance_km, exp, sig }
phone ──(same points, distance_km, exp, sig)──▶ request_ride ──▶ checks the signature, prices the ride itself
```

- The `route` function (`supabase/functions/route`) runs the same road router as the apps (`_shared/roadRouter.ts`) on
  the road graph for Windhoek, and signs `user | pickup | dropoff | distance | expiry` with HMAC-SHA256.
- `request_ride` re-builds that text and checks the signature with the secret stored in the database
  (`public.server_secrets`, unreadable through the API). A signature works only for that user, those two points (rounded
  to about 1 m), that distance, and for 10 minutes. It cannot be moved to another trip or reused later.
- The fare is still computed by the database from the verified distance, never taken from the phone.
- The signed text is built by `routeToken.ts` (TypeScript) and `verify_route` (SQL). A test signs with the TypeScript and
  verifies in Postgres, so the two cannot drift apart silently.

## Turn it on (about 15 minutes, once per Supabase project)

Do staging first. The order matters: nothing breaks while the old check still applies, until the last step.

1. **Make a secret.** Any long random string, at least 32 characters:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. **Publish the road graph** so the function can fetch it. It is `public/tiles/windhoek-roads.json`, already served by
   your site, for example `https://your-site/tiles/windhoek-roads.json`.
3. **Install the Supabase CLI** and log in (`supabase login`, then `supabase link --project-ref <your-ref>`).
4. **Set the function's secrets and deploy it:**
   ```bash
   supabase secrets set ROUTE_SIGNING_SECRET=<the secret> ROADS_URL=https://your-site/tiles/windhoek-roads.json
   supabase functions deploy route
   ```
   Leave "Verify JWT" on (the default): only signed-in users can call it.
5. **Check it works** from a browser console on your site while signed in, or with a signed-in user's token:
   `POST https://<ref>.supabase.co/functions/v1/route` with `{"pickup":[-22.5615,17.0835],"dropoff":[-22.612,17.0795]}`
   returns `distance_km`, `exp`, `sig` and `"source":"roads"`.
6. **Store the same secret in the database** (SQL editor):
   ```sql
   insert into public.server_secrets (name, value) values ('route_signing', '<the same secret>');
   ```
7. **Require signatures:**
   ```sql
   update public.platform_settings set require_signed_routes = true;
   ```
   From now on `request_ride` refuses any distance the server did not sign (`route_not_verified`).
   Release the app version that calls the function first: the production apps in this repository already do.
8. Request a ride from the app on staging. Then try the same with an old build: it must be refused.

## Changing the secret

Set the new value in both places (`supabase secrets set ...` and `update public.server_secrets set value = '...' where
name = 'route_signing';`). Rides requested in the few minutes between the two steps may be refused and retried by the app.

## Turning it off again

`update public.platform_settings set require_signed_routes = false;` returns to the older plausibility check
(not shorter than the straight line, not longer than `max_route_factor` times it).

## What happens when routing cannot find a road

If a pickup or dropoff is farther than about 800 m from any mapped road (or outside Windhoek), the function cannot
snap it to the street network, so it returns the straight-line distance times 1.3 and says `"source":"estimate"`.
Trips outside the city are therefore priced by estimate until you add that area's roads
(`npm run build:roads` and `npm run build:places` with a larger map extract).

## What this does and does not protect

- **Protected:** a modified app cannot invent a distance, reuse another trip's distance, or reuse an old one.
- **Not protected:** the server trusts the *points*. Someone could ask for a ride from A to B and then actually travel
  elsewhere with the driver; the fare would be for A to B. That is true of every ride-hailing app that prices before the
  trip. Track actual driven distance (driver GPS trace) if you later want to price on it.
- The router is the same one the apps used for the demo: roads treated as two-way, no turn restrictions, no live
  traffic. Distances are good for pricing a city, not for turn-by-turn navigation.

## Costs

The function fetches the road graph (about 0.7 MB) once per server instance, then answers from memory. Each fare
estimate is one function call (a few milliseconds of work). Supabase includes a large monthly allowance of function
calls; check your plan if you expect many thousands of price checks a day.
