// SimRail in-game clock.
//
// The schedule itself now comes from lib/edrTimetable.ts; this module is only
// the server time, which everything else is measured against. The host sends
// no CORS headers, so it is reached natively via CapacitorHttp and through the
// Vite proxy in development.

import { Capacitor } from '@capacitor/core'

const NATIVE_BASE = 'https://api.simrail.eu:8082/api'
const PROXY_BASE = '/simrail-timetable'

function apiBase(): string {
  return Capacitor.isNativePlatform() ? NATIVE_BASE : PROXY_BASE
}

const SEC_IN_DAY = 24 * 3600

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
