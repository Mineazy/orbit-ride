# MEMORY.md — Orbit Ride iOS CI Setup

## Objective

Set up a CI pipeline on GitHub Actions to compile iOS apps for the Orbit Ride project (a Capacitor-based web-to-native app with two targets: **Passenger** and **Driver**).

## Environment

- **OS**: Windows (local dev), macOS (GitHub Actions runner)
- **Framework**: Capacitor 8 + Vite + React 19
- **Project**: `https://github.com/Mineazy/orbit-ride.git`
- **Cloned to**: `E:\Dev\IOS\orbit-ride`

## Project Structure

```
orbit-ride/
├── .github/
│   ├── workflows/
│   │   ├── node.js.yml          # existing — Node.js CI (ubuntu)
│   │   └── ios-build.yml        # NEW — iOS build (macOS)
│   ├── export-passenger.plist   # NEW — IPA export options
│   └── export-driver.plist      # NEW — IPA export options
├── capacitor.config.json         # base config
├── capacitor.config.driver.json  # Driver-specific config
├── capacitor.config.passenger.json # Passenger-specific config
├── ios-driver/App/               # Driver Xcode project (tracked in git)
├── ios-passenger/App/            # Passenger Xcode project (tracked in git)
├── scripts/generate-ios.js       # local iOS generation script
├── src/                          # web app source
└── package.json                  # dependencies include @capacitor/ios, @capacitor/cli
```

## Files Created

### 1. `.github/workflows/ios-build.yml`

A GitHub Actions workflow that:

- **Triggers**: push/PR to `main`, manual dispatch
- **Runs on**: `macos-15` (macOS runner)
- **Matrix strategy**: builds both `passenger` and `driver` targets in parallel
- **Steps**:
  1. Checkout code
  2. Setup Node.js 20 with npm cache
  3. `npm ci`
  4. Build web assets with `VITE_APP_ROLE` env var
  5. Copy role-specific `capacitor.config.<role>.json` to `capacitor.config.json`
  6. Create symlink `ios` → `ios-<target>`, run `npx cap sync ios`, remove symlink
  7. `pod install --repo-update` in `ios-<target>/App/`
  8. Select Xcode 16
  9. **Unsigned build** (PRs / non-main): `xcodebuild build` for simulator with `CODE_SIGNING_ALLOWED=NO`
  10. **Signed build** (main push): `xcodebuild archive` + `xcodebuild -exportArchive` with `-allowProvisioningUpdates`
  11. Upload IPA artifact (signed only)
  12. Upload build logs on failure

### 2. `.github/export-passenger.plist` & `.github/export-driver.plist`

Export options plists for `xcodebuild -exportArchive`. Uses `app-store` method with symbol uploads.

## Secrets Required (for signed builds)

Set these in GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `APPLE_ID` | Your Apple Developer account email |
| `APPLE_ID_PASSWORD` | App-specific password (generate at appleid.apple.com) |

The `-allowProvisioningUpdates` flag auto-manages certificates and profiles.

## How to Use

- **Unsigned (PR)**: push a PR — builds for simulator, no Apple account needed
- **Signed (main)**: push to `main` — archives and exports `.ipa`
- **Manual**: go to Actions → iOS Build → Run workflow

## Verification

- YAML was validated via `js-yaml`
- Export plists are well-formed XML
- iOS Xcode projects are tracked in git (excluding `Pods/`, `build/`, `public/`)
