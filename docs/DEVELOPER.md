# Shot Tracker – Developer Guide

Everything needed to understand, change and deploy the app. For how to *use* it, see the
[README](../README.md) and the in-app ⓘ help (`components/HelpSheet.tsx`).

## What it is

A phone-first web app for a hunting party. Members report **shots heard** (position + compass
bearing + time), **deer sightings**, **deer sign** and **blinds**. Reports heard within a few minutes
of each other are grouped into one shot and **triangulated** on a topographic map.

- **Live site:** https://shot-tracker-henna-beta.vercel.app (Vercel project `shot-tracker`,
  team "scottlaughton-tech's projects")
- **Repo:** `scottlaughton-tech/Shot-tracker`. **Pushing to `main` deploys automatically.**
- **Users:** a small party of not-very-technical hunters on iPhone and Android, often with weak signal.

## Stack

| Piece | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 | TS pinned to 5 (TS 7 was too new for Next) |
| Map | Leaflet 1.9 + react-leaflet 5 | Map is client-only (`dynamic(..., { ssr: false })`) |
| Tiles | OpenTopoMap (default), Esri World Imagery, OpenStreetMap | Layer switcher top right |
| Storage | Upstash Redis via Vercel Marketplace (`@upstash/redis`) | Falls back to in-memory when env vars are missing (local dev) |
| Declination | `geomagnetism` (WMM2025 model) | ≈ −11° (west) near Bancroft, ON |
| Hosting | Vercel | Env vars set in Vercel → Settings → Environment Variables |

## Environment variables

| Name | Purpose |
|---|---|
| `PARTY_PASSCODE` | Shared passcode. **Required in production**; without it the login page refuses with setup instructions. Locally, unset = no passcode. Compared case-insensitively. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | Added automatically when Upstash is connected to the Vercel project. |

Changing env vars needs a **redeploy** (Deployments → ⋯ → Redeploy, or push a commit).

## File map

```
app/
  layout.tsx, globals.css      page shell; ALL styling lives in globals.css (sections are commented)
  page.tsx                     auth check → <App/>
  login/page.tsx               passcode page (components/LoginForm.tsx)
  api/login/route.ts           POST {code} → sets httpOnly cookie
  api/reports/route.ts         GET everything · POST shot report · DELETE = clear all shots
  api/reports/[id]/route.ts    DELETE one entry of ANY kind (id prefix decides the kind)
  api/sightings/route.ts       POST deer sighting · DELETE = clear all sightings
  api/signs/route.ts           POST deer sign · DELETE = clear all sign
  api/blinds/route.ts          POST blind · DELETE = clear all blinds
  api/settings/route.ts        PUT {intervalMin} (shared "Group" setting)
components/
  App.tsx          state hub: polling, alerts/toasts, layers, modes (crosshair, ruler, quick shot), top bar, buttons
  ShotMap.tsx      Leaflet map: shot lines/estimates, deer/sign/blind markers, you-are-here arrow,
                   crosshair pick mode, ruler, live bearing line, popups with Delete
  ShotList.tsx     "☰ Layers" panel: 4 layer switches, tabs, per-item rows, Edit mode, Clear all
  ReportForm.tsx   full form for Shot / Deer / Sign / Blind (also "Enter manually")
  QuickShot.tsx    "Heard a shot" fast path: overlay over the map, fixed up-arrow, REGISTER SHOT
  HelpSheet.tsx    ⓘ plain-language instructions
  LoginForm.tsx    passcode form
lib/
  geo.ts           types (Report, Sighting, Sign, Blind), distance/bearing math, grouping, triangulation
  geo.test.ts      unit tests for the math (node --test)
  store.ts         Redis/in-memory storage
  auth.ts          passcode cookie
  compass.ts       shared phone compass (permission, smoothing, useHeading hook)
  declination.ts   magnetic declination (WMM)
  colors.ts        shot palette, deer/sign/blind styles and labels
  time.ts          "Today 11:30 AM" / "2 days ago" formatting
  alert.ts         beep + vibration for alerts
```

## Data model (`lib/geo.ts`)

All entries carry `name` (first name of who reported it), `lat`, `lon`, `accuracy` (GPS ± m, or null),
and `createdAt` (ms). Times are epoch **milliseconds**; bearings are **degrees clockwise from true
north** unless named otherwise.

| Type | Id | Key fields |
|---|---|---|
| `Report` (shot heard) | uuid | `bearingTrue` (what's drawn/used), `bearingInput` + `bearingRef` ("magnetic"/"true") + `declination` (what was entered), `shotTime` |
| `Sighting` (deer) | `sight:<uuid>` | `deer` (buck/doe/fawn/unknown), `count`, `heading` (true; **null = not moving**), `headingInput`, `headingRef`, `declination`, `note`, `time`, optional `observer {lat,lon}` when the spot was picked on the map |
| `Sign` | `sign:<uuid>` | `sign` (ground-scrape/rub/droppings/tracks/bed), `note`, `time` |
| `Blind` | `blind:<uuid>` | `title` (the blind's name), `blind` (tree-stand/ladder-stand/ground-blind/box-blind/other), `note` |

The server converts magnetic → true on POST using WMM declination at that spot and date.
Validation lives in each POST route (name required, coordinates in range, bearings 0–360,
shot/sighting times within the **last 48 h**).

## Storage (`lib/store.ts`)

- **One Redis hash**, key `shot-tracker:reports`. Field = entry id, value = JSON.
  Kind is decided by id prefix (`sight:`, `sign:`, `blind:`, none = shot report).
- The shared Group interval is the reserved field `__settings` → `{"intervalMin": n}` (default 2).
- **Why one hash:** a page refresh is a single `HGETALL` = one Redis command. The Upstash free plan
  allows 500k commands/month; phones poll every 10 s but **pause while hidden/locked**.
- `clearKind("shots" | "sightings" | "signs" | "blinds")` deletes only that kind (`HDEL`).
- Without Redis env vars an in-memory `Map` on `globalThis` is used (lost on restart; the UI shows a
  "No database connected" banner).

## API summary

All routes except login require the cookie `shot_party` = sha256(`shot-tracker:` + lowercase passcode).

| Method | Path | Body / result |
|---|---|---|
| POST | `/api/login` | `{code}` → sets cookie (60 days) |
| GET | `/api/reports` | `{reports, sightings, signs, blinds, intervalMin, hasDatabase}` |
| POST | `/api/reports` | `{name, lat, lon, accuracy?, bearing, bearingRef, shotTime}` |
| POST | `/api/sightings` | `{name, lat, lon, accuracy?, deer, count, heading|null, headingRef, note?, time, observer?}` |
| POST | `/api/signs` | `{name, lat, lon, accuracy?, sign, note?}` |
| POST | `/api/blinds` | `{name, title, blind, lat, lon, accuracy?, note?}` |
| DELETE | `/api/reports/:id` | delete one entry (URL-encode ids with `:`) |
| DELETE | `/api/reports` · `/api/sightings` · `/api/signs` · `/api/blinds` | clear that kind |
| PUT | `/api/settings` | `{intervalMin}` (0.25–60) |

## Grouping and triangulation (`lib/geo.ts`)

**Grouping (`groupShots`)**: reports sorted by `shotTime`; a shot starts at the earliest unassigned
report, and any report within `intervalMin` of that *first* report joins it. Grouping and colors are
computed on each phone from the shared interval.

**Estimate (`triangulate`)**:
1. Flat local projection around the reporters' centroid.
2. Each line has an assumed 1σ error of `BEARING_SIGMA_DEG = 5°`; its sideways error grows with
   distance (`max(dist,100 m) × tan 5°`).
3. Weighted least squares for the point closest to all lines, iterated 6× (weights depend on distance).
4. Covariance → **95 % ellipse** (×√5.991). With 3+ lines, inflated by χ²/dof when lines disagree
   more than ±5° would explain. The list's "±X m" = √(major × minor).
5. **Outliers:** with 3+ lines, each line is checked against the estimate made from the *other* lines
   (leave-one-out). The worst line is excluded if it points away or misses by more than
   `OUTLIER_SIGMAS = 4` (≈ 20°), repeating while ≥3 lines remain. Exclusion is only accepted if the rest
   still gives a valid fix; otherwise all lines are used. Excluded ids are in `fix.excluded` and drawn grey.
6. No estimate if lines are near-parallel, if 2 lines cross behind a listener, or if the point is >20 km away.

Drawing (`ShotMap.tsx` → `ShotLayer`): used lines stop at their along-bearing distance to the estimate;
excluded lines are grey dotted 4 km; shots without an estimate use 4 km lines.

`npm test` covers: perfect and noisy fixes, parallel and crossing-behind cases, grouping, and outlier
handling for 3- and 4-report shots, including "small errors are not outliers".

## Phone compass (`lib/compass.ts`)

- One shared listener for the whole app (`useHeading()` gives the smoothed **magnetic** heading;
  add declination for true). Readings are smoothed on the circle and throttled to about 12 Hz.
- iPhone: `webkitCompassHeading` on `deviceorientation`; needs `DeviceOrientationEvent.requestPermission()`
  **from a tap**. `startCompass()` is called in the "Heard a shot" and 📍 click handlers. Once granted,
  later visits restart quietly on the first tap anywhere (localStorage `st:compass-ok`).
- Android: `deviceorientationabsolute`, heading = 360 − alpha (+ screen angle). `listenCompass()` runs on load.
- Some browsers expose `requestPermission` and answer "prompt"/"denied" even while readings flow, so
  **live readings win over the permission answer**: the UI only says "blocked" if no readings arrive.
- iPhone `webkitCompassAccuracy` > 25° (or −1) shows the "wave in a figure 8" hint.

## UI modes in `App.tsx`

Only one is active at a time; each hides the floating buttons:
- **Quick shot** (`quick`): `QuickShot` overlay; the map gets `liveBearing` (red line from you).
  Time = moment "Heard a shot" was tapped. "Enter manually" opens `ReportForm` with `startedAt`.
- **Crosshair pick** (`pickMode` = "spot" | "heading"): the form stays mounted but hidden, so typed
  values survive. "spot" returns `picked {lat,lon}`; "heading" pulls a line from the deer and returns
  `pickedHeading` (true).
- **Ruler** (`ruler` points array, null = off).

While the ruler or crosshair is active, marker taps feed that tool instead of opening popups
(`TapCtx` + `Pop` in `ShotMap.tsx`).

Other behavior worth knowing:
- Polling every 10 s while visible; immediate refresh when the page becomes visible.
- Alerts: a pop-up for other people's new entries (deer sign and blinds are quiet: no buzz or beep).
  The 🔔 beep is off by default. Your own saves show "✓ … saved".
- The map fits to all data once on first load, then never moves on its own (except Zoom / 📍 / quick shot).
- Per-phone preferences in localStorage: `st:name`, `st:mode`, `st:ref`, `st:layers`, `st:tab`,
  `st:sound`, `st:compass-ok`.
- Deer list and map default to **All days** (a "Today" default once hid back-dated sightings).

## Running and checking changes

```bash
npm install
npm run dev                              # http://localhost:3000 (no passcode, in-memory data)
npm test                                 # math unit tests
npx tsc --noEmit -p . && npm run build   # type-check + production build
PARTY_PASSCODE=t PORT=3123 npx next start   # production server with a passcode, after building
```

UI changes were checked with Playwright (pre-installed in the Claude Code cloud environment) at
iPhone/Pixel sizes, with a fake GPS location (`geolocation` + `permissions`) and simulated compass
readings: dispatch `new Event('deviceorientationabsolute')` with `absolute: true` and `alpha` defined
via `Object.defineProperty`. Map tiles don't load in that sandbox, so screenshots have a grey background.
**Real compass behavior must be checked on real phones.**

## Design decisions (and why)

- **Passcode, not accounts:** simplest for the party, and keeps hunters' positions private. Names are self-declared.
- **No offline mode:** the party chose "good signal, keep simple". Reports fail with a message when there's no connection.
- **Magnetic vs true:** the app handles declination so nobody has to know about it; drawn-on-map
  directions are already true north.
- **Sound off by default:** a beeping phone in a stand could spook deer.
- **Deletes behind confirmation / Edit mode:** deletes are global and permanent.
- **Blind labels show the person's name**; the blind's own name is in the popup.
- **Deer markers** carry a small built-in arrowhead; no long arrows or "spotted from" lines (user feedback).
- **Quick shot keeps the map visible**, with a *fixed* up-arrow (the top of the phone is the pointer).

## Known limitations

- ±5° bearing error is optimistic for sound in hilly woods (10–15° is common), so ellipses may look too tight.
- Echoes can make every bearing wrong in the same way; the math can't detect that.
- Alerts only work while the page is open (no push notifications).
- Typed longitudes in "Enter coordinates" are assumed **West** (North America).
- Only 48 h of back-dating is allowed for shots and sightings.
- Everyone with the passcode can delete anything.

## Ideas discussed but not built

- Make the assumed bearing error a setting (±5/10/15°) or default it to ±10°.
- "I'm in this blind" check-in, and a safety warning when a shot line passes near a party member's blind.
- Optional distance-to-deer field (the crosshair pick covers most of this).
- Offline queue for reports; push notifications for alerts.
