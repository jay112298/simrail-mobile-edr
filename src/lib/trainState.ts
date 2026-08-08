// One state per train, and it drives every colour in the app.
//
// The screen was uniformly dark because colour was only ever used on small
// chips. The fix is not more colour — it is one meaningful dimension. A row's
// state answers "does this need me, and how soon", and nothing else competes
// for the same channel.
//
// Ordering matters: a train can be several of these at once, so the most
// urgent wins.

import type { Train } from '../data'

export type TrainState =
  | 'conflict' // shares a platform with another train
  | 'atPlatform' // standing at this post's platform
  | 'arriving' // working into this post right now
  | 'due' // inside the approach window
  | 'late' // running behind, not yet due
  | 'running' // moving, clear, nothing to do
  | 'scheduled' // booked, has not spawned
  | 'departed' // worked past this post

/** Inside this many seconds of booked arrival a train counts as due. */
const DUE_WINDOW_SEC = 10 * 60
const LATE_MIN = 3

export type StateStyle = {
  label: string
  /** Left edge stripe. */
  stripe: string
  /** Very low alpha row wash; large saturated areas are tiring at night. */
  tint: string
  text: string
  /** Never rely on colour alone. */
  glyph: string
}

// Pink for arriving/at-platform mirrors the in-game timetable, so the two
// screens agree at a glance.
export const STATE_STYLE: Record<TrainState, StateStyle> = {
  conflict: {
    label: 'Platform conflict',
    stripe: 'border-l-red-500',
    tint: 'bg-red-500/10',
    text: 'text-red-300',
    glyph: '⚠',
  },
  atPlatform: {
    label: 'At platform',
    stripe: 'border-l-fuchsia-400',
    tint: 'bg-fuchsia-500/10',
    text: 'text-fuchsia-300',
    glyph: '■',
  },
  arriving: {
    label: 'Arriving',
    stripe: 'border-l-fuchsia-500',
    tint: 'bg-fuchsia-500/5',
    text: 'text-fuchsia-300',
    glyph: '▸',
  },
  due: {
    label: 'Due soon',
    stripe: 'border-l-amber-400',
    tint: 'bg-amber-500/5',
    text: 'text-amber-300',
    glyph: '●',
  },
  late: {
    label: 'Running late',
    stripe: 'border-l-orange-400',
    tint: '',
    text: 'text-orange-300',
    glyph: '▲',
  },
  running: {
    label: 'Running',
    stripe: 'border-l-emerald-500',
    tint: '',
    text: 'text-emerald-300',
    glyph: '●',
  },
  scheduled: {
    label: 'Booked, not yet running',
    stripe: 'border-l-slate-700',
    tint: '',
    text: 'text-slate-400',
    glyph: '○',
  },
  departed: {
    label: 'Left this post',
    stripe: 'border-l-slate-800',
    tint: '',
    text: 'text-slate-600',
    glyph: '✓',
  },
}

/** Legend order, most urgent first — used by Settings. */
export const STATE_ORDER: TrainState[] = [
  'conflict',
  'atPlatform',
  'arriving',
  'due',
  'late',
  'running',
  'scheduled',
  'departed',
]

/**
 * `timetableIndex` is the stop the train is working *to*, so comparing it
 * against the index of this post's stop says where the train is relative to
 * us: before it, at it, or past it.
 */
export function trainState(
  train: Train,
  etaSec: number | null,
  inConflict: boolean,
): TrainState {
  if (inConflict) return 'conflict'

  const here = train.postStopIndex
  const idx = train.timetableIndex

  if (train.live && here != null && idx != null) {
    if (idx > here) return 'departed'
    if (idx === here) return train.speed === 0 ? 'atPlatform' : 'arriving'
  }

  if (!train.live) return 'scheduled'
  if (etaSec !== null && etaSec >= 0 && etaSec <= DUE_WINDOW_SEC) return 'due'
  if (train.delay >= LATE_MIN) return 'late'
  return 'running'
}

/**
 * A train still at or approaching this post must never be filtered out of the
 * list, whatever the time window says — it is the one the dispatcher is
 * actively working.
 */
export function isPresentAtPost(state: TrainState): boolean {
  return state === 'atPlatform' || state === 'arriving' || state === 'conflict'
}
