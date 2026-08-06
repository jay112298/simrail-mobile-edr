// SimRail public panel API client.
// Base: https://panel.simrail.eu:8084 — no auth, CORS reflects Origin.
//
// Endpoints used:
//   GET /servers-open           → all servers
//   GET /trains-open?serverCode → live trains for one server
//   GET /stations-open?serverCode → station list + current dispatcher
//
// The richer timetable feed lives on api1.aws.simrail.eu:8082, which sends
// no CORS headers at all. It is reached natively via CapacitorHttp (and a
// Vite proxy in dev) — see lib/timetable.ts. No server-side proxy needed.

import type {
  Category,
  DispatchStation,
  Driver,
  Server,
  ServerRegion,
  Train,
} from '../data'

const BASE = 'https://panel.simrail.eu:8084'

type Envelope<T> = { result: boolean; data: T }

type ApiServer = {
  ServerCode: string
  ServerName: string
  ServerRegion: string
  IsActive: boolean
  id: string
}

type ApiTrainData = {
  ControlledBySteamID: string | null
  ControlledByXboxID: string | null
  InBorderStationArea: boolean
  Latititute: number
  Longitute: number
  Velocity: number
  SignalInFront: string | null
  DistanceToSignalInFront: number
  SignalInFrontSpeed: number
  VDDelayedTimetableIndex: number
}

type ApiTrain = {
  TrainNoLocal: string
  TrainName: string
  StartStation: string
  EndStation: string
  Vehicles: string[]
  ServerCode: string
  TrainData: ApiTrainData
  RunId: string
  id: string
  Type: 'bot' | 'user'
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`API ${path} → HTTP ${res.status}`)
  const body = (await res.json()) as Envelope<T>
  if (!body.result) throw new Error(`API ${path} → result=false`)
  return body.data
}

// --- Servers -----------------------------------------------------------

// Server codes seen live: pl1-5, de1-3, fr1, cz1, int1-9, xbx1-3.
// The international and Xbox servers are English-speaking, so they belong
// under EN — matching them on a two-letter prefix filed them under PL.
export function normalizeRegion(code: string): ServerRegion {
  const c = code.toLowerCase()
  if (c.startsWith('pl')) return 'PL'
  if (c.startsWith('de')) return 'DE'
  if (c.startsWith('fr')) return 'FR'
  if (c.startsWith('cz')) return 'CS'
  return 'EN'
}

function mapServer(s: ApiServer): Server {
  return {
    code: s.ServerCode.toLowerCase(),
    region: normalizeRegion(s.ServerCode),
    // Strip parenthetical suffixes like " (Polski) [BEZ WYDARZEŃ]".
    label: s.ServerName.replace(/\s*\[.*?\]/g, '').trim(),
  }
}

export async function fetchServers(signal?: AbortSignal): Promise<Server[]> {
  const data = await fetchJson<ApiServer[]>('/servers-open', signal)
  return data
    .filter((s) => s.IsActive)
    .map(mapServer)
    // Group PL → EN/INT → DE → CS → FR order (matches server picker layout).
    .sort((a, b) => {
      const rank: Record<ServerRegion, number> = {
        PL: 0,
        EN: 1,
        DE: 2,
        CS: 3,
        FR: 4,
      }
      const r = rank[a.region] - rank[b.region]
      return r !== 0 ? r : a.code.localeCompare(b.code)
    })
}

// --- Stations ----------------------------------------------------------

type ApiStation = {
  Name: string
  Prefix: string
  DifficultyLevel: number
  DispatchedBy: { ServerCode: string; SteamId: string | null }[] | null
}

/**
 * Every dispatch post a player can take on this server (61 on PL1).
 *
 * Sorted by name so the picker is scannable; the caller groups or filters.
 * Station `Name` is the join key against the timetable's `supervisedBy`.
 */
export async function fetchStations(
  serverCode: string,
  signal?: AbortSignal,
): Promise<DispatchStation[]> {
  const data = await fetchJson<ApiStation[]>(
    `/stations-open?serverCode=${encodeURIComponent(serverCode)}`,
    signal,
  )
  return data
    .map((s) => ({
      name: s.Name,
      prefix: s.Prefix,
      difficulty: s.DifficultyLevel,
      dispatchedBy: s.DispatchedBy?.length ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// --- Trains ------------------------------------------------------------

// Train priority derived from TrainName field: SimRail encodes it as
// "<carrier> - <class>" e.g. "EIJ - EIP", "PKP IC - IC".
const CLASS_PRIORITY: Record<string, number> = {
  EIP: 1,
  EIC: 2,
  IC: 3,
  TLK: 4,
  MOJ: 5,
  ROJ: 5,
  R: 5,
  TME: 6,
  TNE: 6,
  TPE: 6,
}

function classifyTrain(name: string, trainNo: string): { type: string; priority: number; category: Category } {
  // Try each token in the name against the priority map.
  const tokens = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean)
  for (const tok of tokens) {
    if (tok in CLASS_PRIORITY) {
      const category: Category = /^T[A-Z]{2}$/.test(tok) ? 'freight' : 'passenger'
      return { type: tok, priority: CLASS_PRIORITY[tok], category }
    }
  }
  // Fallback by train number range (rough Polish scheme).
  const n = parseInt(trainNo, 10)
  if (!isNaN(n)) {
    if (n >= 1000 && n < 2000) return { type: 'EIP', priority: 1, category: 'passenger' }
    if (n >= 3000 && n < 5000) return { type: 'IC', priority: 3, category: 'passenger' }
    if (n >= 40000) return { type: 'TME', priority: 6, category: 'freight' }
  }
  return { type: 'R', priority: 5, category: 'passenger' }
}

// 32767 is SimRail's "no restriction" sentinel, not a real speed limit.
const SIGNAL_UNRESTRICTED = 32767

function mapTrain(t: ApiTrain): Train {
  const cls = classifyTrain(t.TrainName, t.TrainNoLocal)
  const driver: Driver = t.Type === 'user' ? 'player' : 'bot'
  const velocity = Math.max(0, Math.round(t.TrainData.Velocity))
  const toSignal = t.TrainData.DistanceToSignalInFront
  const signalLimit = t.TrainData.SignalInFrontSpeed
  // A null SignalInFront means the feed has no signal ahead for this train;
  // it zeroes the speed and distance fields too. Reading that zero as a
  // speed limit would flag a moving train as held at a red.
  const hasSignal = t.TrainData.SignalInFront !== null

  // /trains-open carries live telemetry only — no scheduled arr/dep, no
  // platform, no consist weights. Those stay sentinels until the timetable
  // proxy lands; `live: true` tells the UI to render telemetry rather than
  // a timetable it does not have.
  return {
    number: t.TrainNoLocal,
    type: cls.type,
    category: cls.category,
    driver,
    priority: cls.priority,
    line: '-',
    from: t.StartStation,
    toPost: t.EndStation,
    arrival: '--:--',
    departure: '--:--',
    platform: '-',
    delay: 0,
    status: velocity === 0 ? 'standing' : 'enroute',
    distance: 0,
    length: 0,
    weight: 0,
    speed: velocity,
    maxSpeed: 0,
    signalState: hasSignal ? signalState(signalLimit) : 'unknown',
    stops: [],

    live: true,
    timetableIndex: t.TrainData.VDDelayedTimetableIndex,
    signalDistance:
      hasSignal && Number.isFinite(toSignal)
        ? Math.max(0, Math.round(toSignal))
        : undefined,
    signalSpeed:
      hasSignal && signalLimit > 0 && signalLimit < SIGNAL_UNRESTRICTED
        ? signalLimit
        : undefined,
    vehicles: t.Vehicles,
  }
}

function signalState(speedLimit: number): Train['signalState'] {
  // SimRail signal semantics:
  //   0        → red (stop)
  //   32767    → clear / unknown ahead
  //   >0 < max → yellow (restrictive)
  if (speedLimit === 0) return 'red'
  if (speedLimit >= SIGNAL_UNRESTRICTED) return 'green'
  if (speedLimit > 0) return 'yellow'
  return 'unknown'
}

/**
 * SimRail vehicle ids look like "201E/ET22-836:R" or
 * "Pendolino/ED250-001 Variant". Pull out the recognisable stock name.
 */
export function vehicleName(raw: string): string {
  const afterSlash = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw
  return afterSlash.split(':')[0].replace(/\s+Variant$/i, '').trim()
}

export async function fetchTrains(
  serverCode: string,
  signal?: AbortSignal,
): Promise<Train[]> {
  const data = await fetchJson<ApiTrain[]>(
    `/trains-open?serverCode=${encodeURIComponent(serverCode)}`,
    signal,
  )
  return data.map(mapTrain)
}
