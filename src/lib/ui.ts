// Presentation helpers shared by the three list densities and the detail
// sheet. Kept free of JSX so any view can import them without cycles.

import type { Train } from '../data'
import type { Urgency } from './dispatch'

export function formatDelay(min: number) {
  if (min === 0) return { text: 'On time', cls: 'delay-ontime' }
  if (min < 0) return { text: `${Math.abs(min)}′ early`, cls: 'delay-early' }
  return { text: `+${min}′`, cls: 'delay-late' }
}

/** Compact signed delay for dense rows, where "On time" is too wide. */
export function shortDelay(min: number): { text: string; cls: string } {
  if (min === 0) return { text: '·', cls: 'text-slate-500' }
  if (min < 0) return { text: `${min}′`, cls: 'text-emerald-400' }
  return { text: `+${min}′`, cls: min >= 5 ? 'text-red-400' : 'text-amber-400' }
}

// Priority (1=EIP highest → 6=freight lowest). Colors chosen for at-a-glance class ID.
const PRIORITY_CHIP: Record<number, string> = {
  1: 'bg-amber-300 text-slate-950 border border-amber-200',
  2: 'bg-slate-200 text-slate-900 border border-slate-100',
  3: 'bg-orange-400 text-slate-950 border border-orange-300',
  4: 'bg-purple-400 text-slate-950 border border-purple-300',
  5: 'bg-slate-800 text-slate-300 border border-slate-700',
  6: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
}

export function priorityChipCls(priority: number): string {
  return PRIORITY_CHIP[priority] ?? PRIORITY_CHIP[5]
}

export function statusBadge(status: Train['status']) {
  const map = {
    approaching: {
      label: 'Approaching',
      cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    },
    enroute: {
      label: 'En route',
      cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
    standing: {
      label: 'Standing',
      cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    },
    scheduled: {
      label: 'Scheduled',
      cls: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
    },
  }
  return map[status]
}

export const URGENCY_STYLE: Record<
  Urgency,
  { text: string; ring: string; dot: string }
> = {
  now: {
    text: 'text-red-300',
    ring: 'bg-red-500/15 border-red-500/40',
    dot: 'bg-red-400 animate-pulse',
  },
  imminent: {
    text: 'text-red-300',
    ring: 'bg-red-500/10 border-red-500/30',
    dot: 'bg-red-400',
  },
  soon: {
    text: 'text-amber-300',
    ring: 'bg-amber-500/10 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  later: {
    text: 'text-slate-300',
    ring: 'bg-slate-800 border-slate-700',
    dot: 'bg-slate-500',
  },
  past: {
    text: 'text-slate-500',
    ring: 'bg-slate-800/60 border-slate-700/60',
    dot: 'bg-slate-600',
  },
  unknown: {
    text: 'text-slate-400',
    ring: 'bg-slate-800/60 border-slate-700/60',
    dot: 'bg-slate-600',
  },
}

// Live trains without a timetable have no ETA, so the prime slot carries the
// live vital instead: speed, tinted by the aspect of the signal ahead.
export const SIGNAL_BADGE: Record<
  Train['signalState'],
  { ring: string; text: string; dot: string }
> = {
  green: {
    ring: 'bg-emerald-500/10 border-emerald-500/40',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  yellow: {
    ring: 'bg-amber-500/10 border-amber-500/40',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  red: {
    ring: 'bg-red-500/15 border-red-500/40',
    text: 'text-red-300',
    dot: 'bg-red-400',
  },
  unknown: {
    ring: 'bg-slate-800 border-slate-700',
    text: 'text-slate-300',
    dot: 'bg-slate-500',
  },
}

export const SIGNAL_LABEL: Record<Train['signalState'], string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  unknown: 'Unknown',
}

/**
 * Literal hex for SVG fills. Tailwind only emits classes it can find in the
 * source, so a class name assembled at runtime would silently render
 * unstyled — hence real colour values here rather than `fill-*` utilities.
 */
export const SIGNAL_HEX: Record<Train['signalState'], string> = {
  green: '#34d399',
  yellow: '#fbbf24',
  red: '#f87171',
  unknown: '#64748b',
}

export const SIGNAL_DOT: Record<Train['signalState'], string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
  unknown: 'bg-slate-600',
}

/** Metres → "820 m" / "1.2 km", the way a driver reads distance-to-signal. */
export function formatMetres(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`
}

/** "→ Płyćwia · L1" — where the train goes after this post. */
export function routeLabel(train: Train): string {
  const dest = train.onwardPoint ?? train.toPost
  const line = train.onwardLine ?? (train.line !== '-' ? train.line : null)
  return line ? `${dest} · L${line}` : dest
}
