import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildPointIndex,
  fetchEdrTimetable,
  readCachedTimetable,
  type EdrTrain,
} from './edrTimetable'

export type EdrTimetableState = {
  trains: EdrTrain[]
  /** Point name → the point ids using it. */
  pointIndex: Map<string, Set<string>>
  loading: boolean
  error: string | null
  fetchedAt: number | null
  refresh: () => void
}

/**
 * Load the whole server timetable once, then serve it from cache.
 *
 * Deliberately not polled: the endpoint is heavy and rate limited, and the
 * schedule does not change during a session. Anything that must be live —
 * position, speed, signals — comes from /trains-open every 15 s and is merged
 * onto these rows.
 */
/**
 * @param allowNetwork Gate on the bulk download only. The cache is always
 *   read, so a warm start is instant; the network fetch waits until the
 *   nearest-first pass has finished, so the two do not compete for a slow,
 *   rate-limited endpoint.
 */
export function useEdrTimetable(
  serverCode: string,
  allowNetwork: boolean,
): EdrTimetableState {
  const [trains, setTrains] = useState<EdrTrain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setTrains([])
    setFetchedAt(null)

    const load = async () => {
      const cached = await readCachedTimetable(serverCode)
      if (cached) return cached
      if (!allowNetwork && nonce === 0) return null
      return fetchEdrTimetable(serverCode, {
        force: nonce > 0,
        signal: ctrl.signal,
      })
    }

    load()
      .then((result) => {
        if (cancelled) return
        if (!result) {
          // Not an error while the fast path is still running — the bulk
          // download simply has not been allowed to start yet.
          setLoading(false)
          return
        }
        setTrains(result.trains)
        setFetchedAt(result.fetchedAt)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled || ctrl.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [serverCode, nonce, allowNetwork])

  const pointIndex = useMemo(() => buildPointIndex(trains), [trains])
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { trains, pointIndex, loading, error, fetchedAt, refresh }
}
