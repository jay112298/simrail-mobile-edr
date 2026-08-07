// Driver mode: one train, its whole booked route, and where it is in it.
//
// The dispatcher views rewrite arrival/departure to this post's occupation
// window, which is wrong for a driver — they want their own schedule end to
// end. So this reads the raw EdrTrain rather than the post-enriched
// Train, and uses VDDelayedTimetableIndex to mark the current position.

import { useEffect, useRef } from 'react'
import type { Train } from './data'
import { wrapDiffSec } from './lib/enrich'
import { etaLabel } from './lib/dispatch'
import { hapticTap } from './lib/haptic'
import type { EdrStop, EdrTrain } from './lib/edrTimetable'
import {
  SIGNAL_BADGE,
  SIGNAL_LABEL,
  formatMetres,
  priorityChipCls,
  shortDelay,
} from './lib/ui'

function Vital({
  label,
  value,
  tone = 'text-white',
  sub,
}: {
  label: string
  value: string
  tone?: string
  sub?: string
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-800 rounded-lg p-2.5">
      <p className="text-[10px] uppercase text-slate-500 tracking-wider">
        {label}
      </p>
      <p className={`font-semibold mt-0.5 text-[15px] ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

/** "L4 · km 29.5" — mileage is a line kilometre post, not route distance. */
function linePost(stop: EdrStop): string {
  if (stop.offMap) return 'outside simulated area'
  const parts: string[] = []
  if (stop.line != null) parts.push(`L${stop.line}`)
  if (Number.isFinite(stop.mileage)) parts.push(`km ${stop.mileage.toFixed(1)}`)
  return parts.join(' · ')
}

function StopRow({
  stop,
  state,
  etaSec,
  rowRef,
}: {
  stop: EdrStop
  state: 'past' | 'current' | 'future'
  etaSec: number | null
  rowRef?: (el: HTMLLIElement | null) => void
}) {
  const stops = stop.kind !== 'pass'
  return (
    <li
      ref={rowRef}
      className={`relative pl-7 pr-3 py-2 ${
        state === 'current' ? 'bg-sky-500/10' : ''
      }`}
    >
      <span
        className={`absolute left-2.5 top-3.5 w-2.5 h-2.5 rounded-full ${
          state === 'current'
            ? 'bg-sky-400 ring-4 ring-sky-400/25'
            : state === 'past'
            ? 'bg-slate-700'
            : stops
            ? 'bg-slate-300'
            : 'bg-slate-600'
        }`}
      />
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`text-[13px] font-medium truncate ${
            state === 'past'
              ? 'text-slate-500'
              : state === 'current'
              ? 'text-white'
              : 'text-slate-200'
          }`}
        >
          {stop.point}
        </span>
        <span className="font-mono text-[12px] tabular-nums shrink-0 text-slate-400">
          {stop.arrival}
          {stop.departure !== stop.arrival && (
            <span className="text-slate-600">→{stop.departure}</span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
        <span className={stop.offMap ? 'italic' : ''}>{linePost(stop)}</span>
        {stop.maxSpeed != null && (
          <span className="text-slate-400">{stop.maxSpeed} km/h</span>
        )}
        {stop.platform && (
          <span className="text-sky-300">
            pl {stop.platform}
            {stop.track ? ` ${stop.track}` : ''}
          </span>
        )}
        {stops && (
          <span className="uppercase tracking-wide">
            {stop.kind === 'commercial' ? 'stop' : 'tech'}
          </span>
        )}
        {state !== 'past' && etaSec !== null && (
          <span className="ml-auto text-slate-400">{etaLabel(etaSec)}</span>
        )}
      </div>
    </li>
  )
}

export default function DriverView({
  train,
  timetable,
  nowSec,
  onChangeTrain,
}: {
  train: Train
  timetable: EdrTrain | undefined
  nowSec: number | null
  onChangeTrain: () => void
}) {
  const idx = train.timetableIndex ?? 0
  const stops = timetable?.stops ?? []
  const currentRow = useRef<HTMLLIElement | null>(null)

  // Jump to where the train actually is — on a 28-stop route the current
  // point is well below the fold. Keyed on the train only, not the index, so
  // the list does not yank itself away while the route is being read.
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'center' })
  }, [train.number, stops.length])
  const next = stops[idx]
  const signal = SIGNAL_BADGE[train.signalState]
  const delay = shortDelay(train.delay)

  const etaFor = (s: EdrStop): number | null => {
    if (nowSec === null || s.arrivalSec === null) return null
    return wrapDiffSec(s.arrivalSec + train.delay * 60, nowSec)
  }

  return (
    <main className="flex-1 overflow-y-auto pb-24">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono font-bold text-2xl text-white tracking-tight">
            {train.number}
          </span>
          <span
            className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${priorityChipCls(train.priority)}`}
          >
            {train.type}
          </span>
          {train.driver === 'player' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950">
              YOU
            </span>
          )}
          <button
            onClick={() => {
              hapticTap()
              onChangeTrain()
            }}
            className="ml-auto text-[11px] font-semibold text-sky-400 px-2 py-1 rounded-lg border border-sky-500/40 bg-sky-500/10"
          >
            Change
          </button>
        </div>
        <p className="text-[12px] text-slate-400 mb-3 truncate">
          {train.from} → {timetable ? stops[stops.length - 1]?.point : train.toPost}
        </p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <Vital
            label="Speed"
            value={`${train.speed} km/h`}
            sub={
              train.signalSpeed !== undefined
                ? `next signal ${train.signalSpeed} km/h`
                : next?.maxSpeed != null
                ? `line limit ${next.maxSpeed} km/h`
                : undefined
            }
            tone={
              train.signalSpeed !== undefined && train.speed > train.signalSpeed
                ? 'text-red-400'
                : 'text-white'
            }
          />
          <Vital
            label="Signal ahead"
            value={SIGNAL_LABEL[train.signalState]}
            tone={signal.text}
            sub={
              train.signalDistance !== undefined
                ? formatMetres(train.signalDistance)
                : 'no signal data'
            }
          />
          <Vital
            label="Delay"
            value={train.delay === 0 ? 'On time' : delay.text}
            tone={delay.cls}
          />
          <Vital
            label="Next point"
            value={next?.point ?? '—'}
            sub={next ? `booked ${next.arrival}` : undefined}
          />
        </div>
      </div>

      <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold px-4 mb-1">
        Route
        {stops.length > 0 && (
          <span className="ml-1 text-slate-600 normal-case tracking-normal">
            · stop {Math.min(idx + 1, stops.length)} of {stops.length}
          </span>
        )}
      </h3>

      {stops.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          Timetable for this train has not loaded yet.
        </p>
      ) : (
        <ol className="relative border-t border-slate-800 divide-y divide-slate-800/70">
          <span className="absolute left-[15px] top-3 bottom-3 w-px bg-slate-800" />
          {stops.map((s, i) => (
            <StopRow
              key={`${s.point}-${i}`}
              stop={s}
              state={i < idx ? 'past' : i === idx ? 'current' : 'future'}
              etaSec={etaFor(s)}
              rowRef={i === idx ? (el) => (currentRow.current = el) : undefined}
            />
          ))}
        </ol>
      )}
    </main>
  )
}
