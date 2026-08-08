// Dispatcher alerts: what is worth interrupting someone for.
//
// Detection is a pure function of the current state. It returns the set of
// conditions true *right now*; the hook fires a sound only when a key enters
// that set, so an alert sounds once per event rather than on every 15-second
// poll. When a condition clears and returns, it is a new event and sounds
// again — which is correct: a train held at red twice is two problems.

import type { Train } from '../data'
import { hhmmToSec } from './dispatch'
import { wrapDiffSec } from './enrich'
import type { ToneStep } from './sound'

export type AlertKind = 'player' | 'approach' | 'conflict' | 'held' | 'overdue'

export type AlertSettings = {
  enabled: boolean
  volume: number
  /** How far ahead of booked arrival an approach alert fires, in minutes. */
  leadMinutes: number
  kinds: Record<AlertKind, boolean>
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: false,
  volume: 0.5,
  leadMinutes: 5,
  kinds: {
    player: true,
    approach: true,
    conflict: true,
    held: true,
    overdue: true,
  },
}

export type ActiveAlert = {
  key: string
  kind: AlertKind
  trainNo: string
  message: string
}

export const ALERT_LABEL: Record<AlertKind, string> = {
  player: 'Player train approaching',
  approach: 'Train approaching',
  conflict: 'New platform conflict',
  held: 'Train held at red',
  overdue: 'Overdue departure',
}

export const ALERT_HINT: Record<AlertKind, string> = {
  player: 'A human driver is inbound — they need a route sooner than AI.',
  approach: 'Any train nearing its booked arrival at this post.',
  conflict: 'Two trains booked onto the same platform at overlapping times.',
  held: 'Stopped at a red signal near the post — usually a route not set.',
  overdue: 'Standing past its booked departure.',
}

// Distinct shapes so alerts are distinguishable without looking at the phone.
const TONES: Record<AlertKind, ToneStep[]> = {
  // Bright triple rise — the one that most wants attention.
  player: [
    { freq: 784, duration: 0.1 },
    { freq: 988, duration: 0.1 },
    { freq: 1319, duration: 0.16 },
  ],
  // Soft two-note rise.
  approach: [
    { freq: 587, duration: 0.1 },
    { freq: 880, duration: 0.14 },
  ],
  // Low urgent double buzz.
  conflict: [
    { freq: 233, duration: 0.16, gap: 0.07 },
    { freq: 233, duration: 0.16, gap: 0.07 },
    { freq: 185, duration: 0.22 },
  ],
  // Insistent low repeat.
  held: [
    { freq: 311, duration: 0.13, gap: 0.06 },
    { freq: 311, duration: 0.13, gap: 0.06 },
    { freq: 311, duration: 0.13 },
  ],
  // Single flat mid tone.
  overdue: [{ freq: 466, duration: 0.26 }],
}

export function tonesFor(kind: AlertKind): ToneStep[] {
  return TONES[kind]
}

const VIBRATION: Record<AlertKind, number | number[]> = {
  player: [60, 50, 60, 50, 90],
  approach: [50, 60, 70],
  conflict: [120, 70, 120, 70, 160],
  held: [90, 60, 90],
  overdue: 140,
}

export function vibrationFor(kind: AlertKind): number | number[] {
  return VIBRATION[kind]
}

/** Only alert on trains actually near the post, when we know how near. */
const HELD_RADIUS_KM = 10
const OVERDUE_RADIUS_KM = 3

function withinKm(train: Train, km: number): boolean {
  // distance is 0 when unknown (no coordinates yet) — do not silence the
  // alert on missing data, only on data that says the train is far away.
  return train.distance <= 0 || train.distance <= km
}

/** Seconds until the train's booked arrival at this post, allowing for delay. */
function secondsToArrival(train: Train, nowSec: number): number | null {
  const arrival = hhmmToSec(train.arrival)
  if (arrival === null) return null
  return wrapDiffSec(arrival + train.delay * 60, nowSec)
}

export function detectAlerts(
  trains: Train[],
  conflicts: Map<string, string[]>,
  nowSec: number | null,
  settings: AlertSettings,
): ActiveAlert[] {
  if (!settings.enabled || nowSec === null) return []
  const out: ActiveAlert[] = []
  const lead = settings.leadMinutes * 60

  for (const t of trains) {
    if (t.clearedPost) continue

    const eta = secondsToArrival(t, nowSec)
    if (eta !== null && eta > 0 && eta <= lead) {
      // A human driver is the more urgent case, so it replaces rather than
      // doubles the generic approach alert for the same train.
      const kind: AlertKind = t.driver === 'player' ? 'player' : 'approach'
      if (settings.kinds[kind]) {
        out.push({
          key: `${kind}:${t.number}`,
          kind,
          trainNo: t.number,
          message: `${t.number} due ${t.arrival}${t.platform !== '-' ? ` · pl ${t.platform}` : ''}`,
        })
      }
    }

    // Held and overdue describe a train that is *running*. The list now holds
    // the whole booked schedule, and a train that has not spawned reports
    // speed 0 with no signal — without this guard every booked train whose
    // departure time has passed would raise an overdue alert at once.
    if (
      settings.kinds.held &&
      t.live &&
      t.speed === 0 &&
      t.signalState === 'red' &&
      withinKm(t, HELD_RADIUS_KM)
    ) {
      out.push({
        key: `held:${t.number}`,
        kind: 'held',
        trainNo: t.number,
        message: `${t.number} standing at a red signal`,
      })
    }

    if (
      settings.kinds.overdue &&
      t.live &&
      t.speed === 0 &&
      withinKm(t, OVERDUE_RADIUS_KM)
    ) {
      const departure = hhmmToSec(t.departure)
      if (departure !== null && wrapDiffSec(nowSec, departure) > 60) {
        out.push({
          key: `overdue:${t.number}`,
          kind: 'overdue',
          trainNo: t.number,
          message: `${t.number} overdue — booked out ${t.departure}`,
        })
      }
    }
  }

  if (settings.kinds.conflict) {
    const seen = new Set<string>()
    for (const [a, others] of conflicts) {
      for (const b of others) {
        const pair = [a, b].sort().join('|')
        if (seen.has(pair)) continue
        seen.add(pair)
        out.push({
          key: `conflict:${pair}`,
          kind: 'conflict',
          trainNo: a,
          message: `${a} and ${b} share a platform`,
        })
      }
    }
  }

  return out
}
