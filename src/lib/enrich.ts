// Merge live telemetry with the scheduled timetable.
//
// /trains-open says where a train *is*; getAllTimetables says where it is
// *booked to go*. Joined on train number, with VDDelayedTimetableIndex as
// the pointer into the schedule, they produce what a dispatcher actually
// needs: the occupation window at this post, platform and track, the onward
// point and line, and a real delay figure.

import type { Stop, StopType, Train } from '../data'
import type { TimetableStop, TrainTimetable } from './timetable'

const SEC_IN_DAY = 24 * 3600

/**
 * How long after its booked departure a train stays on the list once its
 * timetable index has moved past this post.
 *
 * The index is not a position: it advances to the next entry while the train
 * is still standing at the platform waiting to leave. Treating "index past
 * the exit" as "gone" hid trains that were still sitting at the station,
 * which is exactly when a dispatcher most needs to see them. Erring towards
 * showing a train that just left beats dropping one that has not.
 */
const CLEARED_GRACE_SEC = 10 * 60

/**
 * Signed difference between two seconds-of-day, taking the short way round
 * midnight. Without this a train booked 23:58 read at 00:03 looks 23 h 55 m
 * early instead of 5 m late.
 */
export function wrapDiffSec(a: number, b: number): number {
  let d = a - b
  if (d > SEC_IN_DAY / 2) d -= SEC_IN_DAY
  if (d < -SEC_IN_DAY / 2) d += SEC_IN_DAY
  return d
}

function stopTypeOf(stop: TimetableStop): StopType {
  if (stop.kind === 'commercial') return 'ph'
  if (stop.kind === 'noncommercial') return 'pt'
  return 'tech'
}

function platformLabel(stop: TimetableStop): string {
  if (!stop.platform) return '-'
  return stop.track ? `${stop.platform} ${stop.track}` : stop.platform
}

function toStop(s: TimetableStop): Stop {
  return {
    station: s.point,
    arrival: s.arrival,
    departure: s.departure,
    platform: platformLabel(s),
    type: stopTypeOf(s),
  }
}

/**
 * A post controls a *run* of points, not one point. Skierniewice, for
 * example, covers "Skierniewice M PZS", "Skierniewice" and
 * "Skierniewice P PZS" back to back. Treating only the first as the stop
 * made the onward route resolve to another point of the same station.
 */
export type PostWindow = {
  entryIdx: number
  exitIdx: number
  arrival: string
  departure: string
  arrivalSec: number | null
  departureSec: number | null
  platform: string
  track: number | null
  line: number | null
  maxSpeed: number | null
  onwardPoint?: string
  onwardLine?: number | null
}

/** Index ranges of consecutive stops controlled by `postName`. */
function postRuns(tt: TrainTimetable, postName: string): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  for (let i = 0; i < tt.stops.length; i++) {
    const match = tt.stops[i].supervisedBy === postName
    if (match && start < 0) start = i
    if (!match && start >= 0) {
      runs.push([start, i - 1])
      start = -1
    }
  }
  if (start >= 0) runs.push([start, tt.stops.length - 1])
  return runs
}

/**
 * The post's occupation window for this train.
 *
 * When a train is booked through the same post more than once, prefer the
 * run it has not yet cleared so the display tracks the movement still to be
 * dispatched; otherwise fall back to the final run.
 */
export function findPostWindow(
  tt: TrainTimetable,
  postName: string,
  currentIdx: number,
): PostWindow | null {
  const runs = postRuns(tt, postName)
  if (runs.length === 0) return null
  const run = runs.find(([, exit]) => exit >= currentIdx) ?? runs[runs.length - 1]
  const [entryIdx, exitIdx] = run

  const entry = tt.stops[entryIdx]
  const exit = tt.stops[exitIdx]
  // PZS approach points carry no platform; the station point in the middle
  // of the run is the one that does.
  const withPlatform = tt.stops
    .slice(entryIdx, exitIdx + 1)
    .find((s) => s.platform)
  const onward = tt.stops[exitIdx + 1]

  return {
    entryIdx,
    exitIdx,
    arrival: entry.arrival,
    departure: exit.departure,
    arrivalSec: entry.arrivalSec,
    departureSec: exit.departureSec,
    platform: withPlatform ? platformLabel(withPlatform) : '-',
    track: withPlatform?.track ?? null,
    line: (withPlatform ?? entry).line,
    maxSpeed: (withPlatform ?? entry).maxSpeed,
    onwardPoint: onward?.point,
    onwardLine: onward?.line ?? null,
  }
}

/**
 * Has the train finished with this post?
 *
 * Requires both signals to agree: the timetable index has moved beyond the
 * post's last point, and the clock has run past its booked departure by more
 * than the grace period. A train booked out at 09:34 is still this
 * dispatcher's problem at 09:21 no matter what the index says.
 */
export function hasClearedPost(
  win: PostWindow | null,
  currentIdx: number,
  serverNowSec: number | null,
): boolean {
  if (!win) return false
  if (currentIdx <= win.exitIdx) return false
  // Without a clock or a booked departure there is no safe way to tell, so
  // keep showing it rather than silently dropping it.
  if (serverNowSec === null || win.departureSec === null) return false
  return wrapDiffSec(serverNowSec, win.departureSec) > CLEARED_GRACE_SEC
}

/** Does this train pass through the given dispatch post at all? */
export function passesPost(tt: TrainTimetable, postName: string): boolean {
  return tt.stops.some((s) => s.supervisedBy === postName)
}

/**
 * Fold a timetable into a live train.
 *
 * Sentinels from the live-only mapper ("--:--", "-", 0) are replaced with
 * booked values wherever the schedule supplies them. Anything the timetable
 * genuinely lacks is left alone rather than invented.
 */
export function applyTimetable(
  train: Train,
  tt: TrainTimetable,
  postName: string,
  serverNowSec: number | null,
): Train {
  const idx = train.timetableIndex ?? 0
  const nextStop = tt.stops[idx]
  const win = findPostWindow(tt, postName, idx)

  // Delay is measured at the stop the train is currently working to: how far
  // the clock has run past its booked arrival there.
  let delay = train.delay
  if (serverNowSec !== null && nextStop?.arrivalSec != null) {
    delay = Math.round(wrapDiffSec(serverNowSec, nextStop.arrivalSec) / 60)
  }

  return {
    ...train,
    hasTimetable: true,
    // The window at this post is what the dispatcher plans against: booked
    // entry to booked exit, which is also the platform occupation span used
    // for conflict detection.
    arrival: win?.arrival ?? nextStop?.arrival ?? train.arrival,
    departure: win?.departure ?? nextStop?.departure ?? train.departure,
    platform: win?.platform ?? train.platform,
    track: win?.track ?? null,
    line: win?.line != null ? String(win.line) : train.line,
    maxSpeed: win?.maxSpeed ?? train.maxSpeed,
    delay,
    length: tt.length || train.length,
    weight: tt.weight || train.weight,
    stops: tt.stops.map(toStop),
    nextPoint: nextStop?.point,
    onwardPoint: win?.onwardPoint,
    onwardLine: win?.onwardLine ?? null,
    // Gone only when the index has moved past this post *and* the clock is
    // well past its booked departure. Either signal alone is wrong: the index
    // moves early, and the schedule alone ignores where the train actually
    // is. With no clock or no booked departure, keep the train listed.
    clearedPost: hasClearedPost(win, idx, serverNowSec),
    toPost: win?.onwardPoint ?? train.toPost,
  }
}
