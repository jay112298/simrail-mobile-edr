# SimRail Mobile EDR — Session Handoff

Snapshot for resuming in a fresh Claude Code session, on this or another
machine. Read this first, then `git log --oneline -15`.

**Repo:** https://github.com/jay112298/simrail-mobile-edr
**State:** all work is on `main`; no other branches exist.
**Shipped build:** `1.0.0 (4)` (`versionCode 4`).

---

## 1. Project in one paragraph

Phone-first Electronic Dispatch Record for the SimRail Polish railway
simulator, shipped as a **native Android APK** (Capacitor) that needs no
hosting. It joins SimRail's live train feed to the scheduled timetable so a
dispatcher sees the trains inside their post's boundary — when each is booked
through, which platform and track, where it goes next — plus audio alerts for
the things that need acting on. Also has a driver mode for the train you are
driving yourself.

Stack: React 19 + TypeScript + Vite 8 + Tailwind v4 + Capacitor 8 +
`vite-plugin-pwa` + `oxlint`. **No test runner yet.**

---

## 2. What is built

Phases 0–2 shipped as PRs #1–#9 (data model, ETA countdown, driver badges,
conflict detection, detail sheet, bottom nav, UX polish, server switcher).
Phase 4 (#11) added the live feed. Since then, all on `main`:

| Commit | What |
|---|---|
| `a27fe67` | Android APK via Capacitor, live timetable, three list densities |
| `9be4763` | Fix: trains standing at the post were being hidden |
| `ac20019` | All 61 dispatch posts from the API, not 7 hardcoded |
| `d0a7502` | Driver timetable, Steam ID auto-detect, distance to post |
| `47bd8cc` | Line schematic map |
| `d89a58a` | Fix: stale service worker served the old app after an APK update |
| `8f8eb64` | Audio/haptic dispatcher alerts, keep-screen-awake |

### Feature summary

- **Boundary filtering** — only trains routed through the current post, via
  the timetable's `supervisedBy`.
- **Three list densities** (dense rows / table / cards), persisted.
- **Real booked data** — arrival, departure, platform, track, onward point and
  line, live delay.
- **Platform conflict detection** on real occupation windows.
- **Driver mode** — full booked route, "you are here", per-stop countdowns,
  km posts, speed limits. Steam ID finds your train automatically.
- **Line schematic** — trains within 25 km plotted by km post per line.
- **Audio alerts** — approach, player inbound, new conflict, held at red,
  overdue departure. Distinct tones, per-alert toggles, lead time, volume, log.
- **Keep screen awake** via the Wake Lock API.

### Phase 4.5 is CANCELLED — do not build the timetable proxy

Old notes said a serverless proxy was needed because
`api1.aws.simrail.eu:8082` sends no CORS headers. **Going native removed that
constraint.** CapacitorHttp routes `fetch` through native Java HTTP where CORS
does not apply, and `vite.config.ts` proxies the same paths for browser
development. No proxy of any kind is required.

---

## 3. Conventions

- Work on `main` directly, or `phase-N/<slug>` / `fix/<slug>` branches. Delete
  branches once merged — the repo should not accumulate them.
- Conventional commits (`feat(area):`, `fix(area):`), body wrapped ~72 cols,
  Claude Code co-author trailer on every commit.
- **Never commit unless asked.**
- **Every major update ships the APK too.** Run `npm run apk`, commit the
  refreshed `dist-apk/simrail-edr.apk` with the code. The user installs it
  from the GitHub page on their phone.
- `npx tsc -b` and `npx oxlint` before pushing; both must exit 0.
- User asks for terse output — CAVEMAN MODE. Code, commits, docs and PRs stay
  in normal English.

---

## 4. Architecture

```
src/
  App.tsx              root: filters, densities, boundary scope, settings
  TrainViews.tsx       dense-row + table renderings
  TrainDetail.tsx      bottom-sheet route + vitals
  DriverView.tsx       driver mode: one train's whole booked route
  SchematicMap.tsx     line diagram (pure SVG)
  data.ts              types, mock fallback, DispatchStation
  build-info.json      generated per APK build; shown in Settings
  lib/
    api.ts             panel API: servers, stations, live trains
    timetable.ts       timetable API + IndexedDB-cached per-train fetch
    useTimetable.ts    server clock + progressive timetable resolution
    useLive.ts         useServers / useStations / useTrains
    enrich.ts          joins live telemetry to booked schedule
    dispatch.ts        ETA, conflict detection, sorting
    schematic.ts       km-post positions for the line diagram
    alerts.ts          alert rules + tone/vibration specs
    useAlerts.ts       alert firing (edge-triggered) + wake lock
    sound.ts           Web Audio tone synthesis
    geo.ts             haversine distance
    ui.ts              shared presentation helpers
    idb.ts             minimal IndexedDB key/value store
    storage.ts         useLocalStorage
scripts/
  bump-android-version.mjs   increments versionCode on every APK build
```

Runtime flow: pick server → `/stations-open` gives 61 posts → `/trains-open`
polls live positions every 15 s → each train's timetable fetched once (~10 KB)
and cached in IndexedDB → `enrich.ts` merges → boundary filter keeps trains
whose timetable names this post in `supervisedBy` → alerts watch the result.

---

## 5. Hard-won facts about the data

Every one of these cost real debugging. Do not relearn them.

- **The in-game clock is not wall time.** `/getTime` runs on its own offset
  (observed several hours behind). All scheduled comparisons use it. Using
  `Date.now()` skews every ETA.
- **`VDDelayedTimetableIndex` is not a position.** It advances to the next
  entry while the train is still standing at the platform. Judging "cleared"
  on the index alone hid trains that were still at the station — measured at
  seven wrongly hidden in one sample. `hasClearedPost` requires the index
  *and* the clock past booked departure, with a 10-minute grace.
- **A post controls a run of points, not one.** Skierniewice spans
  `Skierniewice M PZS` → `Skierniewice` → `Skierniewice P PZS`. The occupation
  window is entry arrival to exit departure — which is also what makes
  conflict detection work at all.
- **`SignalInFront: null` means no signal data**, and the feed zeroes speed
  and distance alongside it. That is not a red aspect.
- **Off-map stops are stubs.** Points outside the simulated area come back as
  `line 0, mileage 0, platform "I", track 2` — identical on every one.
  Rendering them verbatim invents a platform assignment.
- **`mileage` is a line kilometre post, not route distance.** It resets across
  lines and is not monotonic within one. Never use it to compute a distance;
  the schematic works per line for this reason.
- **Station names are the join key**, matched exactly against `supervisedBy`.
  54 of 61 match; the other 7 have no booked traffic and appear to be
  sub-posts under a parent. Station *prefixes* are NOT unique — two share "KO".
- **`supervisedBy` can be a single space**, meaning no controlling post. Trim
  before comparing.
- **The whole-server timetable dump is ~21 MB** and the host ignores
  `Accept-Encoding`. Unusable on a phone. Per-train queries are ~10 KB; fetch
  those with a bounded pool and cache them.
- **Never register a service worker in the native build.** Android keeps app
  data across an APK update, so a worker from an older build survives and
  serves its precached bundle — you install an update and still see the old
  app. `main.tsx` unregisters on native; `injectRegister: null` stops the
  plugin re-adding one.
- **Alerts must not fire before data settles.** Timetables stream in over
  ~30 s; a set primed before then reads every train as new and bursts (eight
  on one reload). Gate on live trains present, `timetablePending === 0`, and
  a synced clock.
- **Tailwind cannot see runtime-built class names.** `` `fill-${x}` `` or
  `.replace('bg-','fill-')` renders unstyled in the production APK while
  looking fine in dev. Use literal classes or real colour values.

---

## 6. Toolchain

Currently developed on a Mac. On **another machine**, sections 1–5 all apply,
but re-check the following locally.

```sh
git clone https://github.com/jay112298/simrail-mobile-edr.git
cd simrail-mobile-edr
npm install
npx tsc -b && npx oxlint     # both should exit 0
npm run dev                  # http://localhost:5173
```

For the APK you need Android Studio (its bundled JDK 21) and the Android SDK:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npm run apk
```

Adjust both paths on Linux/Windows. `android/local.properties` holds `sdk.dir`
and is machine-specific — regenerate it if the SDK lives elsewhere.

Known constraints on the Mac used so far, which may differ elsewhere:

- **System Java 11 is too old** for the Android Gradle Plugin; use the JDK
  bundled with Android Studio.
- **`gh` is not installed** and there is no token in the environment, so PRs
  and Releases cannot be created from the CLI. `git push` works via the
  osxkeychain helper.
- **No emulator AVDs and no attached device**, so an APK built there could
  only be verified as *built*, never *run*. Say so rather than implying it was
  tested.

**Verify the APK, do not assume.** Unzip and grep for a string unique to the
new work:

```sh
unzip -p dist-apk/simrail-edr.apk 'assets/public/assets/*.js' | grep -c "Audio alerts"
```

A green Gradle build says nothing about whether the web assets were re-synced.

---

## 7. Future scope

### A. Trust the numbers — highest priority

The app now makes claims a dispatcher acts on. These are what could make it
lie.

| Gap | Why it matters |
|---|---|
| **No test runner** | `enrich.ts`, `schematic.ts`, `dispatch.ts`, `alerts.ts` hold real algorithms — interpolation, midnight wraparound, post-run windows, conflict overlap, edge-triggered alerting. Every serious bug so far was of exactly the kind a unit test catches and a screenshot does not. |
| **Never run on a device** | Builds and bundles verified; runtime unproven. The stale-service-worker bug was invisible in the browser and only appeared on a phone. |
| **Midnight wraparound untested** | `wrapDiffSec` handles delay, but ETA sorting across 00:00 has never been exercised. |
| **Trains with no timetable are invisible** | Dropped entirely under boundary filter. Settings reports the count; they are still gone. |
| **Debug signing + APK in git** | Not release-signed; ~4 MB per update accumulating in history forever. Move to GitHub Releases once `gh` is authenticated. |

### B. Alerts — partly done

Shipped: five alert kinds, tones, vibration, per-alert toggles, lead time,
volume, log, keep-awake.

Left:

- **Background alerts.** WebView audio suspends when Android backgrounds the
  app, so alerts only fire in the foreground. Needs
  `@capacitor/local-notifications` plus `POST_NOTIFICATIONS` on Android 13+,
  or a foreground service. Real native work.
- **Tone tuning** — never heard on a real device against game audio.

### C. Views worth building

- **Time–distance graph** (*wykres ruchu*) — time across, distance along the
  line down, each train a diagonal; crossings show meets. This is the tool
  real dispatchers plan with, and all the data is already present (booked
  times + km posts, plus live position to overlay actual against booked).
  Pure SVG like the schematic. **Highest-value remaining feature.**
- **Landscape layout** — a propped-up phone is the natural setup.
- **Acknowledge/handled flag per train** — it is a dispatch *record* that
  currently records nothing the dispatcher did.

### D. Smaller items

- Filter by line (useful at a junction post).
- Faster server switch (~30 s to refetch ~150 timetables today).
- Offline cache of last-good live positions (timetables already cached).
- Multi-post stations: several posts share one station name today.

---

## 8. Suggested order

1. **Tests** — locks down the algorithms everything else rides on
2. **Time–distance graph**
3. **Release signing + APK to Releases**
4. **Background notifications**, landscape, acknowledge flag

The user has been asked twice whether to do tests first and has preferred
shipping features; do not assume — ask.
