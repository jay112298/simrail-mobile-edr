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
    // True once the train has worked past the last point this post controls,
    // i.e. it is no longer this dispatcher's problem.
    clearedPost: win ? idx > win.exitIdx : false,
    toPost: win?.onwardPoint ?? train.toPost,
  }
}
