import { useEffect, useRef, useState } from 'react'
import {
  fetchServerTime,
  fetchTimetables,
  serverMsToSec,
  type TrainTimetable,
} from './timetable'

const RESYNC_MS = 60_000

/**
 * In-game clock as seconds-of-day, ticking at 1 Hz.
 *
 * The SimRail world clock runs on its own offset from wall time (observed
 * several hours behind), so scheduled times are only meaningful against
 * this. Returns null until the first sync — callers should treat that as
 * "times not yet comparable" rather than substituting Date.now().
 */
export function useServerTime(serverCode: string): number | null {
  const [nowSec, setNowSec] = useState<number | null>(null)
  // Anchor = server clock at sync, paired with a monotonic local reading so
  // the tick survives wall-clock adjustments.
  const anchor = useRef<{ serverMs: number; localMs: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    anchor.current = null
    setNowSec(null)

    const sync = async () => {
      try {
        const ms = await fetchServerTime(serverCode, ctrl.signal)
        if (cancelled || ms === null) return
        anchor.current = { serverMs: ms, localMs: performance.now() }
      } catch {
        // Keep the previous anchor and let the next resync try again.
      }
    }

    void sync()
    const resync = setInterval(() => void sync(), RESYNC_MS)
    const tick = setInterval(() => {
      const a = anchor.current
      if (!a) return
      setNowSec(serverMsToSec(a.serverMs + (performance.now() - a.localMs)))
    }, 1000)

    return () => {
      cancelled = true
      ctrl.abort()
      clearInterval(resync)
      clearInterval(tick)
    }
  }, [serverCode])

  return nowSec
}

export type TimetableMap = Map<string, TrainTimetable>

/**
 * Resolve timetables for the given trains, filling in progressively.
 *
 * Only train numbers not already requested are fetched, so the 15 s live
 * poll does not re-request the whole set each tick. Results are cached in
 * IndexedDB by the layer below, making later sessions near-instant.
 */
export function useTimetables(
  serverCode: string,
  trainNos: string[],
): { timetables: TimetableMap; pending: number } {
  const [timetables, setTimetables] = useState<TimetableMap>(() => new Map())
  const [pending, setPending] = useState(0)
  const requested = useRef<Set<string>>(new Set())

  // Changing server invalidates everything gathered for the previous one.
  useEffect(() => {
    requested.current = new Set()
    setTimetables(new Map())
    setPending(0)
  }, [serverCode])

  const key = trainNos.join(',')

  useEffect(() => {
    const missing = trainNos.filter((n) => !requested.current.has(n))
    if (missing.length === 0) return
    for (const n of missing) requested.current.add(n)

    const ctrl = new AbortController()
    setPending((p) => p + missing.length)

    void fetchTimetables(
      serverCode,
      missing,
      (trainNo, tt) => {
        setPending((p) => Math.max(0, p - 1))
        if (!tt) return
        setTimetables((prev) => {
          const next = new Map(prev)
          next.set(trainNo, tt)
          return next
        })
      },
      { signal: ctrl.signal },
    )

    return () => ctrl.abort()
    // `key` is the stable projection of trainNos; trainNos itself is a new
    // array identity on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCode, key])

  return { timetables, pending }
}
