import { useEffect, type ReactNode } from 'react'
import { badgeClass, resolveDestination, type Train, type Stop } from './data'
import { vehicleName } from './lib/api'
import {
  computeETASec,
  etaLabel,
  etaUrgency,
} from './lib/dispatch'

type Props = {
  train: Train
  nowSec: number
  conflictsWith: string[]
  onClose: () => void
}

const SIGNAL_STYLE = {
  green: { label: 'Green', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  yellow: { label: 'Yellow', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  red: { label: 'Red', cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  unknown: { label: 'Unknown', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
} as const

function Vital({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-slate-800/60 border border-slate-800 rounded-lg p-2.5">
      <p className="text-[11px] uppercase text-slate-500 tracking-wider">{label}</p>
      {children}
    </div>
  )
}

function StopRow({
  stop,
  isCurrent,
  isPast,
}: {
  stop: Stop
  isCurrent: boolean
  isPast: boolean
}) {
  const dotCls = isCurrent
    ? 'bg-sky-400 ring-2 ring-sky-400/40'
    : isPast
    ? 'bg-slate-600'
    : 'bg-slate-500'
  const textCls = isCurrent
    ? 'text-white'
    : isPast
    ? 'text-slate-500'
    : 'text-slate-200'
  return (
    <li className="relative pl-6 pr-2 py-2">
      <span
        className={`absolute left-2 top-3.5 w-2.5 h-2.5 rounded-full ${dotCls}`}
      />
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-medium ${textCls}`}>{stop.station}</span>
        <span className="font-mono text-xs text-slate-400 shrink-0">
          {stop.arrival}
          {stop.arrival !== stop.departure && ` → ${stop.departure}`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
        <span>Pl {stop.platform}</span>
        <span>·</span>
        <span className="uppercase">{stop.type}</span>
      </div>
    </li>
  )
}

export default function TrainDetail({
  train,
  nowSec,
  conflictsWith,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dest = resolveDestination(train.toPost)
  const etaSec = computeETASec(train, nowSec)
  const urgency = etaUrgency(etaSec)
  const signal = SIGNAL_STYLE[train.signalState]
  const inConflict = conflictsWith.length > 0

  const currentIdx = train.stops.findIndex((s) => s.station.startsWith('Skierniewice'))

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/70 animate-in"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900 rounded-t-2xl border-t border-slate-700 max-h-[85vh] overflow-hidden flex flex-col animate-in">
        {/* Grabber */}
        <div className="pt-2 pb-1 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono font-bold text-2xl text-white tracking-tight">
                {train.number}
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {train.type}
              </span>
              {train.driver === 'player' ? (
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 border border-emerald-300">
                  PLAYER
                </span>
              ) : (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  AI
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 p-1.5 -mr-1 text-lg"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold text-white ${badgeClass(dest.badge)}`}
            >
              {dest.badge}
            </span>
            <div>
              <p className="text-sm font-medium text-white leading-tight">
                → {dest.next}
              </p>
              <p className="text-[11px] text-slate-400">{dest.direction}</p>
            </div>
          </div>

          {inConflict && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 text-[11px] text-red-300">
              <span className="font-semibold">⚠ Platform conflict:</span>
              <span className="font-mono">{conflictsWith.join(', ')}</span>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 pb-4">
          {/* Vitals grid */}
          <div className="grid grid-cols-2 gap-2 p-3 text-xs">
            <Vital label="ETA">
              <p className={`font-semibold mt-0.5 ${urgency === 'now' || urgency === 'imminent' ? 'text-red-300' : urgency === 'soon' ? 'text-amber-300' : 'text-white'}`}>
                {etaLabel(etaSec)}
              </p>
            </Vital>
            <Vital label="Delay">
              {/* The live feed reports no schedule, so it cannot report a
                  delay either — "on time" would be an unearned claim. */}
              <p className={`font-semibold mt-0.5 ${train.live ? 'text-slate-500' : train.delay > 0 ? 'text-red-400' : train.delay < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                {train.live
                  ? '—'
                  : train.delay === 0
                  ? 'On time'
                  : train.delay > 0
                  ? `+${train.delay}′`
                  : `${train.delay}′`}
              </p>
            </Vital>
            <Vital label="Speed">
              <p className="font-semibold mt-0.5 text-white">
                {train.speed}
                <span className="text-slate-500 text-xs">
                  {train.maxSpeed > 0 ? ` / ${train.maxSpeed} km/h` : ' km/h'}
                </span>
              </p>
            </Vital>
            <Vital label="Signal">
              <span className={`inline-block mt-0.5 text-[11px] px-2 py-0.5 rounded-full border font-semibold ${signal.cls}`}>
                {signal.label}
                {train.signalSpeed !== undefined && ` · ${train.signalSpeed} km/h`}
              </span>
            </Vital>

            {train.live ? (
              <>
                <Vital label="Consist">
                  <p className="font-semibold mt-0.5 text-white">
                    {train.vehicles?.length ?? 0} veh
                  </p>
                </Vital>
                <Vital label="Traction">
                  <p className="font-semibold mt-0.5 text-white truncate">
                    {train.vehicles?.[0] ? vehicleName(train.vehicles[0]) : '—'}
                  </p>
                </Vital>
                <Vital label="To signal">
                  <p className="font-semibold mt-0.5 text-white">
                    {train.signalDistance !== undefined
                      ? train.signalDistance < 1000
                        ? `${train.signalDistance} m`
                        : `${(train.signalDistance / 1000).toFixed(1)} km`
                      : '—'}
                  </p>
                </Vital>
                <Vital label="Destination">
                  <p className="font-semibold mt-0.5 text-white truncate">
                    {train.toPost}
                  </p>
                </Vital>
              </>
            ) : (
              <>
                <Vital label="Length">
                  <p className="font-semibold mt-0.5 text-white">{train.length} m</p>
                </Vital>
                <Vital label="Weight">
                  <p className="font-semibold mt-0.5 text-white">{train.weight} t</p>
                </Vital>
                <Vital label="Line">
                  <p className="font-semibold mt-0.5 text-white">{train.line}</p>
                </Vital>
                <Vital label="Distance">
                  <p className="font-semibold mt-0.5 text-white">
                    {train.distance > 0 ? `${train.distance.toFixed(1)} km` : 'At station'}
                  </p>
                </Vital>
              </>
            )}
          </div>

          {/* Route */}
          <div className="px-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold px-1 mt-2 mb-1">
              Route
            </h3>
            {train.stops.length === 0 ? (
              <p className="bg-slate-800/40 border border-slate-800 rounded-lg p-3 text-xs text-slate-500">
                No timetable for this train yet — the live feed reports position
                and signalling only.
              </p>
            ) : (
              <ol className="relative bg-slate-800/40 border border-slate-800 rounded-lg divide-y divide-slate-800">
                <span className="absolute left-[13px] top-4 bottom-4 w-px bg-slate-700" />
                {train.stops.map((stop, i) => (
                  <StopRow
                    key={`${stop.station}-${i}`}
                    stop={stop}
                    isCurrent={i === currentIdx}
                    isPast={currentIdx >= 0 && i < currentIdx}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
