import { useState, useMemo, useCallback } from 'react'
import {
  FALLBACK_STATIONS,
  REGION_LABEL,
  legacyStationName,
  SERVERS as FALLBACK_SERVERS,
  badgeClass,
  resolveDestination,
  type DispatchStation,
  type Server,
  type ServerRegion,
  type Train,
} from './data'
import { normalizeRegion } from './lib/api'
import { haversineKm } from './lib/geo'
import { buildSchematic } from './lib/schematic'
import { useServers, useStations, useTrains } from './lib/useLive'
import {
  computeETASec,
  detectConflicts,
  etaLabel,
  etaUrgency,
  sortByETA,
  useSimNow,
} from './lib/dispatch'
import { useServerTime, useTimetables } from './lib/useTimetable'
import { applyTimetable, passesPost } from './lib/enrich'
import { TrainRow, TrainTable } from './TrainViews'
import {
  SIGNAL_BADGE,
  SIGNAL_LABEL,
  URGENCY_STYLE,
  formatDelay,
  formatMetres,
  priorityChipCls,
  statusBadge,
} from './lib/ui'
import { useLocalStorage } from './lib/storage'
import { hapticTap } from './lib/haptic'
import InstallPrompt from './InstallPrompt'
import TrainDetail from './TrainDetail'
import DriverView from './DriverView'
import SchematicMap from './SchematicMap'
import buildInfo from './build-info.json'

type Filter = 'all' | 'player' | 'passenger' | 'freight' | 'delayed' | 'approaching'
// "live" was a stub and is redundant now that the timetable carries live
// speed and signals; the slot is driver mode instead. Existing installs have
// 'live' persisted, so it is migrated on read.
type View = 'timetable' | 'driver' | 'map' | 'settings'

function migrateView(v: string): View {
  return v === 'live' ? 'driver' : (v as View)
}

/** How tightly the train list is packed. Persisted — see DENSITY_OPTIONS. */
type Density = 'rows' | 'table' | 'cards'

// Traffic and station layout change how much detail is useful at a glance,
// so the choice is the dispatcher's and it is remembered.
const DENSITY_OPTIONS: {
  id: Density
  label: string
  hint: string
  fits: string
}[] = [
  {
    id: 'rows',
    label: 'Dense rows',
    hint: 'Two lines per train, tap to expand the full booked route.',
    fits: '~12 on screen',
  },
  {
    id: 'table',
    label: 'Table',
    hint: 'One line per train. Most trains visible; details in the sheet.',
    fits: '~20 on screen',
  },
  {
    id: 'cards',
    label: 'Cards',
    hint: 'Full detail per train, including live speed and signal.',
    fits: '~7 on screen',
  },
]

function TrainCard({
  train,
  nowSec,
  conflictsWith,
  onOpen,
  onOpenNumber,
}: {
  train: Train
  nowSec: number
  conflictsWith: string[]
  onOpen: (t: Train) => void
  onOpenNumber: (n: string) => void
}) {
  const dest = resolveDestination(train.toPost)
  const delay = formatDelay(train.delay)
  const status = statusBadge(train.status)
  const isFreight = train.category === 'freight'
  const etaSec = computeETASec(train, nowSec)
  const urgency = etaUrgency(etaSec)
  const eta = URGENCY_STYLE[urgency]
  const signalBadge = SIGNAL_BADGE[train.signalState]
  const inConflict = conflictsWith.length > 0

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => {
        hapticTap()
        onOpen(train)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          hapticTap()
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
          {/* Wraps rather than overlapping the ETA badge when a train carries
              several chips (type + freight + player). */}
          <div className="flex items-center flex-wrap gap-1.5 min-w-0">
            <span className="font-mono font-bold text-xl text-white tracking-tight">
              {train.number}
            </span>
            <span
              title={`Priority ${train.priority}`}
              className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${priorityChipCls(train.priority)}`}
            >
              {train.type}
            </span>
            {isFreight && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                Freight
              </span>
            )}
            {train.driver === 'player' ? (
              <span
                title="Player-driven"
                className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 border border-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.35)]"
              >
                PLAYER
              </span>
            ) : (
              <span
                title="AI-driven"
                className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
              >
                AI
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            {/* With a timetable the ETA to this post is the headline; without
                one, the live vital is the best we can honestly show. */}
            {train.hasTimetable || !train.live ? (
              <div
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border font-bold text-[15px] tabular-nums ${eta.ring} ${eta.text}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${eta.dot}`} />
                {etaLabel(etaSec)}
              </div>
            ) : (
              <div
                title="Live speed — no timetable for this train yet"
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border font-bold text-[15px] tabular-nums ${signalBadge.ring} ${signalBadge.text}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${signalBadge.dot}`} />
                {train.speed > 0 ? `${train.speed} km/h` : 'Stopped'}
              </div>
            )}
            <div className="text-[11px] text-slate-500 mt-1">
              {train.hasTimetable
                ? `${train.speed} km/h${train.distance > 0 ? ` · ${train.distance.toFixed(1)} km out` : ''} · ${delay.text}`
                : train.live
                ? train.signalDistance !== undefined
                  ? `${formatMetres(train.signalDistance)} to signal`
                  : 'No signal ahead'
                : train.distance > 0
                ? `${train.distance.toFixed(1)} km · ${delay.text}`
                : `At station · ${delay.text}`}
            </div>
          </div>
        </div>

        {/* KEY IMPROVEMENT: Clear destination instead of only P/S/M */}
        <div className="mb-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold text-white ${badgeClass(dest.badge)}`}
            >
              {dest.badge}
            </span>
            <div>
              <p className="text-sm font-medium text-white leading-tight">
                → {dest.next}
                {train.onwardLine != null && (
                  <span className="ml-1.5 text-[11px] font-semibold text-sky-300">
                    L{train.onwardLine}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-slate-400">
                {train.hasTimetable && train.nextPoint
                  ? `Now working to ${train.nextPoint}`
                  : dest.direction}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[13px]">
          {train.live && !train.hasTimetable ? (
            // No scheduled times to show — surface what the feed does give.
            <div className="flex items-center gap-3 text-slate-300">
              <div>
                <span className="text-slate-500 text-[11px]">Signal</span>
                <span className="ml-1 font-semibold">
                  {SIGNAL_LABEL[train.signalState]}
                </span>
              </div>
              {train.signalSpeed !== undefined && (
                <div>
                  <span className="text-slate-500 text-[11px]">Limit</span>
                  <span className="font-mono ml-1 tabular-nums">
                    {train.signalSpeed}
                  </span>
                  <span className="text-slate-500 text-[11px]"> km/h</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-slate-300">
              <div>
                <span className="text-slate-500 text-[11px]">Arr</span>
                <span className="font-mono ml-1 tabular-nums">{train.arrival}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[11px]">Dep</span>
                <span className="font-mono ml-1 tabular-nums">{train.departure}</span>
              </div>
              {train.platform !== '-' && (
                <div>
                  <span className="text-slate-500 text-[11px]">Pl</span>
                  <span className="ml-1 font-semibold text-sky-300">
                    {train.platform}
                  </span>
                </div>
              )}
              {train.live && (
                <span
                  title={`Signal ${SIGNAL_LABEL[train.signalState]}`}
                  className={`w-2 h-2 rounded-full ${signalBadge.dot}`}
                />
              )}
            </div>
          )}
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full border ${status.cls}`}
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
            {conflictsWith.map((n) => (
              <button
                key={n}
                onClick={(e) => {
                  e.stopPropagation()
                  hapticTap()
                  onOpenNumber(n)
                }}
                className="font-mono underline underline-offset-2 decoration-red-400/60"
              >
                {n}
              </button>
            ))}
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
  { id: 'driver', label: 'Driver' },
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
  if (id === 'driver')
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
  // Stored as the station *name*, since that is the key trains are matched on.
  const [stationId, setStationId] = useLocalStorage<string>(
    'station',
    FALLBACK_STATIONS[0].name,
  )
  const [stationQuery, setStationQuery] = useState('')
  const [currentFilter, setCurrentFilter] = useLocalStorage<Filter>('filter', 'all')
  const [storedView, setView] = useLocalStorage<View>('view', 'timetable')
  const view = migrateView(storedView)
  // Steam64 id. Entered once, it identifies both the train the player is
  // driving (TrainData.ControlledBySteamID) and the post they are dispatching
  // (station DispatchedBy), so driver mode can target the right train on its
  // own instead of making them hunt for it.
  const [steamId, setSteamId] = useLocalStorage<string>('steamId', '')
  const [driverTrainNo, setDriverTrainNo] = useLocalStorage<string>(
    'driverTrain',
    '',
  )
  const [showDriverPicker, setShowDriverPicker] = useState(false)
  const [driverQuery, setDriverQuery] = useState('')
  const [serverCode, setServerCode] = useLocalStorage<string>('server', FALLBACK_SERVERS[0].code)
  const [searchQuery, setSearchQuery] = useState('')
  const [showStationModal, setShowStationModal] = useState(false)
  const [showServerModal, setShowServerModal] = useState(false)
  const [selectedTrain, setSelectedTrain] = useState<Train | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [density, setDensity] = useLocalStorage<Density>('density', 'rows')
  // Fallback clock for the mock dataset; live data uses the in-game clock.
  const simNowSec = useSimNow()

  const serversState = useServers()
  const servers = serversState.data
  // While the live server list is still loading, `servers` is the mock list,
  // which does not cover every real server code. Honour the stored code until
  // the real list arrives — otherwise a stored server missing from the mock
  // briefly renders (and fetches trains for) the wrong one. Only drop back to
  // the first server once we know the stored code really is gone.
  const currentServer: Server =
    servers.find((s) => s.code === serverCode) ??
    (serversState.loading
      ? { code: serverCode, region: normalizeRegion(serverCode), label: serverCode.toUpperCase() }
      : servers[0] ?? FALLBACK_SERVERS[0])

  // Stations are per-server, so this has to follow currentServer.
  const stationsState = useStations(currentServer.code)
  const stations = stationsState.data
  // Same rule as the server picker: honour the stored post while the live
  // list loads, so a post absent from the fallback does not briefly render
  // (and scope trains to) the wrong one.
  const stationName = legacyStationName(stationId) ?? stationId
  const currentStation: DispatchStation =
    stations.find((s) => s.name === stationName) ??
    (stationsState.loading
      ? {
          name: stationName,
          prefix: '',
          difficulty: 0,
          dispatchedBy: 0,
          lat: null,
          lon: null,
        }
      : stations[0] ?? FALLBACK_STATIONS[0])
  const setCurrentStation = (s: DispatchStation) => setStationId(s.name)

  const trainsState = useTrains(currentServer.code)
  const rawTrains = trainsState.data

  // Scheduled data lives on a different host from the live feed. Join the two
  // on train number so cards can show booked times, platform and onward route
  // rather than telemetry alone.
  const serverNowSec = useServerTime(currentServer.code)
  const liveTrainNos = useMemo(
    () => rawTrains.filter((t) => t.live).map((t) => t.number),
    [rawTrains],
  )
  const {
    timetables,
    pending: timetablePending,
    unresolved: timetableUnresolved,
  } = useTimetables(currentServer.code, liveTrainNos)

  const allTrains = useMemo(
    () =>
      rawTrains.map((t) => {
        const tt = timetables.get(t.number)
        const merged = tt
          ? applyTimetable(t, tt, currentStation.name, serverNowSec)
          : t
        // Straight-line distance from the post. Replaces the 0 sentinel that
        // made every live train read "At station".
        if (
          t.lat != null &&
          t.lon != null &&
          currentStation.lat != null &&
          currentStation.lon != null
        ) {
          return {
            ...merged,
            distance: haversineKm(
              t.lat,
              t.lon,
              currentStation.lat,
              currentStation.lon,
            ),
          }
        }
        return merged
      }),
    [
      rawTrains,
      timetables,
      currentStation.name,
      currentStation.lat,
      currentStation.lon,
      serverNowSec,
    ],
  )

  // Only trains actually routed through this post. Without it the list is
  // every train on the server, which is useless for dispatching one station.
  const [boundaryOnly, setBoundaryOnly] = useLocalStorage<boolean>(
    'boundaryOnly',
    true,
  )
  const trains = useMemo(() => {
    if (!boundaryOnly) return allTrains
    return allTrains.filter((t) => {
      // Mock trains are already scoped to the post; live ones need their
      // timetable before we can tell, so they appear as it resolves.
      if (!t.live) return true
      const tt = timetables.get(t.number)
      if (!tt || !passesPost(tt, currentStation.name)) return false
      // Trains that have already worked past this post are no longer
      // dispatchable here and would just crowd the list.
      return !t.clearedPost
    })
  }, [allTrains, boundaryOnly, timetables, currentStation.name])

  const serversByRegion = useMemo(() => {
    const groups = new Map<ServerRegion, Server[]>()
    for (const s of servers) {
      const list = groups.get(s.region) ?? []
      list.push(s)
      groups.set(s.region, list)
    }
    return groups
  }, [servers])

  // Scheduled times come from the in-game clock, which runs on its own offset
  // from wall time — comparing them against Date.now() would skew every ETA.
  const nowSec = serverNowSec ?? simNowSec
  const hasLiveTimetables = timetables.size > 0
  // The mock set is the first-paint fallback; every API train carries `live`.
  const hasLiveTrains = rawTrains.some((t) => t.live)
  // Boundary filtering cannot classify a train until its timetable lands, so
  // an empty list during that window means "still matching", not "no trains".
  // The pending counter alone misses the first render, before the fetch
  // effect has run.
  const matchingInProgress =
    timetablePending > 0 ||
    (boundaryOnly && liveTrainNos.length > 0 && timetables.size === 0)

  // Seven of the 61 playable posts are named differently in the timetable
  // (they appear to be sub-posts controlled under a parent). Those show an
  // empty list forever, which reads as a broken app unless we say why.
  const postNamedInTimetables = useMemo(() => {
    for (const tt of timetables.values()) {
      if (passesPost(tt, currentStation.name)) return true
    }
    return false
  }, [timetables, currentStation.name])

  // An explicit pick wins; otherwise fall back to whichever train this Steam
  // id is driving. Both are looked up in the unfiltered live set, since the
  // driver's train is usually nowhere near the dispatch post.
  const driverTrain = useMemo(() => {
    if (driverTrainNo) {
      const picked = allTrains.find((t) => t.number === driverTrainNo)
      if (picked) return picked
    }
    const id = steamId.trim()
    if (id) return allTrains.find((t) => t.controlledBy === id) ?? null
    return null
  }, [allTrains, driverTrainNo, steamId])

  const driverCandidates = useMemo(() => {
    const q = driverQuery.trim().toLowerCase()
    const pool = q
      ? allTrains.filter(
          (t) =>
            t.number.toLowerCase().includes(q) ||
            t.type.toLowerCase().includes(q),
        )
      : allTrains.filter((t) => t.driver === 'player')
    return pool.slice(0, 60)
  }, [allTrains, driverQuery])

  // Built from every train at the post, not the filtered list: a schematic
  // that hides trains because of a category filter would misrepresent the
  // line.
  const schematicLines = useMemo(
    () => buildSchematic(trains, timetables, currentStation.name, serverNowSec),
    [trains, timetables, currentStation.name, serverNowSec],
  )

  const visibleStations = useMemo(() => {
    const q = stationQuery.trim().toLowerCase()
    if (!q) return stations
    return stations.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.prefix.toLowerCase().includes(q),
    )
  }, [stations, stationQuery])

  const conflicts = useMemo(() => detectConflicts(trains), [trains])

  // Conflicts are a property of the railway, not of the current filter, so
  // they are detected across every train at this post. That means a listed
  // train can name a partner the category filter or search is hiding — so the
  // number is a tap target that opens it regardless of what is on screen.
  const trainsByNumber = useMemo(
    () => new Map(trains.map((t) => [t.number, t])),
    [trains],
  )
  const openTrainByNumber = useCallback(
    (n: string) => {
      const t = trainsByNumber.get(n)
      if (t) setSelectedTrain(t)
    },
    [trainsByNumber],
  )
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
    const filtered = trains.filter((t) => {
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
  }, [trains, currentFilter, searchQuery, nowSec])

  // Counts per filter — respects current search so numbers match visible list.
  const filterCounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const bySearch = trains.filter(
      (t) =>
        !q ||
        t.number.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q),
    )
    return {
      all: bySearch.length,
      player: bySearch.filter((t) => t.driver === 'player').length,
      passenger: bySearch.filter((t) => t.category === 'passenger').length,
      freight: bySearch.filter((t) => t.category === 'freight').length,
      delayed: bySearch.filter((t) => t.delay > 0).length,
      approaching: bySearch.filter((t) => t.status === 'approaching').length,
    } as Record<Filter, number>
  }, [trains, searchQuery])

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
      {/* Sticky stack: header + (timetable-only) filter row */}
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md">
      <header className="border-b border-slate-800 px-4 pt-3 pb-2">
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
              <p className="text-[11px] text-slate-400 leading-none">
                SimRail · Installable
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              hapticTap()
              setShowServerModal(true)
            }}
            aria-label={`Server: ${currentServer.label}. Tap to change.`}
            className="text-xs bg-slate-800 px-2.5 py-1.5 rounded-full border border-slate-700 flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <span
              title={
                trainsState.error
                  ? `Live feed error: ${trainsState.error}`
                  : trainsState.loading
                  ? 'Fetching live data...'
                  : 'Live'
              }
              className={`w-1.5 h-1.5 rounded-full ${
                trainsState.error
                  ? 'bg-red-400'
                  : trainsState.loading
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-green-400 animate-pulse'
              }`}
            />
            <span className="font-semibold uppercase">{currentServer.code}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-slate-400"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        <button
          onClick={() => setShowStationModal(true)}
          className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-left"
        >
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">
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
      {/* Filters (inside sticky wrapper — stays glued to header) */}
      <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900">
        <div className="flex gap-2 overflow-x-auto scroll-hide pb-0.5">
          {filters.map((f) => {
            const active = currentFilter === f.id
            const count = filterCounts[f.id]
            return (
              <button
                key={f.id}
                onClick={() => {
                  hapticTap()
                  setCurrentFilter(f.id)
                }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? 'bg-sky-400 text-slate-950'
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                <span>{f.label}</span>
                <span
                  className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
                    active
                      ? 'bg-slate-950/20 text-slate-950'
                      : 'bg-slate-950/60 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
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

      {/* Sample data must announce itself. When the API is slow or down the
          app falls back to the mock train set, which looks entirely
          plausible — real-looking numbers, times and platforms. Planning
          moves against invented trains is far worse than an empty screen. */}
      {!hasLiveTrains && (
        <div className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 text-[11px] text-amber-300 flex items-center gap-2">
          <span className="font-semibold">Sample data</span>
          <span className="text-amber-200/80">
            {trainsState.error
              ? 'Live feed unreachable — these trains are not real.'
              : 'Waiting for the live feed…'}
          </span>
        </div>
      )}

      {/* The old "Posts mapped" legend lived here. It hardcoded Skierniewice's
          P/S/M posts, which is wrong for the other 60 stations now that the
          list comes from the API — and each row already names its own onward
          point and line. */}

        </>
      )}
      </div>
      {/* End sticky stack */}

      {view === 'timetable' && (
        <main
          className={`flex-1 overflow-y-auto pb-24 ${
            density === 'cards' ? 'px-3 py-3 space-y-2.5' : ''
          }`}
        >
          {filteredTrains.length === 0 ? (
            <div className="text-center py-16 text-slate-500 space-y-3">
              <p className="text-sm">
                {matchingInProgress
                  ? 'Matching trains to this post…'
                  : boundaryOnly && !postNamedInTimetables && hasLiveTimetables
                  ? `No booked train names ${currentStation.name} as its controlling post`
                  : 'No trains match the current filter'}
              </p>
              {!matchingInProgress &&
                boundaryOnly &&
                !postNamedInTimetables &&
                hasLiveTimetables && (
                  <p className="text-xs text-slate-600 max-w-xs mx-auto">
                    It may be a sub-post controlled under a parent station.
                    Turn off “This post only” to see every train on the server.
                  </p>
                )}
              {matchingInProgress ? (
                <p className="text-xs text-slate-600">
                  {timetablePending} timetable
                  {timetablePending === 1 ? '' : 's'} still loading
                </p>
              ) : (
                <button
                  onClick={() => {
                    setCurrentFilter('all')
                    setSearchQuery('')
                    setBoundaryOnly(false)
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40"
                >
                  Clear filter
                </button>
              )}
            </div>
          ) : density === 'cards' ? (
            filteredTrains.map((t) => (
              <TrainCard
                key={t.number}
                train={t}
                nowSec={nowSec}
                conflictsWith={conflicts.get(t.number) ?? []}
                onOpen={setSelectedTrain}
                onOpenNumber={openTrainByNumber}
              />
            ))
          ) : density === 'table' ? (
            <TrainTable
              trains={filteredTrains}
              conflicts={conflicts}
              onOpen={setSelectedTrain}
            />
          ) : (
            <ul>
              {filteredTrains.map((t) => (
                <TrainRow
                  key={t.number}
                  train={t}
                  nowSec={nowSec}
                  conflictsWith={conflicts.get(t.number) ?? []}
                  expanded={expandedRow === t.number}
                  onToggle={(n) =>
                    setExpandedRow((cur) => (cur === n ? null : n))
                  }
                  onOpen={setSelectedTrain}
                  onOpenNumber={openTrainByNumber}
                />
              ))}
            </ul>
          )}
        </main>
      )}

      {view === 'settings' && (
        <main className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-5">
          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
              List density
            </h2>
            <div className="space-y-2">
              {DENSITY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    hapticTap()
                    setDensity(opt.id)
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                    density === opt.id
                      ? 'bg-sky-500/15 border-sky-500/50'
                      : 'bg-slate-900 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-sm font-semibold ${
                        density === opt.id ? 'text-sky-300' : 'text-white'
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {opt.fits}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{opt.hint}</p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Driver
            </h2>
            <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <label
                htmlFor="steamId"
                className="block text-sm font-semibold text-white"
              >
                Your Steam ID
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5 mb-2">
                17-digit Steam64 id. Used only to spot which train you are
                driving — it never leaves the device.
              </p>
              <input
                id="steamId"
                type="text"
                inputMode="numeric"
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
                placeholder="76561198000000000"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
              {steamId.trim() && (
                <p className="text-[11px] mt-1.5">
                  {driverTrain && driverTrain.controlledBy === steamId.trim() ? (
                    <span className="text-emerald-400">
                      Matched train {driverTrain.number}
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      No train on {currentServer.label} is being driven by this
                      id right now.
                    </span>
                  )}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Scope
            </h2>
            <button
              onClick={() => {
                hapticTap()
                setBoundaryOnly(!boundaryOnly)
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800"
            >
              <span className="text-left">
                <span className="block text-sm font-semibold text-white">
                  This post only
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Show only trains routed through {currentStation.name}
                </span>
              </span>
              <span
                className={`w-11 h-6 rounded-full p-0.5 shrink-0 transition-colors ${
                  boundaryOnly ? 'bg-sky-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    boundaryOnly ? 'translate-x-5' : ''
                  }`}
                />
              </span>
            </button>
          </section>

          <section className="text-[11px] text-slate-500 space-y-1">
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Build
            </h2>
            {/* So "am I actually running the new APK?" is answerable without
                guessing. Matches the versionName Android reports. */}
            <p>
              Version{' '}
              <span className="font-mono text-slate-300">
                {buildInfo.versionName}
              </span>
            </p>
            <p>
              Built{' '}
              <span className="font-mono text-slate-300">
                {buildInfo.builtAt.slice(0, 16).replace('T', ' ')} UTC
              </span>
            </p>
          </section>

          <section className="text-[11px] text-slate-500 space-y-1">
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Data
            </h2>
            <p>
              Server clock:{' '}
              <span className="font-mono text-slate-300">
                {serverNowSec === null
                  ? 'syncing…'
                  : `${String(Math.floor(serverNowSec / 3600)).padStart(2, '0')}:${String(
                      Math.floor(serverNowSec / 60) % 60,
                    ).padStart(2, '0')}`}
              </span>
            </p>
            <p>
              Timetables cached:{' '}
              <span className="font-mono text-slate-300">{timetables.size}</span>
              {timetablePending > 0 && ` · ${timetablePending} loading`}
            </p>
            {timetableUnresolved > 0 && (
              <p className="text-amber-400">
                {timetableUnresolved} train
                {timetableUnresolved === 1 ? '' : 's'} have no timetable after{' '}
                retries — hidden while “This post only” is on.
              </p>
            )}
          </section>
        </main>
      )}

      {view === 'driver' &&
        (driverTrain ? (
          <DriverView
            train={driverTrain}
            timetable={timetables.get(driverTrain.number)}
            nowSec={serverNowSec}
            onChangeTrain={() => setShowDriverPicker(true)}
          />
        ) : (
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center pb-32">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4 text-2xl">
              🚂
            </div>
            <h2 className="text-lg font-semibold text-white mb-1">
              No train selected
            </h2>
            <p className="text-sm text-slate-400 max-w-xs mb-4">
              {steamId.trim()
                ? 'No train on this server is being driven by your Steam ID right now.'
                : 'Add your Steam ID in Settings to pick up your train automatically, or choose one manually.'}
            </p>
            <button
              onClick={() => {
                hapticTap()
                setShowDriverPicker(true)
              }}
              className="text-sm font-medium px-4 py-2 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40"
            >
              Choose train
            </button>
          </main>
        ))}

      {view === 'map' && (
        <SchematicMap
          lines={schematicLines}
          postName={currentStation.name}
          onOpen={setSelectedTrain}
        />
      )}

      {/* Driver train picker */}
      {showDriverPicker && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowDriverPicker(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900 rounded-t-2xl border-t border-slate-700 max-h-[75vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">Your train</h2>
                <button
                  onClick={() => setShowDriverPicker(false)}
                  className="text-slate-400 p-1 text-lg"
                >
                  ✕
                </button>
              </div>
              <input
                type="search"
                value={driverQuery}
                onChange={(e) => setDriverQuery(e.target.value)}
                placeholder="Search any train number…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                {driverQuery.trim()
                  ? 'All trains matching your search'
                  : `${driverCandidates.length} player-driven train${driverCandidates.length === 1 ? '' : 's'} on this server`}
              </p>
            </div>
            <div className="overflow-y-auto p-3 space-y-1.5">
              {driverCandidates.length === 0 && (
                <p className="text-center text-sm text-slate-500 py-8">
                  No trains match
                </p>
              )}
              {driverCandidates.map((t) => (
                <button
                  key={t.number}
                  onClick={() => {
                    hapticTap()
                    setDriverTrainNo(t.number)
                    setDriverQuery('')
                    setShowDriverPicker(false)
                  }}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl flex items-center justify-between ${
                    t.number === driverTrain?.number
                      ? 'bg-sky-500/15 border border-sky-500/40'
                      : 'border border-transparent hover:bg-slate-800'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-white">
                      {t.number}
                      <span
                        className={`ml-2 text-[10px] font-sans px-1.5 py-0.5 rounded ${priorityChipCls(t.priority)}`}
                      >
                        {t.type}
                      </span>
                      {t.controlledBy && t.controlledBy === steamId.trim() && (
                        <span className="ml-1.5 text-[10px] font-sans font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950">
                          YOU
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {t.from} → {t.toPost}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0 ml-2">
                    {t.speed} km/h
                  </span>
                </button>
              ))}
              {driverTrainNo && (
                <button
                  onClick={() => {
                    hapticTap()
                    setDriverTrainNo('')
                    setShowDriverPicker(false)
                  }}
                  className="w-full text-center text-[12px] text-slate-400 py-2"
                >
                  Clear manual pick — follow my Steam ID instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Install prompt for PWA */}
      <InstallPrompt />

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-4 py-2.5 safe-bottom z-30">
        <div className="flex items-center justify-around text-[11px]">
          {NAV_ITEMS.map((item) => {
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  hapticTap()
                  setView(item.id)
                }}
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
            <div className="px-4 py-3 border-b border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">
                  Select Station{' '}
                  <span className="text-[11px] font-normal text-slate-500">
                    {stations.length} posts
                  </span>
                </h2>
                <button
                  onClick={() => setShowStationModal(false)}
                  className="text-slate-400 p-1 text-lg"
                >
                  ✕
                </button>
              </div>
              {/* 61 posts is too many to scroll blind. */}
              <input
                type="search"
                value={stationQuery}
                onChange={(e) => setStationQuery(e.target.value)}
                placeholder="Search station…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="overflow-y-auto p-3 space-y-1.5">
              {visibleStations.length === 0 && (
                <p className="text-center text-sm text-slate-500 py-8">
                  No station matches “{stationQuery}”
                </p>
              )}
              {visibleStations.map((s) => {
                const active = s.name === currentStation.name
                return (
                  <button
                    key={s.name}
                    onClick={() => {
                      hapticTap()
                      setCurrentStation(s)
                      setStationQuery('')
                      setShowStationModal(false)
                    }}
                    className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between ${
                      active
                        ? 'bg-sky-500/15 border border-sky-500/40'
                        : 'hover:bg-slate-800 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0">
                      <p
                        className={`font-medium ${active ? 'text-sky-400' : 'text-white'}`}
                      >
                        {s.name}
                        {s.prefix && (
                          <span className="ml-1.5 text-[11px] font-mono text-slate-500">
                            {s.prefix}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Difficulty {s.difficulty}/5
                        {s.dispatchedBy > 0 && (
                          <span className="text-emerald-400">
                            {' '}
                            · manned by {s.dispatchedBy}
                          </span>
                        )}
                      </p>
                    </div>
                    {active && <span className="text-sky-400 text-sm">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Server Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowServerModal(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900 rounded-t-2xl border-t border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Select Server</h2>
                <p className="text-[11px] text-slate-400">
                  Timetables and dispatch state are per-server.
                </p>
              </div>
              <button
                onClick={() => setShowServerModal(false)}
                className="text-slate-400 p-1 text-lg"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-4">
              {Array.from(serversByRegion.entries()).map(([region, list]) => (
                <div key={region}>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold px-1 mb-1.5">
                    {REGION_LABEL[region]}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {list.map((s) => {
                      const active = s.code === currentServer.code
                      return (
                        <button
                          key={s.code}
                          onClick={() => {
                            hapticTap()
                            setServerCode(s.code)
                            setShowServerModal(false)
                          }}
                          className={`px-2 py-3 rounded-xl text-center font-mono font-bold uppercase text-sm ${
                            active
                              ? 'bg-sky-500/15 border border-sky-500/40 text-sky-300'
                              : 'bg-slate-800 border border-slate-700 text-slate-200 hover:border-slate-600'
                          }`}
                        >
                          {s.code}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
