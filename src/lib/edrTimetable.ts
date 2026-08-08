// The EDR timetable feed — the whole server's schedule in one request.
//
// This replaces per-train getAllTimetables lookups, and fixes a design error:
// the list used to be built from /trains-open (only trains currently spawned)
// and then filtered down, so a post with little live traffic showed almost
// nothing. Measured on PL1: 487 trains are booked through Skierniewice across
// the day, of which ~41 are spawned at any moment.
//
// An EDR is the station's timetable. Rows come from the schedule; live
// telemetry is merged onto them, not the other way round. Same model the
// official simrail/EDR uses.
//
// The endpoint is heavily rate limited (the official backend allows itself
// roughly one request per 30 s per server), so responses are cached and never
// polled. Live position still comes from /trains-open every 15 s.

import { Capacitor } from '@capacitor/core'
import { idbGet, idbSet } from './idb'

const NATIVE_BASE = 'https://api.simrail.eu:8082/api'
const PROXY_BASE = '/simrail-timetable'

function apiBase(): string {
  return Capacitor.isNativePlatform() ? NATIVE_BASE : PROXY_BASE
}

export type EdrStopKind = 'pass' | 'commercial' | 'technical'

export type EdrStop = {
  index: number
  point: string
  pointId: string
  arrival: string
  departure: string
  arrivalSec: number | null
  departureSec: number | null
  /** Times SimRail has actually recorded, where the train has already run. */
  actualArrivalSec: number | null
  actualDepartureSec: number | null
  line: number | null
  platform: string | null
  track: number | null
  maxSpeed: number | null
  mileage: number
  kind: EdrStopKind
  /** Booked standing time in minutes. */
  plannedStop: number
  confirmed: boolean
  /** Service class at this point, e.g. "EIJ", "TME". */
  trainType: string
  /** Controlling dispatch post, where the feed names one. */
  supervisedBy: string | null
  /**
   * Point lies outside the simulated area. SimRail still lists these but
   * fills them with stubs — line 0, mileage 0 — so their fields mean nothing.
   */
  offMap: boolean
}

export type EdrTrain = {
  trainNo: string
  trainName: string
  startStation: string
  endStation: string
  carrier: string | null
  stops: EdrStop[]
}

// Shape of getAllTimetables. It carries pointId, which is the join key, and
// is markedly faster than getEDRTimetables despite being larger: measured at
// 21 MB in ~35 s, against getEDRTimetables failing to finish 8.7 MB in ten
// minutes. Its only loss is actual (as-run) times, which we do not need —
// delay comes from the live feed's position in the schedule.
type ApiEdrStop = {
  nameOfPoint: string
  nameForPerson: string
  pointId: string
  supervisedBy: string | null
  arrivalTime: string | null
  departureTime: string | null
  stopType: string | null
  line: number | null
  platform: string | null
  track: number | null
  mileage: number | null
  maxSpeed: number | null
  trainType: string | null
}

type ApiEdrTrain = {
  trainNoLocal: string
  trainName: string | null
  startStation: string | null
  endStation: string | null
  locoType: string | null
  timetable: ApiEdrStop[] | null
}

const SEC_IN_DAY = 24 * 3600

/**
 * "2026-08-07 03:53:00" → seconds-of-day, read as UTC.
 *
 * Same frame as /getTime, which is the in-game clock and runs hours behind
 * wall time. Letting Date parse these as local time skews every comparison.
 */
export function stampToSec(ts: string | null): number | null {
  if (!ts) return null
  const m = /(\d{2}):(\d{2}):(\d{2})\s*$/.exec(ts)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function secToHHMM(sec: number | null): string {
  if (sec === null) return '--:--'
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor(sec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function stopKind(raw: string | null): EdrStopKind {
  if (raw === 'CommercialStop') return 'commercial'
  if (raw === 'NoncommercialStop') return 'technical'
  return 'pass'
}

/** The feed writes a single space where a point has no controlling post. */
function normalizePost(raw: string | null): string | null {
  const v = (raw ?? '').trim()
  return v === '' ? null : v
}

function mapStop(s: ApiEdrStop, index: number): EdrStop {
  const arrivalSec = stampToSec(s.arrivalTime)
  const departureSec = stampToSec(s.departureTime)
  const offMap = (s.line ?? 0) === 0 && (s.mileage ?? 0) === 0
  return {
    offMap,
    index,
    point: s.nameForPerson || s.nameOfPoint,
    pointId: String(s.pointId),
    supervisedBy: normalizePost(s.supervisedBy),
    arrival: secToHHMM(arrivalSec),
    departure: secToHHMM(departureSec),
    arrivalSec,
    departureSec,
    actualArrivalSec: null,
    actualDepartureSec: null,
    line: s.line === 0 ? null : s.line,
    platform: s.platform,
    track: s.track,
    maxSpeed: s.maxSpeed,
    mileage: s.mileage ?? 0,
    kind: stopKind(s.stopType),
    plannedStop: 0,
    confirmed: false,
    trainType: s.trainType ?? '',
  }
}

function mapTrain(t: ApiEdrTrain): EdrTrain {
  return {
    trainNo: t.trainNoLocal,
    trainName: t.trainName ?? '',
    startStation: t.startStation ?? '',
    endStation: t.endStation ?? '',
    carrier: t.locoType,
    stops: (t.timetable ?? []).map(mapStop),
  }
}

// Bump when the stored shape changes so old entries are refetched.
const CACHE_VERSION = 'edr2'
/**
 * The booked schedule does not change during a server session, and this is a
 * ~21 MB download — a real cost on mobile data. Everything time-sensitive
 * (position, speed, signals, delay) comes from /trains-open every 15 s, so
 * holding the schedule for hours costs nothing. There is a manual reload in
 * Settings for when a server does roll over.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

type Cached = { fetchedAt: number; trains: EdrTrain[] }

const cacheKey = (serverCode: string) => `${CACHE_VERSION}:${serverCode}`

// One download at a time per server. Without this, React's double-invoked
// effects in development start two 21 MB fetches, and a server switch back
// and forth would stack more.
const inFlight = new Map<string, Promise<{ trains: EdrTrain[]; fetchedAt: number } | null>>()

export async function fetchEdrTimetable(
  serverCode: string,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<{ trains: EdrTrain[]; fetchedAt: number } | null> {
  const key = cacheKey(serverCode)
  if (!opts.force) {
    const cached = await idbGet<Cached>(key)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { trains: cached.trains, fetchedAt: cached.fetchedAt }
    }
    const running = inFlight.get(key)
    if (running) return running
  }

  // Deliberately not passing the caller's AbortSignal: this download is shared
  // and expensive, so one component unmounting must not cancel it for the
  // others. Callers drop the result instead.
  const work = (async () => {
    const res = await fetch(
      `${apiBase()}/getAllTimetables?serverCode=${encodeURIComponent(serverCode)}`,
    )
    if (!res.ok) return null
    const body = (await res.json()) as ApiEdrTrain[]
    if (!Array.isArray(body) || body.length === 0) return null

    const trains = body.filter((t) => t.timetable?.length).map(mapTrain)
    const fetchedAt = Date.now()
    void idbSet(key, { fetchedAt, trains } satisfies Cached)
    return { trains, fetchedAt }
  })().finally(() => inFlight.delete(key))

  inFlight.set(key, work)
  return work
}

/**
 * Station name → every point id that station controls.
 *
 * A post is an *area*, not a point. Skierniewice controls six: the station
 * itself plus "M PZS", "P PZS", "S PZS", "R402" and "GT 201-208". Matching
 * only the point sharing the station's name missed every train that runs
 * through the area without calling there — 106 of 487 at Skierniewice, which
 * is precisely the Płyćwia–Bełchów traffic.
 *
 * Both keys are indexed: what the point is called, and what post controls it.
 * Resolving to ids once here keeps later lookups numeric rather than string
 * comparisons against Polish names with diacritics.
 */
export function buildPointIndex(trains: EdrTrain[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (key: string, id: string) => {
    let ids = index.get(key)
    if (!ids) {
      ids = new Set()
      index.set(key, ids)
    }
    ids.add(id)
  }
  for (const t of trains) {
    for (const s of t.stops) {
      add(s.point, s.pointId)
      if (s.supervisedBy) add(s.supervisedBy, s.pointId)
    }
  }
  return index
}

/**
 * Walk away from the station until reaching a point a different post
 * controls.
 *
 * A station occupies several consecutive points — Skierniewice runs
 * "Skierniewice M PZS", "Skierniewice", "Skierniewice P PZS". Taking the
 * literal neighbour makes every train read "→ Skierniewice P PZS", which
 * tells the dispatcher nothing; they need the next station out, e.g.
 * "→ Płyćwia". Falls back to the immediate neighbour when the feed names no
 * controlling post.
 */
function stepOut(
  stops: EdrStop[],
  from: number,
  direction: 1 | -1,
  post: string | null,
): EdrStop | undefined {
  const immediate = stops[from + direction]
  if (post === null) return immediate
  for (let i = from + direction; i >= 0 && i < stops.length; i += direction) {
    if (stops[i].supervisedBy !== post) return stops[i]
  }
  return immediate
}

export type StationRow = {
  train: EdrTrain
  /** The train's stop at this station. */
  stop: EdrStop
  prev: EdrStop | undefined
  next: EdrStop | undefined
}

/**
 * Every train booked through this station, in scheduled arrival order.
 *
 * No filtering by whether the train is currently running — that is an opt-in
 * view, not the definition of a timetable.
 */
export function rowsForStation(
  trains: EdrTrain[],
  pointIds: Set<string>,
): StationRow[] {
  const rows: StationRow[] = []
  for (const train of trains) {
    const matches: number[] = []
    for (let k = 0; k < train.stops.length; k++) {
      if (pointIds.has(train.stops[k].pointId)) matches.push(k)
    }
    if (matches.length === 0) continue
    // A train may touch several of the post's points. Anchor on the one with
    // a platform — that is the station call the dispatcher plans around —
    // and otherwise on the first point it reaches in the area.
    const i = matches.find((k) => train.stops[k].platform) ?? matches[0]
    const stop = train.stops[i]
    rows.push({
      train,
      stop,
      prev: stepOut(train.stops, i, -1, stop.supervisedBy),
      next: stepOut(train.stops, i, 1, stop.supervisedBy),
    })
  }
  return rows.sort((a, b) => {
    const av = a.stop.arrivalSec ?? a.stop.departureSec ?? 0
    const bv = b.stop.arrivalSec ?? b.stop.departureSec ?? 0
    return av - bv
  })
}

/** Signed seconds between two seconds-of-day, taking the short way round midnight. */
export function wrapDiff(a: number, b: number): number {
  let d = a - b
  if (d > SEC_IN_DAY / 2) d -= SEC_IN_DAY
  if (d < -SEC_IN_DAY / 2) d += SEC_IN_DAY
  return d
}
