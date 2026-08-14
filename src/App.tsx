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
import {
  STATE_ORDER,
  STATE_STYLE,
  isPresentAtPost,
  trainState,
  type TrainState,
} from './lib/trainState'
import { useServers, useStations, useTrains } from './lib/useLive'
import {
  computeETASec,
  detectConflicts,
  etaLabel,
  etaUrgency,
  hhmmToSec,
  sortByETA,
  useSimNow,
} from './lib/dispatch'
import { useServerTime } from './lib/useTimetable'
import { rowToTrain } from './lib/enrich'
import { useEdrTimetable } from './lib/useEdrTimetable'
import {
  buildPointIndex,
  rowsForStation,
  wrapDiff,
  type EdrTrain,
} from './lib/edrTimetable'
import { usePrioritySchedules } from './lib/usePrioritySchedules'
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
import {
  ALERT_HINT,
  ALERT_LABEL,
  DEFAULT_ALERT_SETTINGS,
  tonesFor,
  type AlertKind,
  type AlertSettings,
} from './lib/alerts'
import { useAlerts, useWakeLock } from './lib/useAlerts'
import { playTones, unlockAudio, vibrate } from './lib/sound'

type Filter = 'all' | 'player' | 'passenger' | 'freight' | 'delayed' | 'approaching'
// "live" was a stub and is redundant now that the timetable carries live
// speed and signals; the slot is driver mode instead. Existing installs have
// 'live' persisted, so it is migrated on read.
type View = 'timetable' | 'driver' | 'map' | 'settings'

function migrateView(v: string): View {
  return v === 'live' ? 'driver' : (v as View)
}

/**
 * How many nearby trains get a single-schedule fetch before the bulk
 * download. Enough to fill the screen several times over at a busy post,
 * small enough to finish in seconds.
 */
const PRIORITY_LIMIT = 40

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
  // Scheduled times come from the in-game clock, which runs on its own offset
  // from wall time — comparing them against Date.now() would skew every ETA.
  const nowSec = serverNowSec ?? simNowSec


  // Live telemetry, keyed by train number, to decorate schedule rows.
  const liveByNumber = useMemo(() => {
    const map = new Map<string, Train>()
    for (const t of rawTrains) {
      if (!t.live) continue
      const withDistance =
        t.lat != null &&
        t.lon != null &&
        currentStation.lat != null &&
        currentStation.lon != null
          ? {
              ...t,
              distance: haversineKm(
                t.lat,
                t.lon,
                currentStation.lat,
                currentStation.lon,
              ),
            }
          : t
      map.set(t.number, withDistance)
    }
    return map
  }, [rawTrains, currentStation.lat, currentStation.lon])

  /**
   * Driver mode searches every live train, not the station's rows.
   *
   * The train you are driving is usually nowhere near the post you are
   * dispatching — scoping this to station rows meant a correct Steam ID still
   * reported "no train selected" whenever your train did not happen to pass
   * that station.
   */
  const driverPool = useMemo(
    () => rawTrains.filter((t) => t.live),
    [rawTrains],
  )

  const driverTrain = useMemo(() => {
    if (driverTrainNo) {
      const picked = driverPool.find((t) => t.number === driverTrainNo)
      if (picked) return picked
    }
    const id = steamId.trim()
    if (id) return driverPool.find((t) => t.controlledBy === id) ?? null
    return null
  }, [driverPool, driverTrainNo, steamId])

  const driverCandidates = useMemo(() => {
    const q = driverQuery.trim().toLowerCase()
    const pool = q
      ? driverPool.filter(
          (t) =>
            t.number.toLowerCase().includes(q) ||
            t.type.toLowerCase().includes(q),
        )
      : driverPool.filter((t) => t.driver === 'player')
    return pool.slice(0, 60)
  }, [driverPool, driverQuery])

  /**
   * Live trains ordered by how close they are to the post.
   *
   * Their single-train schedules are pulled in this order, so the trains
   * about to matter resolve first and the list is usable within seconds —
   * rather than waiting on the whole-server download, which can take minutes
   * on a phone.
   */
  const priorityTrainNos = useMemo(() => {
    const live = rawTrains.filter((t) => t.live)
    if (currentStation.lat == null || currentStation.lon == null) {
      return live.slice(0, PRIORITY_LIMIT).map((t) => t.number)
    }
    return live
      .map((t) => ({
        n: t.number,
        d:
          t.lat != null && t.lon != null
            ? haversineKm(t.lat, t.lon, currentStation.lat!, currentStation.lon!)
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.d - b.d)
      // Most live trains are hundreds of kilometres away and will never
      // appear at this post. Fetching their schedules just delays the ones
      // that will; the bulk download picks up the rest.
      .slice(0, PRIORITY_LIMIT)
      .map((x) => x.n)
  }, [rawTrains, currentStation.lat, currentStation.lon])

  // Your own train's schedule is wanted first whatever its distance — driver
  // mode is useless without it, and it is rarely near the post.
  const prioritised = useMemo(() => {
    const own = driverTrain?.number
    if (!own) return priorityTrainNos
    return [own, ...priorityTrainNos.filter((n) => n !== own)]
  }, [priorityTrainNos, driverTrain])

  const priority = usePrioritySchedules(currentServer.code, prioritised, true)

  /**
   * The whole-server schedule. Its cache is read immediately, but the ~21 MB
   * network fetch waits until the nearest-first pass has finished so the two
   * do not compete for a slow, rate-limited endpoint.
   */
  const edr = useEdrTimetable(
    currentServer.code,
    // Wait for the live feed to resolve, then start once the nearest-first
    // pass is done — or immediately if it produced no work at all. Requiring
    // `total > 0` deadlocked a server with no live trains: there was nothing
    // to prioritise, so the bulk download never started and the app stayed
    // permanently empty with no error.
    !trainsState.loading &&
      (priority.total === 0 || priority.done >= priority.total),
  )

  /**
   * The full schedule when it is in, otherwise whatever the fast path has
   * gathered. Both produce identical objects, so nothing downstream cares
   * which it is looking at.
   */
  const scheduleTrains = useMemo(
    () => (edr.trains.length > 0 ? edr.trains : [...priority.schedules.values()]),
    [edr.trains, priority.schedules],
  )

  const pointIndex = useMemo(
    () => (edr.trains.length > 0 ? edr.pointIndex : buildPointIndex(scheduleTrains)),
    [edr.trains, edr.pointIndex, scheduleTrains],
  )

  // The station's own point ids. Matching numerically avoids comparing Polish
  // station names with diacritics, and is how the official EDR does it.
  const stationPointIds = useMemo(
    () => pointIndex.get(currentStation.name) ?? new Set<string>(),
    [pointIndex, currentStation.name],
  )

  /**
   * Every train booked through this station, decorated with live data where
   * the train is actually running.
   *
   * This is the timetable, not a view of traffic: previously the list was
   * built from spawned trains and filtered, so a post showed only the handful
   * currently running (41 of 487 booked through Skierniewice on one sample).
   */
  const allTrains = useMemo(() => {
    if (scheduleTrains.length === 0 || stationPointIds.size === 0) return []
    return rowsForStation(scheduleTrains, stationPointIds).map((row) =>
      rowToTrain(row, liveByNumber.get(row.train.trainNo), serverNowSec),
    )
  }, [scheduleTrains, stationPointIds, liveByNumber, serverNowSec])

  // Opt-in narrowing. The default is the whole booked timetable, matching the
  // official EDR — restricting to running trains is a view, not the truth.
  const [onlyOnTrack, setOnlyOnTrack] = useLocalStorage<boolean>(
    'onlyOnTrack',
    false,
  )
  const [windowHours, setWindowHours] = useLocalStorage<number>('windowHours', 2)

  // Conflicts are judged across every train booked through the post, not the
  // windowed view — a clash with a train just outside the window is still a
  // clash, and hiding it would be the same mistake as filtering the list.
  const conflicts = useMemo(() => detectConflicts(allTrains), [allTrains])

  const stateByNumber = useMemo(() => {
    const map = new Map<string, TrainState>()
    for (const t of allTrains) {
      const eta = computeETASec(t, nowSec)
      const inConflict = (conflicts.get(t.number)?.length ?? 0) > 0
      map.set(t.number, trainState(t, eta, inConflict))
    }
    return map
  }, [allTrains, conflicts, nowSec])

  const trains = useMemo(() => {
    let rows = allTrains
    if (onlyOnTrack) rows = rows.filter((t) => t.live)
    if (windowHours > 0 && serverNowSec !== null) {
      const span = windowHours * 3600
      rows = rows.filter((t) => {
        // A train at or arriving into the platform stays no matter what the
        // window says — it is the one being worked right now.
        const state = stateByNumber.get(t.number)
        if (state && isPresentAtPost(state)) return true
        const arr = hhmmToSec(t.arrival) ?? hhmmToSec(t.departure)
        if (arr === null) return true
        const d = wrapDiff(arr, serverNowSec)
        // Keep a little history so a train that just cleared is still visible.
        return d > -30 * 60 && d < span
      })
    }
    return rows
  }, [allTrains, onlyOnTrack, windowHours, serverNowSec, stateByNumber])

  const serversByRegion = useMemo(() => {
    const groups = new Map<ServerRegion, Server[]>()
    for (const s of servers) {
      const list = groups.get(s.region) ?? []
      list.push(s)
      groups.set(s.region, list)
    }
    return groups
  }, [servers])

  const hasLiveTimetables = scheduleTrains.length > 0
  // The mock set is the first-paint fallback; every API train carries `live`.
  const hasLiveTrains = rawTrains.some((t) => t.live)
  // Still gathering if neither path has produced anything to show yet.
  const matchingInProgress =
    edr.loading || priority.done < priority.total

  // A post the schedule never names has no rows, which reads as a broken app
  // unless we say so.
  const postNamedInTimetables = stationPointIds.size > 0

  const edrByNo = useMemo(() => {
    const map = new Map<string, EdrTrain>()
    for (const t of scheduleTrains) map.set(t.trainNo, t)
    return map
  }, [scheduleTrains])

  // An explicit pick wins; otherwise fall back to whichever train this Steam
  // id is driving. Both are looked up in the unfiltered live set, since the
  // driver's train is usually nowhere near the dispatch post.

  // Built from every train at the post, not the filtered list: a schematic
  // that hides trains because of a category filter would misrepresent the
  // line.
  const schematicLines = useMemo(
    () => buildSchematic(trains, edrByNo, stationPointIds, serverNowSec),
    [trains, edrByNo, stationPointIds, serverNowSec],
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

  // Alerts watch every train at the post, not the filtered view — muting a
  // category in the list must not mute the problems it contains.
  const [storedAlerts, setAlertSettings] = useLocalStorage<AlertSettings>(
    'alerts',
    DEFAULT_ALERT_SETTINGS,
  )
  // Settings saved by an earlier build are returned verbatim, so any alert
  // kind added since would be missing and read as disabled. Merge over the
  // defaults rather than trusting the stored shape.
  const alertSettings: AlertSettings = useMemo(
    () => ({
      ...DEFAULT_ALERT_SETTINGS,
      ...storedAlerts,
      kinds: { ...DEFAULT_ALERT_SETTINGS.kinds, ...storedAlerts?.kinds },
    }),
    [storedAlerts],
  )
  const [keepAwake, setKeepAwake] = useLocalStorage<boolean>('keepAwake', false)
  const { supported: wakeLockSupported } = useWakeLock(keepAwake)
  // Set when the user taps an alert, so the named train can be found in the
  // list. Cleared on a timer — a permanent ring would become wallpaper.
  const [flashTrain, setFlashTrain] = useState<string | null>(null)

  const locateTrain = useCallback((number: string) => {
    setFlashTrain(number)
    setView('timetable')
    // Let the row render before scrolling to it.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-train="${number}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    window.setTimeout(() => setFlashTrain(null), 6000)
    // setView is stable; number is the only real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const {
    log: alertLog,
    clearLog,
    latest: latestAlert,
    dismissLatest,
  } = useAlerts(
    trains,
    conflicts,
    serverNowSec,
    alertSettings,
    // Only start sounding once the schedule and live positions are both in —
    // otherwise every restart alerts on the whole board.
    hasLiveTrains && !edr.loading && serverNowSec !== null,
  )

  const setAlertKind = (kind: AlertKind, on: boolean) =>
    setAlertSettings({
      ...alertSettings,
      kinds: { ...alertSettings.kinds, [kind]: on },
    })

  const filteredTrains = useMemo(() => {
    const filtered = trains.filter((t) => {
      if (currentFilter === 'player' && t.driver !== 'player') return false
      if (currentFilter === 'passenger' && t.category !== 'passenger')
        return false
      if (currentFilter === 'freight' && t.category !== 'freight') return false
      if (currentFilter === 'delayed' && t.delay <= 0) return false
      // `status` never carries 'approaching' — rowToTrain only produces
      // standing/enroute/scheduled — so this filter matched nothing. It now
      // uses the derived state, which is what the colour key shows.
      if (currentFilter === 'approaching') {
        const st = stateByNumber.get(t.number)
        if (st !== 'arriving' && st !== 'atPlatform' && st !== 'due') return false
      }
      if (
        searchQuery &&
        !t.number.includes(searchQuery) &&
        !t.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false
      return true
    })
    return sortByETA(filtered, nowSec)
  }, [trains, currentFilter, searchQuery, nowSec, stateByNumber])

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
      approaching: bySearch.filter((t) => {
        const st = stateByNumber.get(t.number)
        return st === 'arriving' || st === 'atPlatform' || st === 'due'
      }).length,
    } as Record<Filter, number>
  }, [trains, searchQuery, stateByNumber])

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
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md safe-top">
      {/* One compact row. The old layout spent a title block and a full-width
          station card on things that never change during a shift; that space
          belongs to trains. */}
      <header className="border-b border-slate-800 px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              hapticTap()
              setShowStationModal(true)
            }}
            aria-label={`Dispatch post: ${currentStation.name}. Tap to change.`}
            className="flex-1 min-w-0 text-left active:scale-[0.98] transition-transform"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500 leading-none">
              Post
            </p>
            <p className="text-base font-semibold text-white truncate leading-tight">
              {currentStation.name}
              <span className="text-slate-500 ml-1">▾</span>
            </p>
          </button>
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
      </header>

      {/* Every ETA, delay and conflict is measured against the in-game clock.
          Without it the app falls back to a fixed 08:00 reference, which
          produces confident, completely wrong times — worse than none. */}
      {serverNowSec === null && hasLiveTrains && (
        <div className="px-3 py-2 border-b border-amber-500/40 bg-amber-500/15 text-[11px] text-amber-200">
          <span className="font-semibold">Server clock unavailable</span> — ETAs
          and delays are not reliable until it syncs.
        </div>
      )}

      {/* Loading has to be legible, not a blank screen. Nearby schedules land
          first and the count climbs; the whole-server download continues
          behind them and only adds trains not yet running. */}
      {(priority.done < priority.total || edr.loading) && (
        <div className="px-3 py-1.5 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-300">
              {priority.done < priority.total
                ? 'Loading schedules — nearest trains first'
                : 'Loading full timetable in the background'}
            </span>
            <span className="font-mono text-slate-500">
              {priority.done < priority.total
                ? `${priority.done}/${priority.total}`
                : `${scheduleTrains.length} trains`}
            </span>
          </div>
          <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full bg-sky-500 ${
                priority.done < priority.total ? '' : 'animate-pulse'
              }`}
              style={{
                width:
                  priority.total > 0
                    ? `${Math.round((priority.done / priority.total) * 100)}%`
                    : '100%',
                transition: 'width 200ms linear',
              }}
            />
          </div>
        </div>
      )}

      {/* An alert with nowhere to land is just noise: this names the train and
          the reason, and tapping it finds the row. */}
      {latestAlert && (
        <button
          onClick={() => {
            hapticTap()
            locateTrain(latestAlert.trainNo)
            dismissLatest()
          }}
          className={`alert-in w-full flex items-center gap-2 px-3 py-2 text-left border-b ${
            latestAlert.kind === 'conflict' || latestAlert.kind === 'held'
              ? 'bg-red-500/20 border-red-500/50 text-red-200'
              : 'bg-amber-500/15 border-amber-500/40 text-amber-200'
          }`}
        >
          <span className="text-sm">
            {latestAlert.kind === 'conflict' || latestAlert.kind === 'held'
              ? '⚠'
              : '●'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] uppercase tracking-wider opacity-80 leading-none">
              {ALERT_LABEL[latestAlert.kind]}
            </span>
            <span className="block text-[13px] font-medium truncate">
              {latestAlert.message}
            </span>
          </span>
          <span className="text-[11px] font-semibold underline underline-offset-2 shrink-0">
            Show
          </span>
          <span
            role="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation()
              dismissLatest()
            }}
            className="px-1 text-lg leading-none opacity-70 shrink-0"
          >
            ×
          </span>
        </button>
      )}

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

      {/* Rows come from the booked schedule, so they stay correct without the
          live feed — but speed, signals, delay and every state colour depend
          on it. Say which half is missing rather than implying the trains
          themselves are fake, which is what this banner used to claim back
          when the mock set fed the list. */}
      {!hasLiveTrains && (
        <div className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 text-[11px] text-amber-300 flex items-center gap-2">
          <span className="font-semibold">No live positions</span>
          <span className="text-amber-200/80">
            {trainsState.error
              ? 'Live feed unreachable — times are booked, not actual.'
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
                  ? 'Loading the server timetable…'
                  : edr.error !== null
                  ? 'Could not load the server timetable'
                  : !postNamedInTimetables && hasLiveTimetables
                  ? `${currentStation.name} does not appear in the server timetable`
                  : 'No trains match the current filter'}
              </p>
              {!matchingInProgress &&
                !postNamedInTimetables &&
                edr.error === null &&
                hasLiveTimetables && (
                  <p className="text-xs text-slate-600 max-w-xs mx-auto">
                    No booked train stops at this point. It may be a sub-post
                    worked under a parent station — try that one instead.
                  </p>
                )}
              {matchingInProgress ? (
                <p className="text-xs text-slate-600">
                  The whole server's schedule downloads once, then is cached —
                  the first load can take a minute.
                </p>
              ) : edr.error !== null ? (
                <button
                  onClick={() => {
                    hapticTap()
                    edr.refresh()
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40"
                >
                  Retry
                </button>
              ) : (
                <button
                  onClick={() => {
                    setCurrentFilter('all')
                    setSearchQuery('')
                    setOnlyOnTrack(false)
                    setWindowHours(0)
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40"
                >
                  Clear filters
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
              stateOf={(n) => stateByNumber.get(n) ?? 'scheduled'}
              flashTrain={flashTrain}
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
                  state={stateByNumber.get(t.number) ?? 'scheduled'}
                  flash={flashTrain === t.number}
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
              Colour key
            </h2>
            <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              {STATE_ORDER.map((s) => {
                const style = STATE_STYLE[s]
                return (
                  <div
                    key={s}
                    className={`flex items-center gap-2.5 px-3 py-2 border-l-4 ${style.stripe} ${style.tint} border-b border-slate-800/60 last:border-b-0`}
                  >
                    <span className={`text-[11px] w-3 text-center ${style.text}`}>
                      {style.glyph}
                    </span>
                    <span className="text-[13px] text-slate-200">
                      {style.label}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              The stripe down the left of each row is its state. Pink matches
              the in-game timetable for a train arriving or standing at your
              platform.
            </p>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Alerts
            </h2>
            <button
              onClick={async () => {
                hapticTap()
                const turningOn = !alertSettings.enabled
                // Browsers keep audio suspended until a gesture; this tap is
                // that gesture, so unlock here or nothing plays later.
                if (turningOn) await unlockAudio()
                setAlertSettings({ ...alertSettings, enabled: turningOn })
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 mb-2"
            >
              <span className="text-left">
                <span className="block text-sm font-semibold text-white">
                  Audio alerts
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Sound and vibrate when something needs you
                </span>
              </span>
              <span
                className={`w-11 h-6 rounded-full p-0.5 shrink-0 transition-colors ${
                  alertSettings.enabled ? 'bg-sky-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    alertSettings.enabled ? 'translate-x-5' : ''
                  }`}
                />
              </span>
            </button>

            {alertSettings.enabled && (
              <div className="space-y-2">
                <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <label
                    htmlFor="lead"
                    className="flex items-center justify-between text-sm font-semibold text-white"
                  >
                    Approach warning
                    <span className="font-mono text-sky-300">
                      {alertSettings.leadMinutes} min
                    </span>
                  </label>
                  <input
                    id="lead"
                    type="range"
                    min={1}
                    max={15}
                    step={1}
                    value={alertSettings.leadMinutes}
                    onChange={(e) =>
                      setAlertSettings({
                        ...alertSettings,
                        leadMinutes: Number(e.target.value),
                      })
                    }
                    className="w-full mt-2 accent-sky-500"
                  />
                  <p className="text-[11px] text-slate-400">
                    How long before booked arrival to warn you.
                  </p>
                </div>

                <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <label
                    htmlFor="vol"
                    className="flex items-center justify-between text-sm font-semibold text-white"
                  >
                    Volume
                    <span className="font-mono text-sky-300">
                      {Math.round(alertSettings.volume * 100)}%
                    </span>
                  </label>
                  <input
                    id="vol"
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={alertSettings.volume * 100}
                    onChange={(e) =>
                      setAlertSettings({
                        ...alertSettings,
                        volume: Number(e.target.value) / 100,
                      })
                    }
                    className="w-full mt-2 accent-sky-500"
                  />
                </div>

                {(Object.keys(ALERT_LABEL) as AlertKind[]).map((kind) => (
                  <div
                    key={kind}
                    className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-2"
                  >
                    <button
                      onClick={() => {
                        hapticTap()
                        setAlertKind(kind, !alertSettings.kinds[kind])
                      }}
                      className="flex-1 text-left"
                    >
                      <span className="block text-sm font-semibold text-white">
                        {ALERT_LABEL[kind]}
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {ALERT_HINT[kind]}
                      </span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          await unlockAudio()
                          playTones(tonesFor(kind), alertSettings.volume)
                          vibrate(30)
                        }}
                        className="text-[11px] text-sky-400 px-2 py-1 rounded-lg border border-sky-500/40"
                      >
                        Play
                      </button>
                      <span
                        onClick={() => setAlertKind(kind, !alertSettings.kinds[kind])}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                          alertSettings.kinds[kind]
                            ? 'bg-sky-500'
                            : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                            alertSettings.kinds[kind] ? 'translate-x-4' : ''
                          }`}
                        />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                hapticTap()
                setKeepAwake(!keepAwake)
              }}
              disabled={!wakeLockSupported}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 mt-2 disabled:opacity-50"
            >
              <span className="text-left">
                <span className="block text-sm font-semibold text-white">
                  Keep screen awake
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  {wakeLockSupported
                    ? 'Stops the phone sleeping mid-shift'
                    : 'Not supported on this device'}
                </span>
              </span>
              <span
                className={`w-11 h-6 rounded-full p-0.5 shrink-0 transition-colors ${
                  keepAwake ? 'bg-sky-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    keepAwake ? 'translate-x-5' : ''
                  }`}
                />
              </span>
            </button>

            {alertLog.length > 0 && (
              <div className="mt-2 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    Recent
                  </span>
                  <button
                    onClick={clearLog}
                    className="text-[11px] text-slate-400"
                  >
                    Clear
                  </button>
                </div>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {alertLog.map((a) => (
                    <li
                      key={`${a.key}-${a.at}`}
                      className="text-[11px] flex items-baseline gap-2"
                    >
                      <span className="font-mono text-slate-500 shrink-0">
                        {new Date(a.at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-slate-300">{a.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
            {/* The list is the station's booked timetable. These narrow it;
                neither is on by default, because hiding booked trains is a
                view, not the truth. */}
            <button
              onClick={() => {
                hapticTap()
                setOnlyOnTrack(!onlyOnTrack)
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 mb-2"
            >
              <span className="text-left">
                <span className="block text-sm font-semibold text-white">
                  Running trains only
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Hide trains that have not spawned yet
                </span>
              </span>
              <span
                className={`w-11 h-6 rounded-full p-0.5 shrink-0 transition-colors ${
                  onlyOnTrack ? 'bg-sky-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    onlyOnTrack ? 'translate-x-5' : ''
                  }`}
                />
              </span>
            </button>

            <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <label
                htmlFor="window"
                className="flex items-center justify-between text-sm font-semibold text-white"
              >
                Time window
                <span className="font-mono text-sky-300">
                  {windowHours === 0 ? 'whole day' : `${windowHours} h ahead`}
                </span>
              </label>
              <input
                id="window"
                type="range"
                min={0}
                max={12}
                step={1}
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
                className="w-full mt-2 accent-sky-500"
              />
              <p className="text-[11px] text-slate-400">
                {stationPointIds.size > 0
                  ? `${allTrains.length} booked through ${currentStation.name} today · ${trains.length} shown`
                  : 'Waiting for the timetable'}
              </p>
            </div>
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
              Server timetable:{' '}
              <span className="font-mono text-slate-300">
                {edr.loading ? 'loading…' : `${edr.trains.length} trains`}
              </span>
              {edr.fetchedAt !== null &&
                ` · ${new Date(edr.fetchedAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
            </p>
            {edr.error !== null && (
              <p className="text-amber-400">Timetable error: {edr.error}</p>
            )}
            <button
              onClick={() => {
                hapticTap()
                edr.refresh()
              }}
              className="text-[11px] text-sky-400 px-2 py-1 rounded-lg border border-sky-500/40 mt-1"
            >
              Reload timetable
            </button>
          </section>
        </main>
      )}

      {view === 'driver' &&
        (driverTrain ? (
          <DriverView
            train={driverTrain}
            timetable={edrByNo.get(driverTrain.number)}
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
