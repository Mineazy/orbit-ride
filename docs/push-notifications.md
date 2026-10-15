# Push notifications

Push lets the apps tell people things while the app is closed: a driver hears about a ride request near them, a passenger
hears that the driver accepted, arrived or cancelled.

| Who | They are told |
| --- | --- |
| Driver | **New ride request** (up to the 10 nearest available drivers of the right vehicle type, with a fresh position inside the dispatch radius), **ride cancelled** by the passenger or an admin, **approved / not approved / suspended**, **payout sent / not paid** |
| Passenger | **Driver on the way** (name, vehicle, plate), **driver arrived**, **you have arrived** (with the fare), **looking for another driver** (driver handed the ride back), **ride cancelled** (by a driver's problem or an admin) |

How it works:

```
something happens (ride accepted, ...)
  └─ database trigger ─▶ push_outbox (a queued message, private to the server)
        └─ trigger on push_outbox ─▶ pg_net ─▶ `send-push` edge function (with a shared secret)
              ├─ Android and iOS apps ─▶ Firebase Cloud Messaging ─▶ the phone
              └─ browsers (the website) ─▶ Web Push ─▶ the browser
```

- Apps register a phone with `register_device()` when the person taps "Turn on notifications".
- A failure to queue or send **never** blocks a ride: the triggers swallow their own errors, and failed messages are retried
  (up to 5 times, then dropped, because a stale "new ride request" does more harm than none).
- Dead devices (app removed, token expired) are deleted automatically when the provider says so.
- Signing out stops notifications for that phone; signing in again re-attaches it.
- While the app is on screen it already beeps and vibrates by itself, so browsers skip the system notification then
  (Safari must always show one, so it does).

**What needs your accounts**, and cannot be done for you: a Firebase project (free) for phones, and VAPID keys (made with
one command, no account) for browsers. Nothing is sent until you do the steps below.

## 1. Browsers (Web Push), about 10 minutes

1. Make keys: `npm run vapid`. It prints a public key and a private key. Make a separate pair for staging and production.
2. **Public key**: set it in the web build as `VITE_VAPID_PUBLIC_KEY` (Render, Environment). Without it the browser apps
   do not offer notifications.
3. **Private key**: keep it secret, it goes only into the function (step 3 below).
4. iPhone and iPad: Safari only delivers Web Push to a site the person has added to the Home Screen. The native apps
   (below) are the better route for iOS.

## 2. Android and iOS apps (Firebase Cloud Messaging), about 30 minutes plus Apple's steps

1. Create a Firebase project (console.firebase.google.com). Add an **Android app** for each of `com.orbitride.passenger`
   and `com.orbitride.driver` and download each `google-services.json` into `android-passenger/app/` and
   `android-driver/app/` (these files are not secret keys, but keep them out of public repos if you prefer).
   The build works without them; push just does not register.
2. Add an **iOS app** for each id too. In Firebase, Project settings, Cloud Messaging, upload your **APNs
   authentication key** (a `.p8` file from your Apple Developer account, Keys, with "Apple Push Notifications service" ticked).
3. In Xcode, for each iOS app: Signing and Capabilities, **+ Capability, Push Notifications** (and **Background Modes,
   Remote notifications**). Add the Firebase iOS SDK for FCM tokens as described in Capacitor's Push Notifications
   guide (add `GoogleService-Info.plist` and `pod 'FirebaseMessaging'`, and forward the APNs token to Firebase in
   `AppDelegate.swift`). This must be done on a Mac with your signing identity, so it is not in the repository.
4. Firebase project settings, Service accounts, **Generate new private key**: this JSON is the `FCM_SERVICE_ACCOUNT`
   secret below. Treat it like a password.
5. Run `npx cap sync` for each app (the CI "Mobile builds" workflow already does) so the plugin is added to the projects.

## 3. Deploy the sender (once per Supabase project, staging first)

```bash
supabase functions deploy send-push --no-verify-jwt
supabase secrets set PUSH_WEBHOOK_SECRET=<long random string> \
  FCM_SERVICE_ACCOUNT='<the whole service-account JSON, on one line>' \
  VAPID_PUBLIC_KEY=<public key> VAPID_PRIVATE_KEY=<private key> VAPID_SUBJECT=mailto:support@your-domain
```

`--no-verify-jwt` is correct here: the database calls this function with the shared secret header, and the function
refuses any call without it. Leave out whichever provider you are not using; messages for it wait and then expire.

## 4. Connect the database to the function

In the Supabase dashboard enable the **pg_net** extension (Database, Extensions), then run in the SQL editor:

```sql
insert into public.server_secrets (name, value) values
  ('push_webhook_url',    'https://<your-project-ref>.supabase.co/functions/v1/send-push'),
  ('push_webhook_secret', '<the same PUSH_WEBHOOK_SECRET>');
```

From now on every queued message wakes the function immediately.

## 5. Retry sweep (recommended)

Network failures happen. Add a schedule (Supabase **Cron**, or any scheduler) that posts once a minute:

```
POST https://<ref>.supabase.co/functions/v1/send-push
x-push-secret: <the secret>
{"sweep": true}
```

It retries messages older than a minute that were not delivered.

## 6. Try it (staging)

1. On a phone, sign in and tap **Turn on notifications**. In SQL: `select platform, left(token, 12) from public.device_tokens;`
   shows the phone.
2. Close the app, request a ride from another device. The driver phone should buzz within a couple of seconds.
3. If nothing arrives: `select * from public.push_outbox order by id desc limit 5;` (is `sent_at` filled? how many
   `attempts`?), then Supabase, Edge Functions, `send-push`, Logs.

## Privacy and limits

- Messages contain names and places that the recipient already sees in the app. They do not contain phone numbers.
  Remember that lock screens show them; the apps do not hide them.
- Each person keeps at most 10 registered devices.
- Delivery is "best effort" like all push: phones in battery-saving modes, or with notifications switched off in system
  settings, may not receive them. The app still shows everything when opened.
- **Not built:** quiet hours, per-type opt-outs, notification sounds per type, badge counts, or notifications inside the
  admin screen.
- **Not tested here:** delivery through real Firebase and browser push services (they need your accounts). The message
  building, signing, retries and database triggers are covered by automated tests.
