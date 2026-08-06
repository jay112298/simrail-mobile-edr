import { useState, useMemo } from 'react'
import {
  STATIONS,
  TRAINS,
  resolveDestination,
  type Station,
  type Train,
} from './data'
import {
  computeETASec,
  detectConflicts,
  etaLabel,
  etaUrgency,
  sortByETA,
  useSimNow,
  type Urgency,
} from './lib/dispatch'
import InstallPrompt from './InstallPrompt'
import TrainDetail from './TrainDetail'

type Filter = 'all' | 'player' | 'passenger' | 'freight' | 'delayed' | 'approaching'
type View = 'timetable' | 'live' | 'map' | 'settings'

function formatDelay(min: number) {
  if (min === 0) return { text: 'On time', cls: 'delay-ontime' }
  if (min < 0) return { text: `${Math.abs(min)}′ early`, cls: 'delay-early' }
  return { text: `+${min}′`, cls: 'delay-late' }
}

function statusBadge(status: Train['status']) {
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

const URGENCY_STYLE: Record<Urgency, { text: string; ring: string; dot: string }> = {
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
}

function TrainCard({
  train,
  nowSec,
  conflictsWith,
  onOpen,
}: {
  train: Train
  nowSec: number
  conflictsWith: string[]
  onOpen: (t: Train) => void
}) {
  const dest = resolveDestination(train.toPost)
  const delay = formatDelay(train.delay)
  const status = statusBadge(train.status)
  const isFreight = train.category === 'freight'
  const etaSec = computeETASec(train, nowSec)
  const urgency = etaUrgency(etaSec)
  const eta = URGENCY_STYLE[urgency]
  const inConflict = conflictsWith.length > 0

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(train)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(train)
        }
      }}
      className={`card-press cursor-pointer bg-slate-900 rounded-xl overflow-hidden border-l-4 ${dest.color} transition-transform focus:outline-none focus:ring-2 focus:ring-sky-400/60 ${
        inConflict
          ? 'border border-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]'
          : 'border border-slate-800'
      }`}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-bold text-lg text-white tracking-tight">
              {train.number}
            </span>
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {train.type}
            </span>
            {isFreight && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                Freight
              </span>
            )}
            {train.driver === 'player' ? (
              <span
                title="Player-driven"
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 border border-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.35)]"
              >
                PLAYER
              </span>
            ) : (
              <span
                title="AI-driven"
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
              >
                AI
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            <div
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border font-semibold text-sm ${eta.ring} ${eta.text}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${eta.dot}`} />
              {etaLabel(etaSec)}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {train.distance > 0
                ? `${train.distance.toFixed(1)} km · ${delay.text}`
                : `At station · ${delay.text}`}
            </div>
          </div>
        </div>

        {/* KEY IMPROVEMENT: Clear destination instead of only P/S/M */}
        <div className="mb-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white badge-${dest.badge.toLowerCase()}`}
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
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3 text-slate-300">
            <div>
              <span className="text-slate-500">Arr</span>
              <span className="font-mono ml-1">{train.arrival}</span>
            </div>
            <div>
              <span className="text-slate-500">Dep</span>
              <span className="font-mono ml-1">{train.departure}</span>
            </div>
            {train.platform !== '-' && (
              <div>
                <span className="text-slate-500">Pl</span>
                <span className="ml-1">{train.platform}</span>
              </div>
            )}
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border ${status.cls}`}
          >
            {status.label}
          </span>
        </div>

        {inConflict && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 text-[11px] text-red-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <span className="font-semibold">Platform conflict:</span>
            <span className="font-mono">{conflictsWith.join(', ')}</span>
          </div>
        )}

        <div className="mt-2 pt-2 border-t border-slate-800 flex items-center gap-1.5 text-[11px] text-slate-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
          From <span className="text-slate-300">{train.from}</span>
        </div>
      </div>
    </article>
  )
}

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'timetable', label: 'Timetable' },
  { id: 'live', label: 'Live' },
  { id: 'map', label: 'Map' },
  { id: 'settings', label: 'Settings' },
]

function NavIcon({ id }: { id: View }) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
  }
  if (id === 'timetable')
    return (
      <svg {...common}>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    )
  if (id === 'live')
    return (
      <svg {...common}>
        <path d="M12 2v4" />
        <path d="m16.2 7.8 2.9-2.9" />
        <path d="M18 12h4" />
        <path d="m16.2 16.2 2.9 2.9" />
        <path d="M12 18v4" />
        <path d="m4.9 19.1 2.9-2.9" />
        <path d="M2 12h4" />
        <path d="m4.9 4.9 2.9 2.9" />
      </svg>
    )
  if (id === 'map')
    return (
      <svg {...common}>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  )
}

export default function App() {
  const [currentStation, setCurrentStation] = useState<Station>(STATIONS[0])
  const [currentFilter, setCurrentFilter] = useState<Filter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showStationModal, setShowStationModal] = useState(false)
  const [selectedTrain, setSelectedTrain] = useState<Train | null>(null)
  const [view, setView] = useState<View>('timetable')
  const nowSec = useSimNow()

  const conflicts = useMemo(() => detectConflicts(TRAINS), [])
  const conflictPairs = useMemo(() => {
    const seen = new Set<string>()
    for (const [a, arr] of conflicts) {
      for (const b of arr) {
        const key = [a, b].sort().join('|')
        seen.add(key)
      }
    }
    return seen.size
  }, [conflicts])

  const filteredTrains = useMemo(() => {
    const filtered = TRAINS.filter((t) => {
      if (currentFilter === 'player' && t.driver !== 'player') return false
      if (currentFilter === 'passenger' && t.category !== 'passenger')
        return false
      if (currentFilter === 'freight' && t.category !== 'freight') return false
      if (currentFilter === 'delayed' && t.delay <= 0) return false
      if (currentFilter === 'approaching' && t.status !== 'approaching')
        return false
      if (
        searchQuery &&
        !t.number.includes(searchQuery) &&
        !t.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false
      return true
    })
    return sortByETA(filtered, nowSec)
  }, [currentFilter, searchQuery, nowSec])

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'player', label: 'Player' },
    { id: 'passenger', label: 'Passenger' },
    { id: 'freight', label: 'Freight' },
    { id: 'delayed', label: 'Delayed' },
    { id: 'approaching', label: 'Approaching' },
  ]

  return (
    <div className="max-w-lg mx-auto min-h-screen flex flex-col relative bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-sky-400"
              >
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" x2="4" y1="22" y2="15" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-white">
                Mobile EDR
              </h1>
              <p className="text-[10px] text-slate-400 leading-none">
                SimRail · Installable
              </p>
            </div>
          </div>
          <button className="text-xs bg-slate-800 px-2.5 py-1.5 rounded-full border border-slate-700 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>PL1</span>
          </button>
        </div>

        <button
          onClick={() => setShowStationModal(true)}
          className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-left"
        >
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
              Dispatch Post
            </p>
            <p className="text-base font-semibold text-white">
              {currentStation.name}
            </p>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-slate-400"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </header>

      {view === 'timetable' && (
        <>
      {/* Filters */}
      <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 sticky top-[108px] z-20">
        <div className="flex gap-2 overflow-x-auto scroll-hide pb-0.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setCurrentFilter(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                currentFilter === f.id
                  ? 'bg-sky-400 text-slate-950'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-2 relative">
          <input
            type="search"
            placeholder="Search train number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value.trim())}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-3 top-2.5 text-slate-500"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
      </div>

      {/* Conflict banner */}
      {conflictPairs > 0 && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/40 text-[12px] text-red-200 flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="shrink-0"
          >
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          <span>
            <b>{conflictPairs}</b> platform conflict{conflictPairs > 1 ? 's' : ''} detected — reassign platforms
          </span>
        </div>
      )}

      {/* Legend for multi-post stations */}
      {currentStation.multiPost && (
        <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800 text-[11px]">
          <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
            <span className="text-slate-400 font-medium">Posts mapped:</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full badge-p" />
              <b>P</b> → Płyćwia / Łowicz
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full badge-s" />
              <b>S</b> → Platforms
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full badge-m" />
              <b>M</b> → Koluszki / Żyrardów
            </span>
          </div>
        </div>
      )}

      {/* Train list */}
      <main className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 pb-24">
        {filteredTrains.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <p className="text-sm">No trains match the filter</p>
          </div>
        ) : (
          filteredTrains.map((t) => (
            <TrainCard
              key={t.number}
              train={t}
              nowSec={nowSec}
              conflictsWith={conflicts.get(t.number) ?? []}
              onOpen={setSelectedTrain}
            />
          ))
        )}
      </main>
        </>
      )}

      {view !== 'timetable' && (
        <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center pb-32">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4 text-2xl">
            {view === 'live' ? '📡' : view === 'map' ? '🗺' : '⚙'}
          </div>
          <h2 className="text-lg font-semibold text-white capitalize mb-1">
            {view}
          </h2>
          <p className="text-sm text-slate-400 max-w-xs">
            Coming in a later phase. Timetable is the working view for now.
          </p>
        </main>
      )}

      {/* Install prompt for PWA */}
      <InstallPrompt />

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-4 py-2.5 safe-bottom z-30">
        <div className="flex items-center justify-around text-[10px]">
          {NAV_ITEMS.map((item) => {
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors ${
                  active ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <NavIcon id={item.id} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Train Detail Sheet */}
      {selectedTrain && (
        <TrainDetail
          train={selectedTrain}
          nowSec={nowSec}
          conflictsWith={conflicts.get(selectedTrain.number) ?? []}
          onClose={() => setSelectedTrain(null)}
        />
      )}

      {/* Station Modal */}
      {showStationModal && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowStationModal(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900 rounded-t-2xl border-t border-slate-700 max-h-[70vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-semibold">Select Station</h2>
              <button
                onClick={() => setShowStationModal(false)}
                className="text-slate-400 p-1 text-lg"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-1.5">
              {STATIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setCurrentStation(s)
                    setShowStationModal(false)
                  }}
                  className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between ${
                    s.id === currentStation.id
                      ? 'bg-sky-500/15 border border-sky-500/40'
                      : 'hover:bg-slate-800 border border-transparent'
                  }`}
                >
                  <div>
                    <p
                      className={`font-medium ${
                        s.id === currentStation.id
                          ? 'text-sky-400'
                          : 'text-white'
                      }`}
                    >
                      {s.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Difficulty {s.difficulty}/5
                      {s.multiPost ? ' · Multi-post' : ''}
                    </p>
                  </div>
                  {s.id === currentStation.id && (
                    <span className="text-sky-400 text-sm">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
