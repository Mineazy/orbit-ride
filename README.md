# Orbit Ride

A ride-hailing simulation platform set in Windhoek, Namibia. One codebase provides three connected front ends — a dispatcher **Command Center**, a **Passenger** app and a **Driver** app — which can run together in one browser window or be built as separate native apps with Capacitor.

It works fully offline out of the box: with no backend configured, rides, drivers, fares and metrics are simulated in local state. Add Supabase credentials to get live sync. The map uses self-hosted vector tiles and needs no API key.

## Features

- **Command Center** – live map, driver roster, analytics, weather/surge controls and an operations log.
- **Passenger app** – search Windhoek locations, pick a vehicle tier (OrbitX, OrbitXL, OrbitFly), set an offer fare and track the trip.
- **Driver app** – go online, receive bid requests with a countdown, accept, arrive, start and complete trips.
- **Simulation engine** – shared state in `SimulationContext` drives dispatch, routing, fares, earnings and metrics.
- **Optional backend** – Supabase tables with Realtime subscriptions; automatic fallback to offline mode when keys are missing or invalid.
- **Native builds** – Android and iOS wrappers for the passenger and driver roles.

## Tech stack

React 19 · TypeScript · Vite 8 · Capacitor 8 · Supabase · MapLibre GL + Protomaps (PMTiles)

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
| `VITE_PMTILES_URL` | Optional. URL of a `.pmtiles` archive; defaults to the bundled `public/tiles/windhoek.pmtiles` |
| `VITE_APP_ROLE` | `command-center`, `passenger` or `driver` – selects which app a build renders |
| `PORT` | Port for the dev server |

Placeholder values (anything containing `YOUR_`) are detected and ignored, so the app falls back to offline simulation. `.env` is git-ignored — never commit real keys.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run build:command-center` / `build:passenger` / `build:driver` | Build a single role |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run preview` | Preview the production build |
| `npm run start` | Serve the built `dist/` on `$PORT` (used by a Render web service) |
| `npm run build:apks` | Build debug Android APKs for passenger and driver into `build-artifacts/` (needs JDK 21 and the Android SDK) |
| `npm run generate:ios` | Generate the iOS projects (macOS) |

## Project structure

```
src/
  App.tsx                    Role switching and layout modes
  components/
    CommandCenter.tsx        Dispatcher dashboard
    ClientApp.tsx            Passenger app
    DriverApp.tsx            Driver app
    MapView.tsx              MapLibre GL + Protomaps (PMTiles) map
  context/SimulationContext.tsx   State and simulation logic
  utils/supabase.ts          Supabase client with offline fallback
  types/                     Shared TypeScript types
supabase_schema.sql          Database schema, RLS policies, seed data
capacitor.config.*.json      Per-role Capacitor configs
android-driver/, android-passenger/   Native Android projects
scripts/                     APK and iOS build helpers
.github/workflows/           Node CI and iOS build
render.yaml                  Render.com blueprint
```

## Map tiles

The map is MapLibre GL rendering Protomaps vector tiles from a single PMTiles file, `public/tiles/windhoek.pmtiles` (about 10 MB, zoom 0-15, bounding box 16.7,-23.0 to 17.4,-22.3). Map data is © OpenStreetMap contributors. The Protomaps daily builds send no CORS headers, so browsers can't read them directly; instead the file was cut from one with the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles):

```bash
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles public/tiles/windhoek.pmtiles --bbox=16.7,-23.0,17.4,-22.3 --maxzoom=15
```

Use a recent build date (older builds are removed). Re-run to refresh the data, or widen `--bbox` (and `MAX_BOUNDS` in `MapView.tsx`) to cover more of Namibia. To host the file elsewhere (S3, R2), enable CORS and range requests there and set `VITE_PMTILES_URL`. Label fonts are loaded from the public `protomaps.github.io/basemaps-assets` site.

## Street routing

Simulated vehicles follow real streets rather than straight lines. `scripts/build-road-graph.mjs` reads the drivable roads from `public/tiles/windhoek.pmtiles` and writes a compact graph, `public/tiles/windhoek-roads.json` (about 700 kB). At runtime `src/utils/roadRouter.ts` loads it and runs A* between the snapped start and end points, then resamples the path into simulation ticks while keeping street corners. Idle drivers are also snapped onto the nearest road. Fares use the driving distance along these streets (`routeDistance` in `SimulationContext.tsx`), falling back to the straight-line distance until the graph has loaded or when no street route exists.

```bash
npm run build:roads   # regenerate after changing the tiles or the covered area (bbox in the script)
```

Details: it keeps car-usable road classes (service roads included, driveways and parking aisles excluded), joins side roads that end on a passing road, and keeps only the largest connected component. Roads are treated as two-way, so one-way streets and turn restrictions are ignored. If the graph can't be loaded, or a point is more than 800 m from any road, routes fall back to the old straight-ish path.

## Supabase: demo mode and production mode

There are two separate schemas. They both define `public.rides`, so use a **different Supabase project** for each.

**Production (in progress).** Real accounts, per-user security and a server-run ride lifecycle live in
[`supabase/migrations/`](supabase/migrations). The database is tested (`npm run test:db`) and the passenger, driver and admin apps
are connected to it: phone sign-in, driver registration and approval, and rides run through the server functions.
Build with `VITE_APP_MODE=production` plus `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to use it.

To try it with no setup, run `npm run dev:prod`: it uses an in-browser test database (SMS code is always `123456`,
sign in as `081 000 0000` for the admin). Open `/?app=passenger`, `/?app=driver` or `/?app=admin`.
Setup steps, the security model and the plan are in [`docs/production-roadmap.md`](docs/production-roadmap.md).

**Demo mode.** The apps currently run the offline simulation, or the original shared-state demo backend:

1. Create a Supabase project and run [`supabase_schema.sql`](supabase_schema.sql) in the SQL editor (safe to re-run).
2. In **Authentication > Providers**, enable **Allow anonymous sign-ins**.
3. Put the project URL and anon key in `.env` (or the Render dashboard).

The demo apps sign every client in anonymously before they read or write. If the URL or key is wrong, or anonymous
sign-ins are disabled, the app logs an error and falls back to the offline simulation.

The demo policies are for the shared simulation, not for per-user data: any anonymous session can read and update
rides, drivers, the passenger row and metrics. Do not use them for real users.

## Deployment

The `render.yaml` blueprint defines a Render static site (`npm run build:command-center`, publishing `dist/`). Set the two `VITE_*` Supabase variables in the Render dashboard; they are baked in at build time.

## Native apps

The **Mobile builds** workflow (Actions tab, or run it with *publish_release* ticked) builds both apps for phones. Releases are listed under the repository's **Releases** page.

| File | Install on |
| --- | --- |
| `OrbitRide-passenger.apk`, `OrbitRide-driver.apk` | Android 7.0 (API 24) or newer |
| `OrbitRide-passenger-unsigned.ipa`, `OrbitRide-driver-unsigned.ipa` | iPhone, iOS 15 or newer (sideload) |

**Android:** download the `.apk` on the phone (or copy it over), open it, and allow *Install unknown apps* when asked. These are debug-signed builds and CI generates a new debug key each run, so uninstall the old app before installing a newer build.

**iPhone:** the `.ipa` files are **unsigned**, so they cannot be installed by tapping them. Sideload them with [AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io) using your own Apple ID (a free Apple ID's apps expire after 7 days and must be re-signed). A normally installable, TestFlight or App Store build needs a paid Apple Developer account and signing secrets, which this repository does not have.

The apps run the offline simulation and bundle the map tiles and road data. Page fonts and map text labels are loaded from the internet.

To build locally instead, `npm run build:apks` (Android, needs JDK 21 and the Android SDK) or `npm run generate:ios` (macOS with Xcode and CocoaPods) still work as before.

## Known limitations

- Several large components still carry `// @ts-nocheck`, so type checking covers only part of the code.
- A few effects deliberately call `setState` and are annotated with ESLint disables.
- The main bundle exceeds 500 kB; code-splitting is not yet set up.
