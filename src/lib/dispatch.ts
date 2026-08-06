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
  const target =
    train.status === 'standing'
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
 * Occupation window for a train: [arrival+delay, departure+delay] in sec-of-day.
 * Null when the train has no timetable to derive a window from.
 */
export function trainWindowSec(train: Train): [number, number] | null {
  const arr = hhmmToSec(train.arrival)
  const dep = hhmmToSec(train.departure)
  if (arr === null || dep === null) return null
  return [arr + train.delay * 60, dep + train.delay * 60]
}

export type ConflictMap = Map<string, string[]>

/**
 * For each pair of trains sharing a platform with overlapping windows,
 * record the conflict. Returns train.number → conflicting train numbers.
 */
export function detectConflicts(trains: Train[]): ConflictMap {
  const byPlatform = new Map<string, Train[]>()
  for (const t of trains) {
    if (NON_CONFLICT_PLATFORMS.has(t.platform)) continue
    const list = byPlatform.get(t.platform) ?? []
    list.push(t)
    byPlatform.set(t.platform, list)
  }
  const conflicts: ConflictMap = new Map()
  for (const list of byPlatform.values()) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const wa = trainWindowSec(list[i])
        const wb = trainWindowSec(list[j])
        // No timetable → no occupation window → nothing to overlap.
        if (!wa || !wb) continue
        const [a1, a2] = wa
        const [b1, b2] = wb
        if (a1 < b2 && b1 < a2) {
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
