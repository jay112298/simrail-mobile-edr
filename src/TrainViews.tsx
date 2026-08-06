// Dense list renderings for the timetable view.
//
// A dispatcher at a busy post can have well over a dozen trains inside the
// boundary at once, so the default card is often too tall to plan against.
// These two views trade detail for how many trains fit on screen; the user
// picks whichever suits the station and traffic, and the choice is saved.

import type { Train } from './data'
import { computeETASec, etaLabel, etaUrgency } from './lib/dispatch'
import { hapticTap } from './lib/haptic'
import {
  SIGNAL_DOT,
  URGENCY_STYLE,
  priorityChipCls,
  routeLabel,
  shortDelay,
} from './lib/ui'

type RowProps = {
  train: Train
  nowSec: number
  conflictsWith: string[]
  expanded: boolean
  onToggle: (n: string) => void
  onOpen: (t: Train) => void
  onOpenNumber: (n: string) => void
}

/**
 * Conflicts are detected across every train at the post, so a partner may be
 * hidden by the active category filter or search. Each number is therefore a
 * tap target that opens that train directly.
 */
function ConflictTag({
  withTrains,
  onOpenNumber,
}: {
  withTrains: string[]
  onOpenNumber: (n: string) => void
}) {
  return (
    <span className="text-[10px] px-1 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-mono">
      ⚠{' '}
      {withTrains.map((n, i) => (
        <button
          key={n}
          onClick={(e) => {
            e.stopPropagation()
            hapticTap()
            onOpenNumber(n)
          }}
          className="underline underline-offset-2 decoration-red-400/60"
        >
          {n}
          {i < withTrains.length - 1 ? ',' : ''}
        </button>
      ))}
    </span>
  )
}

/** ~60px two-line row. Tap expands the booked route inline. */
export function TrainRow({
  train,
  nowSec,
  conflictsWith,
  expanded,
  onToggle,
  onOpen,
  onOpenNumber,
}: RowProps) {
  const etaSec = computeETASec(train, nowSec)
  const eta = URGENCY_STYLE[etaUrgency(etaSec)]
  const delay = shortDelay(train.delay)
  const inConflict = conflictsWith.length > 0

  return (
    <li
      className={`border-b border-slate-800 ${inConflict ? 'bg-red-500/5' : ''}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          hapticTap()
          onToggle(train.number)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(train.number)
          }
        }}
        className="px-3 py-1.5 cursor-pointer active:bg-slate-800/60 focus:outline-none focus:bg-slate-800/60"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-[15px] text-white tabular-nums">
            {train.number}
          </span>
          <span
            className={`text-[10px] font-bold px-1 rounded ${priorityChipCls(train.priority)}`}
          >
            {train.type}
          </span>
          {train.driver === 'player' && (
            <span className="text-[10px] font-bold px-1 rounded bg-emerald-400 text-slate-950">
              P
            </span>
          )}
          {inConflict && (
            <ConflictTag
              withTrains={conflictsWith}
              onOpenNumber={onOpenNumber}
            />
          )}

          <span className="ml-auto font-mono text-[13px] tabular-nums text-slate-300">
            {train.arrival}
            <span className="text-slate-600">→</span>
            {train.departure}
          </span>
          <span className={`text-[12px] font-semibold tabular-nums w-9 text-right ${delay.cls}`}>
            {delay.text}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-0.5 text-[12px]">
          <span className="text-slate-500">→</span>
          <span className="text-slate-200 truncate">{routeLabel(train)}</span>
          {train.platform !== '-' && (
            <span className="text-[11px] text-sky-300 font-semibold shrink-0">
              pl {train.platform}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {train.live && (
              <>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {train.speed}
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${SIGNAL_DOT[train.signalState]}`}
                />
              </>
            )}
            <span className={`text-[11px] font-semibold ${eta.text}`}>
              {etaLabel(etaSec)}
            </span>
          </span>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2 bg-slate-900/60">
          {train.stops.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-1">
              Route still loading…
            </p>
          ) : (
            <ol className="max-h-56 overflow-y-auto text-[11px] divide-y divide-slate-800/70">
              {train.stops.map((s, i) => (
                <li
                  key={`${s.station}-${i}`}
                  className="flex items-center gap-2 py-1"
                >
                  <span className="font-mono tabular-nums text-slate-400 shrink-0">
                    {s.arrival}
                  </span>
                  <span className="text-slate-200 truncate">{s.station}</span>
                  {s.platform !== '-' && (
                    <span className="ml-auto text-sky-300 shrink-0">
                      pl {s.platform}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              hapticTap()
              onOpen(train)
            }}
            className="mt-1.5 text-[11px] text-sky-400 font-semibold"
          >
            Full details →
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * Single-line table. Highest train count per screen; route detail moves to
 * the detail sheet. Scrolls horizontally rather than wrapping, so columns
 * stay aligned and scannable.
 */
export function TrainTable({
  trains,
  conflicts,
  onOpen,
}: {
  trains: Train[]
  conflicts: Map<string, string[]>
  onOpen: (t: Train) => void
}) {
  return (
    // Sized to fit a phone without horizontal scrolling: the onward route is
    // the whole point of this view, so it must not be the column that falls
    // off the right edge.
    <div>
      <table className="w-full table-fixed text-[11px] border-collapse">
        <thead className="sticky top-0 bg-slate-900 text-[9px] uppercase tracking-wider text-slate-500">
          <tr className="border-b border-slate-800">
            {/* Freight numbers run to six digits; the train number is the one
                column that must never truncate. */}
            <th className="text-left font-semibold px-1 py-1.5 w-[62px]">Trn</th>
            <th className="text-left font-semibold px-0.5 py-1.5 w-[32px]">Typ</th>
            <th className="text-right font-semibold px-0.5 py-1.5 w-[38px]">Arr</th>
            {/* Left padding keeps the two times from reading as one number. */}
            <th className="text-right font-semibold pl-2 pr-0.5 py-1.5 w-[42px]">
              Dep
            </th>
            <th className="text-right font-semibold px-0.5 py-1.5 w-[26px]">±</th>
            <th className="text-left font-semibold px-1 py-1.5 w-[44px]">Pl</th>
            <th className="text-left font-semibold px-1 py-1.5">Next</th>
          </tr>
        </thead>
        <tbody>
          {trains.map((t) => {
            const conflictsWith = conflicts.get(t.number) ?? []
            const delay = shortDelay(t.delay)
            return (
              <tr
                key={t.number}
                onClick={() => {
                  hapticTap()
                  onOpen(t)
                }}
                className={`border-b border-slate-800/70 cursor-pointer active:bg-slate-800/60 ${
                  conflictsWith.length > 0 ? 'bg-red-500/10' : ''
                }`}
              >
                <td className="px-1 py-1 font-mono font-bold text-white tabular-nums whitespace-nowrap">
                  {conflictsWith.length > 0 && (
                    <span className="text-red-400 text-[9px] align-top">⚠</span>
                  )}
                  {t.number}
                </td>
                <td className="px-0.5 py-1">
                  <span
                    className={`text-[9px] font-bold px-1 rounded ${priorityChipCls(t.priority)}`}
                  >
                    {t.type}
                  </span>
                </td>
                <td className="px-0.5 py-1 text-right font-mono tabular-nums text-slate-300">
                  {t.arrival}
                </td>
                <td className="pl-2 pr-0.5 py-1 text-right font-mono tabular-nums text-slate-300">
                  {t.departure}
                </td>
                <td
                  className={`px-0.5 py-1 text-right font-semibold tabular-nums ${delay.cls}`}
                >
                  {delay.text}
                </td>
                <td className="px-1 py-1 text-sky-300 font-semibold truncate">
                  {t.platform}
                </td>
                <td className="px-1 py-1 text-slate-200 truncate">
                  {routeLabel(t)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
