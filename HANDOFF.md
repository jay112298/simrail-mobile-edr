# SimRail Mobile EDR — Session Handoff

Snapshot for resuming work in a fresh Claude Code session. Read this first,
then `git log --oneline -20`.

**Repo:** https://github.com/jay112298/simrail-mobile-edr

---

## 1. Project in one paragraph

Phone-first Electronic Dispatch Record for the SimRail Polish railway
simulator, shipped as a **native Android APK** (Capacitor) that needs no
hosting of any kind. It joins SimRail's live train feed to the scheduled
timetable so a dispatcher sees the trains inside their post's boundary, when
each is booked through, which platform and track it takes, and where it is
routed next. Primary user is a dispatcher; a driver mode is planned.

Stack: React 19 + TypeScript + Vite 8 + Tailwind v4 + Capacitor 8 +
`vite-plugin-pwa` + `oxlint`. **No test runner yet.**

---

## 2. Where the work stands

Phases 0–2 shipped as PRs #1–#9 (data model, ETA countdown, driver badges,
conflict detection, detail sheet, bottom nav, UX polish, server switcher).
Then:

| Phase | PR   | What shipped                                                    |
|-------|------|------------------------------------------------------------------|
| fix   | #10  | Wire train list to selected server                               |
| 4     | #11  | Live SimRail data: `/servers-open` + `/trains-open`, 15 s poll   |
| fix   | —    | NaN ETAs, false red signals, region grouping, server flash       |
| 5     | —    | **Android APK + live timetable + dense views** (branch below)    |
| fix   | —    | Trains standing at the post no longer hidden                     |
| —     | —    | **Station coverage: 7 hardcoded → 61 from the API**              |

Current branch: `phase-5/android-apk-timetable` (not yet merged to `main`).

### Phase 4.5 is CANCELLED — do not build the timetable proxy

Earlier notes said a Cloudflare/Vercel proxy was needed because
`api1.aws.simrail.eu:8082` sends no CORS headers. **Going native removed that
constraint entirely.** CapacitorHttp routes `fetch` through native Java HTTP
where CORS does not apply, and `vite.config.ts` proxies the same paths for
browser development. No serverless anything is required.

### Next up

- **Phase 3 — driver mode.** Now unblocked; the timetable already carries
  `maxSpeed`, `mileage`, `line` and the full stop list.
- **Phase 5 remainder** — conflict notifications, offline cache of last-good
  live responses (timetables are already cached; positions are not).
- **UI/features pass** — the user wants to revisit this once the data layer
  is trusted.

---

## 3. Conventions

- Branches `phase-N/<slug>` or `fix/<slug>`; one PR each; squash-merge.
- Conventional commits (`feat(area):`, `fix(area):`), body wrapped ~72 cols,
  Claude Code co-author trailer on every commit.
- **Never commit unless asked.**
- **Every major update ships the APK too** — run `npm run apk`, commit the
  refreshed `dist-apk/simrail-edr.apk` with the code. The user installs from
  the GitHub page on their phone.
- `npx tsc -b` and `npx oxlint` before pushing; both must exit 0.

---

## 4. Architecture

```
src/
  App.tsx              root: filters, densities, boundary scope, settings
  TrainViews.tsx       dense-row + table renderings
  TrainDetail.tsx      bottom-sheet route + vitals
  data.ts              types, mock fallback, DispatchStation
  lib/
    api.ts             panel API: servers, stations, live trains
    timetable.ts       timetable API + IndexedDB-cached per-train fetch
    useTimetable.ts    server clock + progressive timetable resolution
    useLive.ts         useServers / useStations / useTrains
    enrich.ts          joins live telemetry to booked schedule
    dispatch.ts        ETA, conflict detection, sorting
    ui.ts              shared presentation helpers
    idb.ts             minimal IndexedDB key/value store
```

Runtime flow: pick server → `/stations-open` gives the 61 posts →
`/trains-open` polls live positions every 15 s → each train's timetable is
fetched once (~10 KB) and cached in IndexedDB → `enrich.ts` merges the two →
boundary filter keeps only trains whose timetable names this post in
`supervisedBy`.

---

## 5. Hard-won facts about the data

Do not relearn these the hard way.

- **The in-game clock is not wall time.** `/getTime` runs on its own offset
  (observed several hours behind). Every scheduled comparison uses it; using
  `Date.now()` skews every ETA.
- **`VDDelayedTimetableIndex` is not a position.** It advances to the next
  entry while the train is still standing at the platform. Treating
  "index past the post" as "gone" hid trains that were still at the station.
  `hasClearedPost` requires the index *and* the clock past booked departure.
- **A post controls a run of points, not one.** Skierniewice spans
  `Skierniewice M PZS` → `Skierniewice` → `Skierniewice P PZS`. The
  occupation window spans entry arrival to exit departure.
- **`SignalInFront: null` means no signal data**, and the feed zeroes the
  speed and distance fields alongside it. That is not a red aspect.
- **Station names are the join key**, matched exactly against `supervisedBy`.
  54 of 61 match; the other 7 have no booked traffic and are likely sub-posts
  under a parent name. Station *prefixes* are NOT unique — two share "KO".
- **The whole-server timetable dump is ~21 MB** and the host ignores
  `Accept-Encoding`. Unusable on a phone. Per-train queries are ~10 KB.
- **`supervisedBy` can be a single space**, meaning no controlling post.
  Trim before comparing or it will match a blank station name.

---

## 6. Toolchain on the user's Mac

- System Java is 11 — **too old** for the Android Gradle Plugin. Use
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`
  (JDK 21) and `ANDROID_HOME="$HOME/Library/Android/sdk"`.
- **`gh` is not installed** and there is no token in the environment. PRs and
  Releases cannot be created from the CLI; `git push` works via keychain.
  Push the branch and hand over the `pull/new/<branch>` URL.
- **No emulator AVDs and no attached device**, so an APK built here cannot be
  run or verified locally — only that it builds. Say so rather than implying
  it was tested.

---

## 7. Known gaps

- **No tests.** `enrich.ts` and `dispatch.ts` now hold real algorithms
  (post-run windows, midnight wraparound, conflict overlap). The
  three-consecutive-points bug is exactly what a unit test would have caught.
- **APK is committed to the repo** (~4 MB per update, bloats history). Move to
  GitHub Release assets once `gh` is authenticated.
- **Silent mock fallback.** If the network drops, the app shows the mock train
  set with only a small amber dot as the tell. For a dispatch tool that is
  dangerous — it should say plainly that it is showing sample data.
- **Debug-signed APK**; needs release signing for wider distribution.
- Switching servers refetches ~150 timetables (~30 s) before the list fills.
- Midnight-crossing trains: `wrapDiffSec` handles delay, ETA sorting across
  the boundary is untested.
