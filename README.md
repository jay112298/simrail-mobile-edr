# SimRail Mobile EDR

Phone-first Electronic Dispatch Record for [SimRail](https://simrail.eu). Built to
replace squinting at the in-game timetable: it shows the trains inside your
dispatch boundary, when they are booked through, which platform and track they
take, and where they are routed next.

Ships as a **native Android APK** — no server, no hosting, no browser needed.

---

## Download

**[⬇ Download the Android APK](dist-apk/simrail-edr.apk?raw=1)**

Open this page on your phone and tap the link above. Android will warn about
installing outside the Play Store — allow it for your browser, then install.

The build is a **debug-signed APK**. It installs fine alongside anything else,
but it is not Play Store signed, so Android shows the usual unknown-source
prompt.

### Updating

Check **Settings → Build** in the app; it shows the version and build time, so
you can confirm which APK you are actually running.

If you installed a build from before version `1.0.0 (3)`, **uninstall the app
first** (or Settings → Apps → SimRail EDR → Storage → Clear data) before
installing the new one. Those builds registered a service worker, and Android
keeps app data across an update — so the old worker survives and keeps serving
its cached copy of the old app even though the new APK is installed. Later
builds remove that worker on startup, but the removal only runs once the new
code loads, which is exactly what the stale worker prevents. One clean install
breaks the loop permanently.

---

## What it does

- **Every playable post** — all 61 dispatch posts on the server, searchable,
  with difficulty and whether someone is already manning it.
- **Boundary filtering** — only trains actually routed through your post, using
  the timetable's `supervisedBy` field. A busy station is a couple of dozen
  trains, not the ~150 running server-wide.
- **Real booked times** — arrival and departure at *your* post, platform and
  track, and the onward point plus line number.
- **Live telemetry** — current speed, signal aspect, and distance to the next
  signal, polled every 15 s.
- **Real delay** — computed against the in-game clock, not wall time.
- **Distance to your post** — straight-line, from live train position to the
  station's coordinates.
- **Driver mode** — your own train's full booked route with a "you are here"
  marker, per-stop countdowns, line kilometre posts and speed limits. Enter
  your Steam ID once and it finds your train by itself.
- **Line schematic** — every train within 25 km of your post, plotted by
  kilometre post on each line through it, with direction of travel and signal
  aspect. Pure SVG: no tile server, no dependency, works offline.
- **Audio alerts** — approach warning, player train inbound, new platform
  conflict, train held at a red signal, overdue departure. Each has a distinct
  tone and vibration so it is recognisable without looking. Per-alert toggles,
  adjustable lead time and volume, and a log of what fired.
- **Keep screen awake** — for a phone propped up beside the game.
- **Platform conflict detection** — overlapping occupation windows on the same
  platform are flagged on both trains.
- **Three list densities** — switchable in Settings and remembered, because a
  quiet station and a rush-hour station want different things:

  | Density | Trains on screen | Use when |
  |---|---|---|
  | Dense rows | ~12 | Default. Tap a row to expand its full booked route. |
  | Table | ~20 | Heavy traffic — maximum trains visible at once. |
  | Cards | ~7 | Quiet periods, or when you want live vitals per train. |

---

## Build from source

Requires Node 20+, and for the APK, Android Studio (for its bundled JDK 21 and
the Android SDK).

```bash
npm install
```

### Run in a browser (development)

```bash
npm run dev
```

### Build the APK

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npm run apk
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk` and is
copied to `dist-apk/simrail-edr.apk` for download.

System Java 11 is too old for the Android Gradle Plugin — hence the `JAVA_HOME`
pointing at Android Studio's bundled runtime.

---

## Why native, and not just a PWA

SimRail exposes two APIs:

| Host | Contents | Browser-reachable |
|---|---|---|
| `panel.simrail.eu:8084` | live positions, speed, signals | yes (reflects `Origin`) |
| `api1.aws.simrail.eu:8082` | timetables, server clock | **no — sends no CORS headers at all** |

The timetable host is what makes this a dispatch tool rather than a train
tracker, and no browser can reach it. Capacitor routes `fetch` through native
Java HTTP, where CORS does not apply, so the packaged app reads it directly and
needs no proxy of any kind.

For browser development, `vite.config.ts` proxies the same paths so the code
path is identical in both environments.

### Timetable fetching

`getAllTimetables` for a whole server is ~21 MB uncompressed, takes 35–70 s, and
the host ignores `Accept-Encoding`. Unusable on a phone. Per-train queries are
~10 KB, so the app fetches those with a bounded worker pool and caches them in
IndexedDB — timetables do not change during a server session, so later starts
are effectively instant.

---

## Architecture

```
src/
  App.tsx              root: filters, densities, boundary scope, settings
  TrainViews.tsx       dense-row and table renderings
  TrainDetail.tsx      bottom-sheet route + vitals
  data.ts              types, stations, mock fallback
  lib/
    api.ts             panel API (live positions/signals)
    timetable.ts       timetable API + IndexedDB-cached per-train fetch
    useTimetable.ts    server clock + progressive timetable resolution
    enrich.ts          joins live telemetry to booked schedule
    dispatch.ts        ETA, conflict detection, sorting
    ui.ts              shared presentation helpers
```

### Notes on the data

- The in-game clock runs on its own offset from wall time (observed several
  hours behind). All scheduled comparisons use `/getTime`, never `Date.now()`.
- A dispatch post controls a *run* of points, not one. Skierniewice covers
  `Skierniewice M PZS` → `Skierniewice` → `Skierniewice P PZS`; the occupation
  window spans entry arrival to exit departure.
- `SignalInFront: null` means no signal data, and the feed zeroes the speed and
  distance fields alongside it. That is not a red aspect.
