# SimRail Mobile EDR — Session Handoff

Snapshot for resuming work in a fresh Claude Code session (e.g. on a different machine). Read this first, then `git log --oneline -20` for recent activity.

**Repo:** https://github.com/jay112298/simrail-mobile-edr
**Origin baseline for this handoff:** `main` @ PR #11 merged (Phase 4 live API).

---

## 1. Project in one paragraph

Phone-first PWA that acts as an Electronic Dispatch Record (EDR) for the SimRail Polish railway simulator. Runs in the browser, installable to home screen, no server of its own. Data comes from SimRail's public panel API (`panel.simrail.eu:8084`) with a mock fallback so first paint is never empty. Primary user is a dispatcher; a train-driver mode is planned but not built.

Stack: React 19 + TypeScript + Vite 8 + Tailwind v4 + `vite-plugin-pwa` (autoUpdate) + `oxlint`. No test runner yet.

---

## 2. Where the work stands

Phases finished (each is one squash-merged PR — see `git log`):

| Phase | PR  | What shipped                                                                |
|-------|-----|-----------------------------------------------------------------------------|
| 0     | #1  | Expanded data model (Station, Post, Platform, Stop, Train priority, etc.)  |
| 1a    | #2  | Live ETA countdown + auto-sort by ETA                                       |
| 1b    | #3  | PLAYER/AI driver badge + Player filter                                      |
| 1c    | #4  | Platform-conflict detection (window-overlap)                                |
| 1d    | #5  | TrainDetail bottom-sheet on card tap                                        |
| 1e    | #6  | Bottom nav wired to view state                                              |
| 2 (a) | #7  | Priority chip, sticky header fix, font bumps, empty-state CTA               |
| 2 (b) | #8  | Filter counts, haptic taps, persist state via `useLocalStorage`             |
| 2C    | #9  | Server switcher UI (bottom-sheet picker)                                    |
| fix   | #10 | Wire train list to selected server (deterministic mock jitter)              |
| 4     | #11 | Live SimRail data: `/servers-open` + `/trains-open` polled every 15 s       |

**Next per plan:**
- **Phase 3 — Driver mode** (deferred, needs Phase 4.5 first). Route timetable, next signal, speed profile.
- **Phase 4.5 — Timetable proxy.** `api1.aws.simrail.eu:8082/api/getAllTimetables` has scheduled arrival/departure/platform but **no CORS headers**, so the browser can't hit it directly. Need a tiny serverless proxy (Cloudflare Worker or Vercel Edge — pick one). Until then, live trains show `--:--` and `-` for arr/dep/platform.
- **Phase 5 — PWA polish.** Offline cache of last-good API responses, notifications for new platform conflicts.

---

## 3. Conventions to follow

- **Branch strategy:** `main` + short-lived `phase-N/<slug>` or `fix/<slug>` branches. One PR per branch. Squash-merge. Delete branch on merge.
- **Commit style:** conventional prefixes (`feat(area): ...`, `fix(area): ...`, `chore: ...`). Wrap body at ~72 cols. End every commit with the Claude Code co-author trailer.
- **PR body:** `## Summary` bullets + `## Test plan` checklist. Same trailer.
- **User asks for terse output** — CAVEMAN MODE (skill fires each turn). Fragments OK in chat, but code / commit messages / docs / PRs stay in normal English.
- **Never commit unless the user asks.** They've been explicit about that. When the plan clearly says "merge and continue", proceeding without asking each time is fine.
- **On Termux (Android phone):** `npm run build` takes 2–3 min because arm64 mobile is slow. `npx tsc -b` and `npx oxlint` finish in seconds and are usually sufficient before pushing.
- **Never `git push --force` on `main`.** Rebase locally, force-push to feature branches only if needed.

---

## 4. Architecture map

Directory layout that matters:

```
src/
  App.tsx                 — root component (filters, sticky header, bottom nav, modals)
  TrainDetail.tsx         — bottom-sheet route + vitals view
  InstallPrompt.tsx       — PWA install banner (untouched since baseline)
  data.ts                 — Types + STATIONS + SERVERS + TRAINS mock + trainsForServer()
  lib/
    dispatch.ts           — useSimNow(), computeETASec(), detectConflicts(), sortByETA()
    api.ts                — SimRail panel API client + type mappers
    useLive.ts            — useServers() + useTrains(code) hooks (polling)
    storage.ts            — useLocalStorage<T> (prefix "simrail-edr:")
    haptic.ts             — hapticTap() — navigator.vibrate no-op fallback
```

Key runtime pattern:

1. `App` reads `serverCode` from `useLocalStorage('server', ...)`.
2. `useTrains(currentServer.code)` polls `/trains-open?serverCode=...` every 15 s. Aborts on unmount / server change.
3. First-paint fallback = `trainsForServer(code)` (deterministic hash-jittered subset of the mock `TRAINS` array).
4. `detectConflicts(trains)`, `sortByETA(trains, nowSec)`, and `filterCounts` all recompute via `useMemo` on `trains` or `nowSec`.
5. `useSimNow()` ticks at 1 Hz and is anchored to `MOCK_ANCHOR_SEC = 8*3600` so the mock timetable stays "current-looking" until real timetable data replaces it.

---

## 5. Known gaps / gotchas

- **Mock-time anchoring** (`MOCK_ANCHOR_SEC` in `src/lib/dispatch.ts`) — swap to wall clock when the timetable proxy lands; today it pins to 08:00 sim-time so the demo works.
- **Live trains lack timetable fields.** `arr`, `dep`, `platform`, `line`, `length`, `weight`, `distance`, `delay`, `stops[]` are all sentinels (`--:--`, `-`, `0`) for API-sourced trains. See mapper in `src/lib/api.ts::mapTrain`.
- **Signal state mapping** is heuristic (`SignalInFrontSpeed`): `0 → red`, `32767 → green`, `>0 && <32767 → yellow`. Confirm against SimRail source if it starts feeling wrong.
- **Driver detection**: SimRail returns `Type: "user" | "bot"`. We map `user → player`, `bot → bot` (internal type is `Driver = 'player' | 'bot'`).
- **CORS on panel API** reflects `Origin` — dev (`http://localhost:5173`) and any prod origin both work. The timetable host does not.

---

## 6. How to resume on a new machine

```sh
# 1. Clone
git clone https://github.com/jay112298/simrail-mobile-edr.git
cd simrail-mobile-edr

# 2. Install
npm install

# 3. Verify the toolchain
npx tsc -b         # should exit 0
npx oxlint         # should exit 0
npm run dev        # http://localhost:5173

# 4. Confirm GitHub CLI auth (needed to open PRs the same way)
gh auth status
```

Then open a fresh Claude Code session in the repo and paste:

> Read `HANDOFF.md`. We were mid-way through the plan. Next phase is 4.5 (timetable proxy) or 5 (PWA polish) — user's call. Follow the conventions in section 3.

That is enough context. Do **not** try to import the old chat JSONL — the working-directory-hashed path won't match on a new machine and Claude Code won't load it.

---

## 7. Optional: audit trail

The full pre-handoff transcript lives locally at:

```
~/.claude/projects/<hashed-cwd>/<session-id>.jsonl
```

on the Termux machine. It is **not** portable to another machine's Claude Code and cannot be imported into the Claude.ai desktop app. Treat this document + `git log` as the authoritative history.
