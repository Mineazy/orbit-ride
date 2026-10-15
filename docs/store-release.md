# Releasing to the Apple App Store and Google Play

The repository already builds the Android apps (APK) and an unsigned iOS build in GitHub Actions (see the README,
"Native apps"). Those are for testing. **Store releases need signed builds**, which need your developer accounts and
signing keys. This page lists what to prepare. Do this after the [launch checklist](launch-checklist.md) is mostly done.

## Two apps, two store listings

| | Passenger | Driver |
| --- | --- | --- |
| App id | `com.orbitride.passenger` | `com.orbitride.driver` |
| Config | `capacitor.config.passenger.json`, `android-passenger/`, `ios-passenger/` | `capacitor.config.driver.json`, `android-driver/`, `ios-driver/` |
| Build with | `VITE_APP_ROLE=passenger` | `VITE_APP_ROLE=driver` |

Build with the production environment (`VITE_APP_MODE=production`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
The existing CI "Mobile builds" workflow produces demo builds; for store builds add those variables as GitHub
repository **secrets** and pass them to the build step.

## Before every release

1. Raise the version: Android `versionCode` (a whole number that must go up every upload) and `versionName` in
   `android-*/app/build.gradle`; iOS `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in the Xcode project.
2. Run the checks: `npm run lint && npm run typecheck && npm run test:unit && npm run test:db`.
3. Try the staging build on a real phone.

## Android (Google Play)

1. Create a **release keystore** once and **back it up in two places** (losing it means you can never update the app):
   `keytool -genkey -v -keystore orbitride-release.jks -alias orbitride -keyalg RSA -keysize 2048 -validity 10000`
2. Keep the keystore and its passwords out of the repository. Store them as GitHub secrets and sign in CI, or build on
   your own machine.
3. Build an **Android App Bundle** (`.aab`): in `android-passenger/`, `./gradlew bundleRelease`. Upload it in Play Console.
4. Turn on **Play App Signing** when asked.
5. Complete the **Data safety** form (answers below) and the **content rating** questionnaire.
6. Start with an **internal test** track, then a closed test with your first drivers, then production.

## iOS (App Store)

1. In the Apple Developer account create the two App IDs and an **App Store** distribution certificate and provisioning
   profiles. Needs a Mac with Xcode (or a macOS CI runner with your certificates stored as secrets).
2. Archive and upload from Xcode (Product, Archive, Distribute) or with `xcodebuild` and `altool`/Transporter.
3. In App Store Connect add the listing, screenshots (6.7" and 5.5" iPhone sizes), the privacy details, and a **demo
   account** for the reviewers: a passenger number and a driver number that work with a fixed code. Create these on
   staging with a test phone number whose code you control (Supabase can set a fixed OTP for specific test numbers).
4. Use **TestFlight** first.

Apple is strict about: sign-in that works for reviewers, account deletion inside the app (done), a working privacy policy
link (`https://your-site/?page=privacy`), and clear explanations for location use (done in the permission texts).

## Privacy answers (both stores)

Use these as the starting point; check them against the final app.

| Question | Answer |
| --- | --- |
| Data collected | Phone number, name, precise location (while using the app), ride history, payment/wallet records, crash/error reports |
| Used for | App functionality, account management, fraud prevention, app analytics (error reports only) |
| Shared with third parties | Hosting and database, SMS delivery, maps. Not sold, not used for advertising |
| Encrypted in transit | Yes |
| Users can request deletion | Yes, inside the app (Delete my account) |
| Tracking across other companies' apps | No |

## Store listing text (starting point, adapt it)

- **Passenger, short:** Request a ride in Windhoek in seconds. Pay the driver in cash.
- **Driver, short:** Earn money driving with OrbitRide. Go online and take rides near you.
- **Category:** Maps and Navigation, or Travel. **Age rating:** 4+/Everyone, with location noted.
- Screenshots: booking with the map, a driver on the way, the trip, the wallet, the driver console.
- Support URL and privacy URL: your site. Support email: the one you set in `VITE_SUPPORT_EMAIL`.

## Known limits to tell the stores and yourself

- Location works while the app is on screen. A driver whose phone sleeps the app may stop sending positions;
  true background tracking needs a native plugin and a stricter review (see the roadmap).
- Push notifications to a closed app need the Firebase and Apple push setup in [push-notifications.md](push-notifications.md)
  (including the Push Notifications capability in Xcode, which must be added with your signing identity).
