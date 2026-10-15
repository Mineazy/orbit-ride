# Operations runbook

Short answers for the day something goes wrong. Keep this open during the first weeks.

## Where to look first

1. **Admin screen, App errors**: crashes the apps reported (last 30 days).
2. **Supabase dashboard, Logs**: API, Auth (SMS problems) and Postgres logs. **Reports** shows database size and slow queries.
3. **Render dashboard**: deploy status of the site. `https://your-site/health.json` returns `{"status":"ok"}` for an
   uptime monitor (UptimeRobot, Better Stack, anything that checks a URL every few minutes).

## Common problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nobody gets the sign-in text | SMS provider out of credit, or a rate limit | Check the provider balance, then Supabase Auth logs |
| "Something went wrong" screen in an app | A crash; it was reported | Admin, App errors; roll back the last deploy in Render if it started after one |
| Passengers see "could not confirm the distance" | The `route` function is down, the secrets differ, or `ROADS_URL` is wrong | Supabase, Edge Functions, `route`, Logs. Quick relief: `update public.platform_settings set require_signed_routes = false;` (see docs/server-routing.md) |
| Drivers see no requests | Driver position older than 5 minutes, or the pickup is farther than `dispatch_radius_km` | Check `driver_profiles.location_updated_at`; raise `dispatch_radius_km` if the city is spread out |
| A driver cannot go online ("you owe too much") | Cash fees over `driver_debt_limit` | Take the payment, then Admin, Drivers, **Record payment** |
| A passenger is stuck with a "live" ride | A driver vanished | Admin screen, Latest rides, **Cancel ride** (money held for it is released). Do not edit the rides table by hand: it skips that release |
| Wallet shows a wrong amount | Never edit balances directly. | Use **Record payment** with a negative or positive amount and a note; the ledger keeps the history |

## Changing settings (no deploy needed)

In the Supabase SQL editor:

```sql
-- surge (1.00 = none), commission, dispatch radius, debt limit
update public.platform_settings set surge_multiplier = 1.2, commission_rate = 0.15, dispatch_radius_km = 10, driver_debt_limit = 300;
-- tariffs
update public.fare_config set base_fare = 3.00, per_km = 0.90, min_fare = 6.00 where tier = 'OrbitX';
```

## Deploying a database change

1. Write a **new** migration file with the next date in `supabase/migrations/` (never edit one that has run).
2. Run `npm run test:db`. It runs every migration in order against a throwaway Postgres and checks the security rules.
3. Apply it to **staging**, try the apps, then to **production** (SQL editor or `supabase db push`).
4. Deploy the app change after the database change (apps tolerate a newer database; the reverse can break).

## Backups and recovery

- With Point-in-time recovery on, restore to a minute before the mistake from the Supabase dashboard (Database, Backups).
  This replaces the whole database, so tell people the service is paused first.
- Backups depend on your Supabase plan (check the current plan details). Free projects may have none, so **do not launch on a plan without backups**.
- Once a month, download a backup and try restoring it into the staging project. A backup you have never restored is a hope.
- The ledger cannot be edited by design. A wrong entry is fixed by a new, opposite entry (Record payment).

## Secrets

- Only two Supabase values go in the apps: the project URL and the **anon** key. Both are public by design.
- The **service-role** key bypasses all security. It lives only on the server that receives the payment gateway webhook,
  never in a `VITE_` variable (the build stops if it finds one), never in git.
- If a secret leaks: rotate it in the Supabase dashboard (Project settings, API), update the server, redeploy.
- The Google Maps key that was once committed to git history should be **revoked** in the Google Cloud console (the app
  no longer uses Google Maps).

## Incident basics

1. Stop the harm: pause a driver (Admin, **Suspend**), or cancel the ride.
2. Write down what happened, with times and ride ids (`select * from public.ride_events where ride_id = '...' order by created_at;`).
3. Contact the people involved; tell the police when it is a crime.
4. Fix the cause, add it to the checklist.
