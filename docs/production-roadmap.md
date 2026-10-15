# Production roadmap

OrbitRide started as a simulation: the browser ran dispatch, vehicle movement, fares and payouts, and the
database trusted whatever a client wrote. This document tracks the move to a real service.

Decisions made: **Supabase** backend, **phone number + SMS code** sign-in, **cash-only** payments at launch.

## Status

| Milestone | State |
| --- | --- |
| 1. Secure foundation: accounts, roles, per-user security, server-run ride lifecycle | **Database done and tested** (`supabase/migrations`, `npm run test:db`). App not yet connected. |
| 2. Connect the apps: phone sign-in, driver registration and approval, rides through the server API, admin screen | **Built and tested on the local backend** (`npm run dev:prod`). Not yet run against a real Supabase project or SMS provider. |
| 3. Live driver GPS, push notifications, proximity dispatch | Not started |
| 4. Real address search and a production routing engine | Not started |
| 5. Wallet and a payment gateway (DPO / PayToday) with a ledger | Not started |
| 6. Hardening and launch: monitoring, staging, store releases, legal pages | Not started |

## What milestone 1 gives you

The migration `supabase/migrations/20261015000000_foundation.sql` replaces the demo schema.

- **Accounts.** Every sign-up gets a profile with a role (`passenger` or `driver`). Nobody can sign up as admin
  or change their own role or phone number.
- **Drivers** register a vehicle and stay `pending` until an admin approves them. Changing the vehicle sends
  an approved driver back for review. Only approved drivers can go online.
- **No trust in the client.** Clients can *read* the rows they are allowed to see and nothing else: no direct
  insert, update or delete on rides, drivers, events or fares. Every change goes through a server function:
  `request_ride`, `accept_ride`, `mark_arrived`, `start_trip`, `complete_trip`, `cancel_ride`, `release_ride`,
  `rate_driver`, `register_driver`, `set_driver_online`, `update_driver_location`,
  `admin_set_driver_approval`, `available_driver_counts`.
- **The server decides the numbers.** Fares come from `fare_config` and `platform_settings` (surge,
  commission), not from the browser. A passenger's offer must sit inside an allowed range. The platform fee and
  driver payout are computed when a trip completes. Ratings are averaged on the server and a ride can be rated once.
- **Safe concurrency.** Two drivers accepting the same request: one wins and the other gets `ride_unavailable`.
  A passenger and a driver can each have only one live ride.
- **Privacy.** A driver only sees open requests for their own tier while online. Passengers and drivers can see
  each other's name and vehicle only once they share a ride. Passengers can see *how many* drivers are
  available per tier, never who or where.
- **Audit trail** in `ride_events`.

`tests/db/foundation.test.mjs` runs the real migration in an in-process Postgres and attacks it as a hostile
client would (privilege escalation, direct writes, reading other people's rides, skipping states, racing
accepts). It runs in CI.

## Setting up a production Supabase project

Use a **new project**: the foundation schema and the old demo schema (`supabase_schema.sql`) both define
`public.rides`, so they cannot share a database.

1. Create the project at supabase.com.
2. **Authentication > Providers > Phone**: enable it and connect an SMS provider (for example Twilio, or
   Africa's Talking through a custom hook). Check the per-message cost. In **Authentication > Providers**,
   make sure **Anonymous sign-ins are off**.
3. Apply the schema: `supabase db push` with the Supabase CLI, or paste
   `supabase/migrations/20261015000000_foundation.sql` into the SQL editor.
4. Create your first admin. Sign up in the app with your phone number, then in the SQL editor run
   (this works because the SQL editor is not a signed-in app user):
   ```sql
   update public.profiles set role = 'admin' where phone = '+264811234567';
   ```
5. Put the project URL and **anon** key in the hosting environment (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`). **Never** put the service-role key in the app or in `VITE_*` variables.
6. Review **Authentication > Rate limits** and enable CAPTCHA or SMS abuse protection before launch.

## Known gaps in the foundation (by design, for later milestones)

- **Street distance is supplied by the client.** The server rejects implausible values (shorter than the straight
  line, or far longer) but cannot recompute a route. Moving routing server-side closes this (milestone 4).
- **No rate limiting** on the ride functions beyond one live ride per passenger.
- **Driver location** is stored by `update_driver_location` but nothing sends it yet (milestone 3).
- **Cash only.** There is no wallet, refund or payout ledger yet (milestone 5).
- **No driver identity verification** beyond the admin approval step (licence, vehicle papers, background check).
- **No cancellation fees or no-show handling.**

## Before launch (not code)

- Licensing for ride-hailing in Namibia and any local operating requirements.
- Terms of service and a privacy policy, plus data-protection obligations for phone numbers and location data.
- Apple Developer ($99 a year) and Google Play developer accounts, a real Android release keystore, and signed
  iOS builds. The current mobile builds are debug-signed or unsigned.
- Error monitoring, uptime checks, database backups with a tested restore, and a staging environment.
- A safety plan: emergency contact or SOS, trip sharing, and a way to report a driver or passenger.

## Next step

Milestone 2: replace the in-browser simulation with calls to the functions above, add phone sign-in and the
driver registration flow, and add an admin screen to approve drivers. The simulation stays available as a demo
mode for sales and development.
