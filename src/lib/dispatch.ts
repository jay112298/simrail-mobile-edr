import { useEffect, useState } from 'react'
import type { Train } from '../data'

// Mock time anchor: pretend now = 08:00 when app mounts, tick from there.
// When live API integrates, swap useSimNow for wall clock.
const MOCK_ANCHOR_SEC = 8 * 3600

const SECONDS_IN_DAY = 24 * 3600

const HHMM = /^(\d{1,2}):(\d{2})$/

/**
 * Parse "HH:MM" into seconds-of-day.
 *
 * Returns null for anything that is not a real time — notably the "--:--"
 * sentinel that live API trains carry until the timetable feed lands.
 * Callers must treat null as "no timetable", not as zero: coercing it to a
 * number is what produced NaN ETAs on every live card.
 */
export function hhmmToSec(hhmm: string): number | null {
  const m = HHMM.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 3600 + min * 60
}

/**
 * Ticking simulated clock. Seconds-of-day (0–86399), advances 1/s.
 */
export function useSimNow(): number {
  const [now, setNow] = useState<number>(MOCK_ANCHOR_SEC)
  useEffect(() => {
    const mountedAt = Date.now()
    const id = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - mountedAt) / 1000)
      setNow((MOCK_ANCHOR_SEC + elapsedSec) % SECONDS_IN_DAY)
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/**
 * Seconds until the actionable moment for this train.
 * - standing: seconds to departure (dispatcher waits for slot to clear)
 * - else: seconds to arrival + delay
 * Negative = in the past. Null when the train has no timetable.
 */
export function computeETASec(train: Train, nowSec: number): number | null {
  // Count down to departure only for a train standing *here*. `status` alone
  // says "stopped somewhere", so a train held at a red fifty kilometres away
  // was counting down to this post's departure time instead of its arrival.
  const standingHere =
    train.live &&
    train.speed === 0 &&
    train.postStopIndex != null &&
    train.timetableIndex === train.postStopIndex
  const target = standingHere
    ? hhmmToSec(train.departure)
    : hhmmToSec(train.arrival)
  if (target === null) return null
  const withDelay = target + train.delay * 60
  return withDelay - nowSec
}

export type Urgency = 'past' | 'now' | 'imminent' | 'soon' | 'later' | 'unknown'

export function etaUrgency(sec: number | null): Urgency {
  if (sec === null) return 'unknown'
  if (sec < -30) return 'past'
  if (sec <= 30) return 'now'
  if (sec <= 120) return 'imminent'
  if (sec <= 300) return 'soon'
  return 'later'
}

/**
 * Human label for ETA. Format tuned for at-a-glance dispatch scan.
 */
export function etaLabel(sec: number | null): string {
  if (sec === null) return '—'
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  if (sec < -30) {
    if (m === 0) return `${s}s ago`
    if (m < 60) return `${m}m ago`
    return `${Math.floor(m / 60)}h ago`
  }
  if (sec <= 30) return 'now'
  if (sec < 60) return `in ${s}s`
  if (sec < 600) return `in ${m}m ${s.toString().padStart(2, '0')}s`
  return `in ${m}m`
}

// Platform sentinels that don't participate in conflict detection
// (freight sidings / unassigned).
const NON_CONFLICT_PLATFORMS = new Set(['-', 'Tow.', ''])

/**
 * A train holds the platform for at least this long even when booked to run
 * straight through. Booked arrival and departure are identical for a
 * pass-through, and a zero-length window can never overlap anything — so two
 * trains booked through the same platform a minute apart raised no conflict
 * at all.
 */
const MIN_OCCUPATION_SEC = 90

/**
 * Required clearance between one train leaving a platform and the next
 * arriving. Back-to-back movements do not overlap arithmetically but are
 * still a conflict in practice.
 */
const HEADWAY_SEC = 120

/**
 * Projected occupation window: [arrival, departure] shifted by the delay the
 * train is actually running, in sec-of-day.
 *
 * Using projected rather than booked times is what makes the interesting case
 * work: a train booked 12:00 and one booked 12:30 do not clash, but if the
 * first is running 30 late it arrives into the second's slot and they do.
 */
export function trainWindowSec(train: Train): [number, number] | null {
  const arr = hhmmToSec(train.arrival)
  const dep = hhmmToSec(train.departure)
  if (arr === null || dep === null) return null
  // Normalise the start into the day. A late train booked near midnight
  // otherwise produces a start beyond 24:00, which compares against nothing.
  const start =
    (((arr + train.delay * 60) % SECONDS_IN_DAY) + SECONDS_IN_DAY) %
    SECONDS_IN_DAY
  // Departure before arrival means the booked window wraps midnight.
  const booked = dep >= arr ? dep - arr : dep + SECONDS_IN_DAY - arr
  return [start, start + Math.max(booked, MIN_OCCUPATION_SEC)]
}

/**
 * Do two occupation windows clash, allowing for the day boundary?
 *
 * Windows are seconds-of-day, so a train at 23:58 and one at 00:03 are five
 * minutes apart but nearly a full day apart arithmetically. Testing the
 * neighbouring days as well catches that; a genuinely distant pair stays
 * distant under every offset, because the windows are only minutes long.
 */
export function windowsClash(
  a: [number, number],
  b: [number, number],
): boolean {
  for (const shift of [-SECONDS_IN_DAY, 0, SECONDS_IN_DAY]) {
    const b1 = b[0] + shift
    const b2 = b[1] + shift
    if (a[0] < b2 + HEADWAY_SEC && b1 < a[1] + HEADWAY_SEC) return true
  }
  return false
}

export type ConflictMap = Map<string, string[]>

/**
 * For each pair of trains sharing a platform with overlapping windows,
 * record the conflict. Returns train.number → conflicting train numbers.
 */
/**
 * Can these two occupy the same piece of railway?
 *
 * Grouping used to key on the displayed label, so "II" and "II 1" hashed
 * apart and a train with an unknown track was never compared against one on
 * a known track at the same platform. Different *known* tracks genuinely do
 * not conflict; an unknown track might be either, so it is not ruled out.
 */
function sharesTrack(a: Train, b: Train): boolean {
  if (a.track != null && b.track != null) return a.track === b.track
  return true
}

export function detectConflicts(trains: Train[]): ConflictMap {
  const byPlatform = new Map<string, Train[]>()
  for (const t of trains) {
    // Group on the bare platform, falling back to the label for trains that
    // never carried a separate platform id.
    const key = t.platformId ?? t.platform
    if (NON_CONFLICT_PLATFORMS.has(key) || NON_CONFLICT_PLATFORMS.has(t.platform))
      continue
    const list = byPlatform.get(key) ?? []
    list.push(t)
    byPlatform.set(key, list)
  }
  const conflicts: ConflictMap = new Map()
  for (const list of byPlatform.values()) {
    if (list.length < 2) continue
    // Windows are per-train; computing them once avoids repeating the work
    // for every pair, which is quadratic on a busy platform.
    const windows = list.map(trainWindowSec)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const wa = windows[i]
        const wb = windows[j]
        // No timetable → no occupation window → nothing to overlap.
        if (!wa || !wb) continue
        if (!sharesTrack(list[i], list[j])) continue
        if (windowsClash(wa, wb)) {
          const na = list[i].number
          const nb = list[j].number
          conflicts.set(na, [...(conflicts.get(na) ?? []), nb])
          conflicts.set(nb, [...(conflicts.get(nb) ?? []), na])
        }
      }
    }
  }
  return conflicts
}

/**
 * Sort trains for dispatcher: future ETA ascending (nearest first),
 * past pushed to bottom (ascending by past distance).
 * Tiebreak by priority (lower number = higher class).
 *
 * Trains with no timetable sort below every scheduled train, by class then
 * number — otherwise a null ETA would make the comparator inconsistent and
 * leave the whole list in arbitrary feed order.
 */
export function sortByETA(trains: Train[], nowSec: number): Train[] {
  return [...trains].sort((a, b) => {
    const ea = computeETASec(a, nowSec)
    const eb = computeETASec(b, nowSec)
    if (ea === null || eb === null) {
      if (ea !== eb) return ea === null ? 1 : -1
      return a.priority - b.priority || a.number.localeCompare(b.number)
    }
    const aPast = ea < -30
    const bPast = eb < -30
    if (aPast !== bPast) return aPast ? 1 : -1
    if (ea !== eb) return ea - eb
    return a.priority - b.priority
  })
}
