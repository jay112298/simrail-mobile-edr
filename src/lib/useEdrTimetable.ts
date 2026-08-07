import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildPointIndex,
  fetchEdrTimetable,
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
export function useEdrTimetable(serverCode: string): EdrTimetableState {
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

    fetchEdrTimetable(serverCode, {
      force: nonce > 0,
      signal: ctrl.signal,
    })
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setError('Timetable unavailable')
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
  }, [serverCode, nonce])

  const pointIndex = useMemo(() => buildPointIndex(trains), [trains])
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { trains, pointIndex, loading, error, fetchedAt, refresh }
}
