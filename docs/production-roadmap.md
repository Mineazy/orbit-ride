# Production roadmap

OrbitRide started as a simulation: the browser ran dispatch, vehicle movement, fares and payouts, and the
database trusted whatever a client wrote. This document tracks the move to a real service.

Decisions made: **Supabase** backend, **phone number + SMS code** sign-in, **cash-only** payments at launch.

## Status

| Milestone | State |
| --- | --- |
| 1. Secure foundation: accounts, roles, per-user security, server-run ride lifecycle | **Database done and tested** (`supabase/migrations`, `npm run test:db`). App not yet connected. |
| 2. Connect the apps: phone sign-in, driver registration and approval, rides through the server API, admin screen | **Built and tested on the local backend** (`npm run dev:prod`). Not yet run against a real Supabase project or SMS provider. |
| 3. Live driver GPS, push notifications, proximity dispatch | **Partly done**: live GPS, proximity dispatch, nearby-driver map and in-app alerts are built and tested (`supabase/migrations/20261016000000_live_dispatch.sql`). Push to a closed app and background GPS still need native work (see below). |
| 4. Real address search and a production routing engine | **Partly done**: address search over about 4,000 real Windhoek places, tighter server distance limits. Server-side routing and coverage beyond Windhoek still to do (see below). |
| 5. Wallet and a payment gateway (DPO / PayToday) with a ledger | **Ledger and wallet done and tested** (`supabase/migrations/20261018000000_wallet_ledger.sql`). The gateway itself is not connected: it needs a merchant account (see below). |
| 6. Hardening and launch: monitoring, staging, store releases, legal pages | **Code done; the launch steps are yours.** See [launch-checklist.md](launch-checklist.md), [store-release.md](store-release.md) and [runbook.md](runbook.md). |

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

## Milestone 3: live location and dispatch

**Done**

- Drivers send their position while online (every 5 s at most when moving, every 30 s when parked).
- Drivers only see, and can only accept, requests whose pickup is within `platform_settings.dispatch_radius_km`
  (default 8 km) of a position no older than 5 minutes. The server enforces this, not just the screen.
- Passengers see anonymous, rounded positions of available drivers near their pickup, and the "online" counts use
  the same rule. During a ride they see their driver move and a rough arrival time.
- In-app alerts (sound, vibration, system notification while the app is in the background of a browser): new request
  for drivers, accepted / arrived / started / completed for passengers.

**Still to do before launch**

- **Push notifications to a closed app** need Firebase Cloud Messaging (Android) and an Apple APNs key (iOS), plus a
  small server function that sends them when a ride changes. These need your own accounts and credentials.
- **Background GPS**: a phone may pause location updates when the driver app is not on screen. Reliable tracking
  needs a native background-location plugin and the stricter store review that comes with it.
- Android and iOS builds now declare the location (and Android notification) permissions.

## Milestone 4: address search and routing

**Done**

- **Address search** (`src/utils/placeSearch.ts`, index built by `npm run build:places`): about 4,000 named places in
  Windhoek (streets, suburbs, schools, hospitals, malls, hotels, restaurants, fuel stations and more), taken from the
  same map tiles the app draws, so it needs no API key, works offline and never rate-limits. Typing "sam nuj" finds
  Sam Nujoma Drive; results are ranked by match quality, usefulness and closeness to the other end of the trip.
- Tapping the map or using "Use my location" names the spot (the nearest place, or "Near <street>").
- **Distance limits** (`supabase/migrations/20261017000000_route_limits.sql`): the server now rejects a street distance
  longer than max(2.5 x the straight line, straight line + 2 km). Both numbers are admin settings.

**Still to do**

- **Server-side routing.** The app measures the street distance on the phone and the server only checks it is
  plausible. A passenger who modifies the app could still ask for up to 2.5x the real distance. Closing this means
  running a routing engine on your side (OSRM, Valhalla or GraphHopper on a small server, or a paid routing API) and
  having the server compute the distance, which needs hosting and, for a paid API, a key.
- **Outside Windhoek.** The index and road graph cover urban Windhoek only. Other towns need their own map extract,
  then `npm run build:roads` and `npm run build:places`; or a hosted geocoder (Photon, Nominatim you host yourself, or
  a paid one) for anywhere-in-Namibia search.
- House numbers and individual addresses are not in the index; people search by place, street or suburb and adjust the pin.
- The demo mode still uses its short built-in place list.

## Milestone 5: wallet and ledger

**Done** (switched off for passengers until you enable it: `platform_settings.wallet_enabled`, default false)

- **Double-entry ledger.** Every movement of money writes two entries that sum to zero, in one transaction. Entries can
  never be edited or deleted (enforced by the database, even for its owner). Account balances always equal the sum of
  their entries; the tests check this after every scenario.
- **Cash rides stay the default.** The driver collects the fare; on completion the platform fee is taken from the
  driver's wallet, so it goes negative by what they owe. Past `driver_debt_limit` (default N$200) the driver cannot go
  online or accept rides until they pay. An admin records a payment handed over in cash or by bank transfer
  (Admin screen, "Record payment"; a negative amount corrects a mistake).
- **Wallet rides.** The fare is held when the ride is requested, released if it is cancelled, and paid to the driver on
  completion. A passenger cannot spend money they have already reserved.
- **Top-ups.** `create_topup` records the intent. Only the payment gateway webhook, running with the Supabase service
  role, can call `complete_topup`, which is idempotent (a repeated webhook never credits twice, and one gateway payment
  can never credit two top-ups).
- **Payouts.** A driver requests a payout of their available balance (held until an admin pays it by bank transfer and
  marks it paid, or rejects it). The Admin screen shows fees earned, what drivers owe, what is owed to drivers and
  what has been paid out.

**Still to do before you turn the wallet on**

- **Connect a payment gateway** (DPO Pay, PayToday or another). This needs your merchant account and keys, plus a
  small server function that creates the checkout, and a webhook that verifies the gateway signature and calls
  `complete_topup`. The apps currently start a top-up and wait for that confirmation; there is no checkout page yet.
  In the local test backend a stand-in "gateway" credits the money instantly so you can try the flow.
- Legal and finance: terms of service, refunds policy, and advice on how money held for passengers and drivers is
  treated (and licensing) under Namibian rules. The ledger records everything; it does not replace that advice.
- Receipts and statements, and automatic payout files for your bank.

## Milestone 6: hardening and launch

**Done and tested**

- **Account deletion** inside both apps (`delete_my_account`): erases name, phone and photo, frees the number, blocks
  the old identity, keeps anonymised ride and ledger records. Refused while a ride is live or money is owed or held.
- **Rate limits** on ride requests and top-ups (10 an hour each) so a script cannot flood the service.
- **Error reporting**: crashes and unexpected errors are sent to the server (`report_client_error`), kept 30 days,
  limited per user, and listed on the Admin screen. A crash shows a friendly "Reload" page instead of a blank screen.
- **Admin can cancel a stuck ride** (money held for it is released).
- **Safe builds**: a production build is refused if it uses the local test backend (sign-in code 123456), lacks the
  Supabase settings, or has a service-role key in any `VITE_` variable.
- **Security headers** (content security policy, no framing, no sniffing, HTTPS only) in `render.yaml`, tried against
  the running app. A test keeps `render.yaml` and the code in step.
- **Legal pages** (Terms, Privacy, Refunds) linked from sign-in and the account area, with a visible "draft" banner
  until you set `VITE_LEGAL_REVIEWED=true`.
- A `health.json` for uptime monitors, and a list of every migration run by the local test backend.

**Needs you** (all in the [launch checklist](launch-checklist.md)): production and staging Supabase projects with
backups, an SMS provider that reaches Namibian numbers, a domain, developer accounts and signing keys for the stores,
a lawyer to review the legal text, operating permits and insurance, and the support and driver-approval process.

**Known gaps** (also listed in the milestones above): server-side routing, push notifications to a closed app,
background GPS, and a connected payment gateway.
