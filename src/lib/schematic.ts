// Line schematic: where every train sits on the line(s) through this post.
//
// Trains report latitude/longitude, but a line diagram is keyed on kilometre
// posts, and the timetable gives coordinates for none of its 392 points. So
// position is derived from the schedule instead: VDDelayedTimetableIndex says
// which stop a train is working to, and the km posts of that stop and the
// previous one bracket it. Elapsed time between the two booked times places
// it in between.
//
// Kilometre posts are per-line and are NOT continuous across a line change,
// so the diagram is built one line at a time. A train appears on the line it
// is on where it passes this post.

import type { Train } from '../data'
import { wrapDiffSec } from './enrich'
import type { EdrTrain } from './edrTimetable'

/** How far either side of the post the diagram reaches. */
export const WINDOW_KM = 25

export type SchematicTrain = {
  train: Train
  /** Interpolated kilometre post on `line`. */
  km: number
  /** +1 when km is increasing, -1 when decreasing, 0 when unknown. */
  direction: 1 | -1 | 0
  /** Absolute distance from the post along the line, in km. */
  distanceKm: number
  /** True when the train is still heading towards the post. */
  approaching: boolean
}

export type SchematicMark = {
  km: number
  name: string
  isPost: boolean
}

export type SchematicLine = {
  line: number
  /** Kilometre post of this dispatch post on this line. */
  postKm: number
  trains: SchematicTrain[]
  marks: SchematicMark[]
}

type Position = { km: number; line: number; direction: 1 | -1 | 0 }

/**
 * Interpolate a train's kilometre post between the stop behind it and the one
 * it is working to. Falls back to the next stop's post when the two straddle
 * a line change, since km posts do not carry across lines.
 */
function currentPosition(
  tt: EdrTrain,
  idx: number,
  nowSec: number | null,
  delayMin: number,
): Position | null {
  const next = tt.stops[idx]
  if (!next || next.line == null || next.offMap) return null
  const prev = tt.stops[idx - 1]

  if (!prev || prev.line !== next.line || prev.offMap) {
    return { km: next.mileage, line: next.line, direction: 0 }
  }

  const direction: 1 | -1 = next.mileage >= prev.mileage ? 1 : -1
  const from = prev.departureSec ?? prev.arrivalSec
  const to = next.arrivalSec
  if (from == null || to == null || nowSec == null) {
    return { km: next.mileage, line: next.line, direction }
  }

  // Booked times are the plan; the train is running `delayMin` behind it, so
  // shift the window before measuring how much of it has elapsed.
  const span = wrapDiffSec(to, from)
  const elapsed = wrapDiffSec(nowSec, from + delayMin * 60)
  const fraction = span > 0 ? Math.min(1, Math.max(0, elapsed / span)) : 1
  return {
    km: prev.mileage + (next.mileage - prev.mileage) * fraction,
    line: next.line,
    direction,
  }
}

/** The post's own kilometre post on a given line, if it sits on it. */
function postKmOnLine(
  tt: EdrTrain,
  pointIds: Set<string>,
  line: number,
): number | null {
  const stop = tt.stops.find(
    (s) => pointIds.has(s.pointId) && s.line === line && !s.offMap,
  )
  return stop ? stop.mileage : null
}

export function buildSchematic(
  trains: Train[],
  edrByNo: Map<string, EdrTrain>,
  pointIds: Set<string>,
  nowSec: number | null,
): SchematicLine[] {
  const byLine = new Map<number, SchematicLine>()

  for (const train of trains) {
    const tt = edrByNo.get(train.number)
    if (!tt) continue

    const pos = currentPosition(
      tt,
      train.timetableIndex ?? 0,
      nowSec,
      train.delay,
    )
    if (!pos) continue

    const postKm = postKmOnLine(tt, pointIds, pos.line)
    if (postKm === null) continue

    const distanceKm = Math.abs(pos.km - postKm)
    if (distanceKm > WINDOW_KM) continue

    const approaching =
      pos.direction === 0
        ? true
        : pos.direction === 1
        ? pos.km < postKm
        : pos.km > postKm

    let group = byLine.get(pos.line)
    if (!group) {
      group = { line: pos.line, postKm, trains: [], marks: [] }
      byLine.set(pos.line, group)
    }
    group.trains.push({
      train,
      km: pos.km,
      direction: pos.direction,
      distanceKm,
      approaching,
    })

    // Reuse this train's schedule to label the line. Any train on the line
    // knows the points on it, so the diagram gains context for free.
    for (const s of tt.stops) {
      if (s.line !== pos.line || s.offMap) continue
      if (Math.abs(s.mileage - postKm) > WINDOW_KM) continue
      if (group.marks.some((m) => m.name === s.point)) continue
      group.marks.push({
        km: s.mileage,
        name: s.point,
        isPost: pointIds.has(s.pointId),
      })
    }
  }

  for (const group of byLine.values()) {
    group.trains.sort((a, b) => a.distanceKm - b.distanceKm)
    group.marks.sort((a, b) => b.km - a.km)
  }

  // Busiest line first — that is the one the dispatcher is working.
  return [...byLine.values()].sort((a, b) => b.trains.length - a.trains.length)
}
