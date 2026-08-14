// Merge live telemetry with the scheduled timetable.
//
// /trains-open says where a train *is*; getAllTimetables says where it is
// *booked to go*. Joined on train number, with VDDelayedTimetableIndex as
// the pointer into the schedule, they produce what a dispatcher actually
// needs: the occupation window at this post, platform and track, the onward
// point and line, and a real delay figure.

import type { Stop, StopType, Train } from '../data'
import { classifyTrain } from './api'
import type { EdrStop, StationRow } from './edrTimetable'
import { wrapDiff } from './edrTimetable'

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

function edrPlatform(stop: EdrStop): string {
  if (!stop.platform) return '-'
  return stop.track ? `${stop.platform} ${stop.track}` : stop.platform
}

function edrStopType(stop: EdrStop): StopType {
  if (stop.kind === 'commercial') return 'ph'
  if (stop.kind === 'technical') return 'pt'
  return 'tech'
}

function edrToStop(s: EdrStop): Stop {
  return {
    station: s.point,
    arrival: s.arrival,
    departure: s.departure,
    platform: edrPlatform(s),
    type: edrStopType(s),
  }
}

/**
 * Turn a station timetable row into the view model, merging live telemetry
 * when that train happens to be running.
 *
 * This is the right way round: the row exists because the train is *booked*
 * through this station, and live data decorates it. Building the list from
 * running trains instead meant a post only ever showed the handful currently
 * spawned — 41 of 487 at Skierniewice on a sample.
 */
export function rowToTrain(
  row: StationRow,
  live: Train | undefined,
  serverNowSec: number | null,
): Train {
  const { train, stop, prev, next } = row
  const cls = classifyTrain(train.trainName, train.trainNo)

  // Delay, best source first: where the train actually is now, else what
  // SimRail recorded for this stop, else unknown.
  let delay = 0
  if (live && serverNowSec !== null) {
    const at = train.stops[live.timetableIndex ?? -1]
    if (at?.arrivalSec != null) {
      delay = Math.round(wrapDiff(serverNowSec, at.arrivalSec) / 60)
    }
  } else if (stop.actualArrivalSec != null && stop.arrivalSec != null) {
    delay = Math.round(wrapDiff(stop.actualArrivalSec, stop.arrivalSec) / 60)
  }

  return {
    number: train.trainNo,
    type: stop.trainType || cls.type,
    category: cls.category,
    driver: live?.driver ?? 'bot',
    priority: cls.priority,
    line: stop.line != null ? String(stop.line) : '-',
    from: prev?.point ?? train.startStation,
    toPost: next?.point ?? train.endStation,
    arrival: stop.arrival,
    departure: stop.departure,
    platform: edrPlatform(stop),
    track: stop.track,
    delay,
    // A train with no live record has not spawned yet — it is booked, not running.
    status: live ? (live.speed === 0 ? 'standing' : 'enroute') : 'scheduled',
    distance: live?.distance ?? 0,
    length: 0,
    weight: 0,
    speed: live?.speed ?? 0,
    maxSpeed: stop.maxSpeed ?? 0,
    signalState: live?.signalState ?? 'unknown',
    stops: train.stops.map(edrToStop),

    live: Boolean(live),
    hasTimetable: true,
    timetableIndex: live?.timetableIndex,
    nextPoint: live ? train.stops[live.timetableIndex ?? 0]?.point : undefined,
    onwardPoint: next?.point,
    onwardLine: next?.line ?? null,
    signalDistance: live?.signalDistance,
    signalSpeed: live?.signalSpeed,
    vehicles: live?.vehicles,
    controlledBy: live?.controlledBy,
    lat: live?.lat,
    lon: live?.lon,
    // The train has finished with this station once it has worked past this
    // stop; used for an opt-in filter, never to hide rows outright.
    postStopIndex: stop.index,
    clearedPost:
      live?.timetableIndex != null && live.timetableIndex > stop.index,
  }
}
