// SimRail public panel API client.
// Base: https://panel.simrail.eu:8084 — no auth, CORS reflects Origin.
//
// Endpoints used:
//   GET /servers-open           → all servers
//   GET /trains-open?serverCode → live trains for one server
//   GET /stations-open?serverCode → station list + current dispatcher
//
// The richer timetable feed lives on api1.aws.simrail.eu:8082 but that
// host does NOT send CORS headers, so it cannot be called from the
// browser directly. When a dispatcher-grade timetable is needed we'll
// front it with a serverless proxy (later phase). This file sticks to
// what the browser can reach today.

import type { Category, Driver, Server, ServerRegion, Train } from '../data'

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

function normalizeRegion(code: string): ServerRegion {
  const prefix = code.slice(0, 2).toLowerCase()
  if (prefix === 'pl') return 'PL'
  if (prefix === 'de') return 'DE'
  if (prefix === 'fr') return 'FR'
  if (prefix === 'cz') return 'CS'
  if (prefix === 'en') return 'EN'
  return 'PL'
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

function mapTrain(t: ApiTrain): Train {
  const cls = classifyTrain(t.TrainName, t.TrainNoLocal)
  const driver: Driver = t.Type === 'user' ? 'player' : 'bot'
  const velocity = Math.max(0, Math.round(t.TrainData.Velocity))

  // /trains-open exposes only live telemetry — no scheduled arr/dep or
  // platform. Fill with sentinels until the timetable proxy lands.
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
    maxSpeed: velocity > 0 ? Math.max(velocity, 120) : 120,
    signalState: signalState(t.TrainData.SignalInFrontSpeed),
    stops: [],
  }
}

function signalState(speedLimit: number): Train['signalState'] {
  // SimRail signal semantics:
  //   0        → red (stop)
  //   32767    → clear / unknown ahead
  //   >0 < max → yellow (restrictive)
  if (speedLimit === 0) return 'red'
  if (speedLimit >= 32767) return 'green'
  if (speedLimit > 0) return 'yellow'
  return 'unknown'
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
