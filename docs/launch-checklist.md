# Launch checklist

Everything the code can do for launch is done and tested. What is left needs **your accounts, your decisions or a
professional**. Work top to bottom; each item says who has to do it.

## 1. Accounts and services (you)

- [ ] **Supabase production project** (separate from staging and from the demo project). Region closest to Namibia
      (for example Europe or South Africa if available). Turn on **Point-in-time recovery** (paid plan) so you can
      restore to any minute.
- [ ] **SMS provider** for sign-in codes. In Supabase: Authentication, Providers, Phone. Twilio, MessageBird,
      Vonage or Textlocal work; check that the provider can deliver to Namibian numbers (+264) and what it costs per
      message. Test with real MTC and TN Mobile numbers before launch.
- [ ] **Domain name** and HTTPS (Render handles the certificate once the domain is pointed at it).
- [ ] **Apple Developer Program** (about US$99 a year) and **Google Play Console** (one-off US$25). See
      [store-release.md](store-release.md).
- [ ] A **support email and phone** that someone actually reads (drivers and passengers will use them).

## 2. Staging (you, 30 minutes)

Never test on production data.

1. Create a second Supabase project called `orbitride-staging`.
2. Run the migrations in `supabase/migrations/` **in file-name order** (SQL editor, or `supabase db push`).
3. Make a second Render static site (copy `render.yaml`, point its `VITE_SUPABASE_*` at the staging project).
4. Deploy every change to staging first, try a ride with three phones, then deploy production.

## 3. Production setup (you)

1. Run all migrations on the production project, in order. Check **Database, Extensions** is not needed for anything.
2. In Supabase **Authentication, Settings**: turn **off** "Allow new users to sign up" only if you want invite-only
   (leave it on for normal launch); set a sensible SMS OTP expiry (10 minutes) and rate limits.
3. Make the first admin: sign in once with your phone in the passenger app, then in the SQL editor run
   `update public.profiles set role = 'admin' where phone = '+264...';` and sign in again at `?app=admin`.
4. **Deploy server-side routing** and switch on `require_signed_routes`: follow [server-routing.md](server-routing.md).
   Without it the phone's distance is only checked for plausibility.
5. **Set up push notifications** (Firebase project, Apple push key, VAPID keys, deploy `send-push`):
   [push-notifications.md](push-notifications.md). Optional for a first launch: the apps still alert while open.
6. Check the settings row: `select * from public.platform_settings;`. Review `commission_rate`,
   `dispatch_radius_km`, `driver_debt_limit`, `max_route_factor` and keep `wallet_enabled = false` for a cash-only launch.
   Review `public.fare_config` for the real tariffs.
7. Build settings on Render (Environment): `VITE_APP_MODE=production`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   plus the legal details below. The build refuses to run if these are missing, if the local test backend is switched
   on, or if a service-role key is in any `VITE_` variable.
8. Make three static sites (or one per app) with `VITE_APP_ROLE=passenger`, `driver` and `command-center`
   (the admin app). `VITE_APP_ROLE=command-center` opens the admin app in production mode.

## 4. Legal (you and a lawyer)

The legal pages are drafts. They describe what the app does, but they are **templates, not legal advice**.

- [ ] A Namibian lawyer reviews and edits `src/prod/Legal.tsx` (Terms, Privacy, Refunds).
- [ ] Set `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`, `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_PHONE`,
      `VITE_LEGAL_UPDATED`, and only then `VITE_LEGAL_REVIEWED=true` (removes the "draft" banner).
- [ ] Find out what licences or permits are needed to operate a ride-hailing service and what each driver needs
      (a public-transport or taxi permit, driving licence class, vehicle fitness, passenger insurance). The app
      approves drivers by hand; decide what you check before pressing "Approve".
- [ ] Insurance for the business and advice on how to handle money held for others before turning the wallet on.
- [ ] Register with the data-protection authority if one applies when you launch.

## 5. People and operations (you)

- [ ] Decide who approves drivers and how (documents seen in person?). Write the checklist down.
- [ ] Decide how cash fees are collected from drivers (office, bank transfer, mobile money) and who records them in
      the Admin screen ("Record payment"). Review the "Drivers owe" total weekly.
- [ ] Support process: who answers complaints, how quickly, how refunds and fare disputes are decided.
- [ ] Emergency process: a driver or passenger reports an incident. Who is called, and what is done with the accounts.

## 6. Test before you open the doors

- [ ] Three real phones (a passenger, a driver, an admin) on staging, a full ride in each direction.
- [ ] Driver goes online with real GPS outdoors; the passenger sees the car move.
- [ ] Sign-in codes arrive on MTC and TN Mobile, in under a minute.
- [ ] Delete an account from the app (Passenger and Driver). Check the phone number can sign up again.
- [ ] Open `?page=privacy` on the live site: the store listings need that public link.
- [ ] Look at the Admin "App errors" list after the tests: it should be empty or explained.

## 7. After launch

- Watch **Admin, App errors** daily at first. Watch Supabase **Reports** (database size, API errors).
- Keep a short list of "what I would change" from real riders and drivers; that is the next milestone.

## What the code already protects you from

| Risk | Protection |
| --- | --- |
| Someone edits the app to give themselves a cheap fare | Fares are computed on the server from a distance the server measured and signed (`require_signed_routes`, see [server-routing.md](server-routing.md)); until that is on, the distance is bounded by `max_route_factor`. |
| A user reads another person's rides or money | Row-level security on every table; tested with strangers, passengers, drivers and admins. |
| Double charge or lost money | Double-entry ledger, append-only, idempotent top-ups; tests check the books balance after every scenario. |
| Script floods the service | Rate limits on ride requests and top-ups; sign-in rate limits are Supabase's. |
| Driver keeps working while owing fees | Debt limit blocks going online and accepting rides. |
| A secret key shipped in the app | The build stops if a service-role key is in any `VITE_` variable. |
| Dev backend (code 123456) deployed | The production build refuses `VITE_BACKEND=local`. |
| Cross-site scripting, clickjacking | Content-Security-Policy and other security headers on the site (see `scripts/security-headers.mjs`). |
| App store rejection for missing deletion | In-app "Delete my account" (erases name and number, keeps anonymised financial records). |
