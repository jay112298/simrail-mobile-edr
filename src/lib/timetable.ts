// SimRail timetable client (api1.aws.simrail.eu:8082).
//
// This host sends no CORS headers whatsoever, so a browser cannot call it
// directly. Two paths make it reachable:
//   - packaged Android app: CapacitorHttp routes fetch through native Java
//     HTTP, where CORS does not exist;
//   - browser dev: the Vite proxy declared in vite.config.ts.
// Both hit the same paths, so calling code does not branch.
//
// Scale note: getAllTimetables for a whole server is ~21 MB uncompressed and
// the host ignores Accept-Encoding, so the full dump is unusable on a phone.
// Per-train queries are ~10 KB and are what we use, cached in IndexedDB
// because a train's timetable does not change during a server session.

import { Capacitor } from '@capacitor/core'
import { idbGet, idbSet } from './idb'

const NATIVE_BASE = 'https://api1.aws.simrail.eu:8082/api'
const PROXY_BASE = '/simrail-timetable'

function apiBase(): string {
  return Capacitor.isNativePlatform() ? NATIVE_BASE : PROXY_BASE
}

export type StopKind = 'commercial' | 'noncommercial' | 'pass'

export type TimetableStop = {
  point: string
  /** Dispatch post controlling this point, or null where unsupervised. */
  supervisedBy: string | null
  /** Seconds-of-day, UTC — same frame as the server clock. Null if unparsable. */
  arrivalSec: number | null
  departureSec: number | null
  arrival: string
  departure: string
  kind: StopKind
  line: number | null
  platform: string | null
  track: number | null
  maxSpeed: number | null
  mileage: number
}

export type TrainTimetable = {
  trainNo: string
  locoType: string | null
  length: number
  weight: number
  stops: TimetableStop[]
}

type ApiStop = {
  nameOfPoint: string
  nameForPerson: string
  supervisedBy: string | null
  arrivalTime: string | null
  departureTime: string | null
  stopType: string
  line: number | null
  platform: string | null
  track: number | null
  maxSpeed: number | null
  mileage: number
}

type ApiTimetable = {
  trainNoLocal: string
  locoType: string | null
  trainLength: number
  trainWeight: number
  timetable: ApiStop[]
}

const SEC_IN_DAY = 24 * 3600

/**
 * "2026-08-06 07:54:00" → seconds-of-day.
 *
 * Parsed as UTC deliberately: the timetable strings share a frame with
 * /getTime, which is the in-game clock and runs hours behind wall time.
 * Letting Date parse these as local time would skew every ETA.
 */
export function timestampToSec(ts: string | null): number | null {
  if (!ts) return null
  const m = /(\d{2}):(\d{2}):(\d{2})\s*$/.exec(ts)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function secToHHMM(sec: number | null): string {
  if (sec === null) return '--:--'
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor(sec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function stopKind(raw: string): StopKind {
  if (raw === 'CommercialStop') return 'commercial'
  if (raw === 'NoncommercialStop') return 'noncommercial'
  return 'pass'
}

/**
 * The feed writes a single space for points with no controlling post.
 * Treated as null so it can never match a station name.
 */
function normalizePost(raw: string | null): string | null {
  const v = (raw ?? '').trim()
  return v === '' ? null : v
}

function mapStop(s: ApiStop): TimetableStop {
  const arrivalSec = timestampToSec(s.arrivalTime)
  const departureSec = timestampToSec(s.departureTime)
  return {
    point: s.nameForPerson || s.nameOfPoint,
    supervisedBy: normalizePost(s.supervisedBy),
    arrivalSec,
    departureSec,
    arrival: secToHHMM(arrivalSec),
    departure: secToHHMM(departureSec),
    kind: stopKind(s.stopType),
    line: s.line,
    platform: s.platform,
    track: s.track,
    maxSpeed: s.maxSpeed,
    mileage: s.mileage,
  }
}

function mapTimetable(t: ApiTimetable): TrainTimetable {
  return {
    trainNo: t.trainNoLocal,
    locoType: t.locoType,
    length: t.trainLength,
    weight: t.trainWeight,
    stops: (t.timetable ?? []).map(mapStop),
  }
}

/** In-game clock, milliseconds. Runs on its own offset from wall time. */
export async function fetchServerTime(
  serverCode: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const res = await fetch(
    `${apiBase()}/getTime?serverCode=${encodeURIComponent(serverCode)}`,
    { signal },
  )
  if (!res.ok) return null
  const ms = Number((await res.text()).trim())
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/** Server clock as seconds-of-day UTC — the frame timetable stops use. */
export function serverMsToSec(ms: number): number {
  return Math.floor(ms / 1000) % SEC_IN_DAY
}

const cacheKey = (serverCode: string, trainNo: string) =>
  `tt:${serverCode}:${trainNo}`

export async function fetchTrainTimetable(
  serverCode: string,
  trainNo: string,
  signal?: AbortSignal,
): Promise<TrainTimetable | null> {
  const key = cacheKey(serverCode, trainNo)
  const cached = await idbGet<TrainTimetable>(key)
  if (cached) return cached

  const res = await fetch(
    `${apiBase()}/getAllTimetables?serverCode=${encodeURIComponent(
      serverCode,
    )}&train=${encodeURIComponent(trainNo)}`,
    { signal },
  )
  if (!res.ok) return null
  const body = (await res.json()) as ApiTimetable | ApiTimetable[]
  const rec = Array.isArray(body) ? body[0] : body
  if (!rec?.timetable?.length) return null

  const mapped = mapTimetable(rec)
  void idbSet(key, mapped)
  return mapped
}

/**
 * Resolve many timetables with a bounded worker pool.
 *
 * Measured: 16 trains at pool=8 takes ~4 s cold, so a full ~150-train server
 * lands in roughly half a minute and is instant on later runs from cache.
 * `onResolved` fires per train so the list fills in progressively rather
 * than blocking on the whole set.
 */
export async function fetchTimetables(
  serverCode: string,
  trainNos: string[],
  onResolved: (trainNo: string, tt: TrainTimetable | null) => void,
  opts: { pool?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const { pool = 8, signal } = opts
  const queue = [...trainNos]

  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) return
      const no = queue.shift()
      if (!no) return
      try {
        const tt = await fetchTrainTimetable(serverCode, no, signal)
        if (!signal?.aborted) onResolved(no, tt)
      } catch {
        // One bad train must not stall the pool; leave it unresolved so the
        // card keeps showing live telemetry only.
        if (!signal?.aborted) onResolved(no, null)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(pool, queue.length) }, worker))
}
