# Background location (driver app)

A driver who is **online** shares their position with the server every few seconds while moving (at least every 30
seconds when parked). Passengers see the car move, and the server uses the position to offer the driver nearby
requests. The server forgets a position after 5 minutes, so a driver whose phone stops reporting stops receiving requests.

| | Android app | iOS app | Browser |
| --- | --- | --- | --- |
| Keeps sending with the screen off or another app on top | Yes (foreground service with a permanent notification) | Yes (background location mode; the status bar turns blue) | **No**: the page's own location watch stops in the background |
| Permission asked | Location (while using), notifications | Location "While Using" (or "Always") | Location |
| Driver must agree first | Yes, an in-app disclosure (see below) | Yes, same dialog | No dialog |

Passenger apps never track in the background (their Android manifest removes the foreground-service declarations).

## What was built

- **One set of rules** for when to send a position (`src/prod/tracker.ts`): never more often than every 5 s, only when
  the phone moved 10 m or 30 s have passed, one send at a time, a failed send is retried by the next position.
  A heartbeat re-sends the last position for a parked driver. Tested without a phone (`tests/unit/tracking.test.mjs`).
- **Native source** (`src/prod/nativeTracking.ts`) using `@capacitor-community/background-geolocation`: a watcher with a
  visible notification, "Not authorised" mapped to a clear "location is blocked" message, clean stop.
- **Browser source** unchanged (and a development fallback point for the local test backend).
- **Disclosure dialog** (`LocationDisclosure.tsx`) shown the first time a driver goes online in the phone app, before
  the system permission prompt. Google Play requires this wording for background location.
- **Passengers** are told when the driver's position is more than 2 minutes old ("the car on the map may not be where
  they are now").
- Android driver: `useLegacyBridge` and `CapacitorHttp` enabled in `capacitor.config.driver.json`. Without them
  Android stops location updates, and throttles the app's web requests, after about 5 minutes in the background.
  Notification icon and text in `android-driver/app/src/main/res/`.
- iOS driver: `UIBackgroundModes: location` and the "Always and When In Use" explanation in `Info.plist`.

## You must test this on real phones

Background behaviour differs by phone make and battery settings, and cannot be proved on a computer. Before launch:

1. **Android** (try at least a Samsung and a Xiaomi/Tecno/Infinix, these kill background apps hardest):
   go online, lock the screen, put the phone in a pocket and drive or walk for 20 minutes. On a second phone, watch the
   passenger app or `select location_updated_at from driver_profiles` (should keep updating within about 30 s).
2. Repeat with **battery saver on**. If updates stop, the driver needs to set the app to "Unrestricted" battery use
   (Settings, Apps, OrbitRide, Battery). Add this tip to driver onboarding: https://dontkillmyapp.com lists each brand's steps.
3. **iOS**: same test. A blue bar at the top means tracking is on. If the driver chose "While Using", iOS keeps
   tracking in the background only after it was started with the app on screen, which is how the app does it.
4. Go **offline** and check the notification disappears and `location_updated_at` stops changing.
5. Kill the app from the app switcher: tracking stops (a driver who force-closes the app is no longer reachable).
6. Check data use and battery over a 4-hour shift.

## Store requirements

**Google Play** (driver app):
- The in-app disclosure above (done). Do not change its wording to something vaguer.
- In Play Console, App content, **Location permissions** and **Foreground service permissions**: declare that the app
  uses location in the background for "driver location sharing during rides". Reviewers may ask for a short **video**
  showing the disclosure, the permission prompt, the notification, and the feature (passenger seeing the car).
- The data safety form: precise location, collected, not shared for advertising, needed for the app to work.

**Apple** (driver app):
- Explain in the review notes: "Drivers share their location with passengers while online, including in the
  background, so the passenger can see the car arrive." Give a demo driver account.
- The usage text in `Info.plist` already says this plainly.

**Privacy Policy** (`src/prod/Legal.tsx`) now states that drivers' location is collected while online, including when the
app is closed or not in use. Have your lawyer check that wording.

## Limits and known risks

- The community plugin officially lists support up to Capacitor 7. It is a small native layer and is expected to work on
  Capacitor 8, but this has **not been run on a device**. If it misbehaves, the alternatives are Transistorsoft's
  background-geolocation plugin (a paid licence for Android release builds) or writing a small native service.
- With `CapacitorHttp` enabled all of the driver app's web requests go through the native layer. This was done so
  location pings keep reaching the server in the background. Test sign-in, rides and wallet on a real phone once.
- A phone's location can be wrong or faked ("mock location"). The server does not check; add checks if you see fraud.
- **Not built**: a recorded trail of each trip (for dispute handling or distance-based pricing), geofenced arrival
  detection, or drivers' "work hours" limits.
