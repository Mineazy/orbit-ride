# Orbit Ride

A ride-hailing simulation platform set in Windhoek, Namibia. One codebase provides three connected front ends — a dispatcher **Command Center**, a **Passenger** app and a **Driver** app — which can run together in one browser window or be built as separate native apps with Capacitor.

It works fully offline out of the box: with no backend configured, rides, drivers, fares and metrics are simulated in local state. Add Supabase and Google Maps credentials to get live sync and a real map.

## Features

- **Command Center** – live map, driver roster, analytics, weather/surge controls and an operations log.
- **Passenger app** – search Windhoek locations, pick a vehicle tier (OrbitX, OrbitXL, OrbitFly), set an offer fare and track the trip.
- **Driver app** – go online, receive bid requests with a countdown, accept, arrive, start and complete trips.
- **Simulation engine** – shared state in `SimulationContext` drives dispatch, routing, fares, earnings and metrics.
- **Optional backend** – Supabase tables with Realtime subscriptions; automatic fallback to offline mode when keys are missing or invalid.
- **Native builds** – Android and iOS wrappers for the passenger and driver roles.

## Tech stack

React 19 · TypeScript · Vite 8 · Capacitor 8 · Supabase · Google Maps JavaScript API · Express (production static server)

## Getting started

Requires Node.js 20+.

```bash
npm install
cp .env.example .env   # optional – the app runs offline without it
npm run dev
```

The dev server listens on `http://localhost:5173`.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL (must be a `*.supabase.co` URL) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key |
| `VITE_APP_ROLE` | `command-center`, `passenger` or `driver` – selects which app a build renders |
| `PORT` | Port for the dev server / `server.js` |

Placeholder values (anything containing `YOUR_`) are detected and ignored, so the app falls back to offline simulation and skips loading Google Maps. `.env` is git-ignored — never commit real keys, and restrict your Maps key by HTTP referrer.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run build:command-center` / `build:passenger` / `build:driver` | Build a single role |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run preview` | Preview the production build |
| `npm run build:apks` | Build debug Android APKs for passenger and driver into `build-artifacts/` (needs JDK 21 and the Android SDK) |
| `npm run generate:ios` | Generate the iOS projects (macOS) |
| `node server.js` | Serve `dist/` plus a small demo API (production) |

## Project structure

```
src/
  App.tsx                    Role switching and layout modes
  components/
    CommandCenter.tsx        Dispatcher dashboard
    ClientApp.tsx            Passenger app
    DriverApp.tsx            Driver app
    MapView.tsx              Google Maps integration
  context/SimulationContext.tsx   State and simulation logic
  utils/supabase.ts          Supabase client with offline fallback
  types/                     Shared TypeScript types
server.js                    Express static server + stub API
supabase_schema.sql          Database schema, RLS policies, seed data
capacitor.config.*.json      Per-role Capacitor configs
android-driver/, android-passenger/   Native Android projects
scripts/                     APK and iOS build helpers
.github/workflows/           Node CI and iOS build
render.yaml                  Render.com blueprint
```

## Supabase setup

1. Create a Supabase project and run [`supabase_schema.sql`](supabase_schema.sql) in the SQL editor.
2. Put the project URL and anon key in `.env`.

The schema's RLS policies only allow the `authenticated` role, but the app currently connects with the anon key and has no sign-in flow. Until an auth flow is added (or the policies are adjusted for a demo), the live backend will reject requests and the app will not sync.

## Deployment

The `render.yaml` blueprint describes a static site and a Node web service. For the web service, the build is `npm run build:command-center` and the start command is `node server.js`; set the three `VITE_*` variables in the Render dashboard. Note that `VITE_*` values are baked in at build time.

`server.js` is a demo: its API routes return hardcoded data and are not used by the front end.

## Native apps

Each role has its own Capacitor config (`capacitor.config.passenger.json`, `capacitor.config.driver.json`) and app ID (`com.orbitride.passenger` / `com.orbitride.driver`). Run `npm run build:apks` for Android; iOS builds run on macOS through `.github/workflows/ios-build.yml`.

## Known limitations

- Several large components still carry `// @ts-nocheck`, so type checking covers only part of the code.
- A few effects deliberately call `setState` and are annotated with ESLint disables.
- The main bundle exceeds 500 kB; code-splitting is not yet set up.
