import { useEffect, useState } from 'react'
import { fetchServers, fetchTrains } from './api'
import { SERVERS as MOCK_SERVERS, type Server, type Train } from '../data'
import { trainsForServer } from '../data'

export type LoadState<T> = {
  data: T
  loading: boolean
  error: string | null
  updatedAt: number | null
}

const initial = <T,>(fallback: T): LoadState<T> => ({
  data: fallback,
  loading: true,
  error: null,
  updatedAt: null,
})

// Servers change rarely — fetch once, no polling.
export function useServers(): LoadState<Server[]> {
  const [state, setState] = useState<LoadState<Server[]>>(() =>
    initial(MOCK_SERVERS),
  )

  useEffect(() => {
    const ctrl = new AbortController()
    fetchServers(ctrl.signal)
      .then((data) => {
        setState({ data, loading: false, error: null, updatedAt: Date.now() })
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      })
    return () => ctrl.abort()
  }, [])

  return state
}

// Trains: poll every POLL_MS. Reset on serverCode change.
const POLL_MS = 15_000

export function useTrains(serverCode: string): LoadState<Train[]> {
  const [state, setState] = useState<LoadState<Train[]>>(() =>
    initial(trainsForServer(serverCode)),
  )

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const ctrl = new AbortController()

    // Reset to mock while switching servers so the UI stays populated
    // and the correct-server-mock is on screen during the first fetch.
    setState({
      data: trainsForServer(serverCode),
      loading: true,
      error: null,
      updatedAt: null,
    })

    const tick = async () => {
      try {
        const data = await fetchTrains(serverCode, ctrl.signal)
        if (cancelled) return
        setState({ data, loading: false, error: null, updatedAt: Date.now() })
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS)
      }
    }
    tick()

    return () => {
      cancelled = true
      ctrl.abort()
      if (timer) clearTimeout(timer)
    }
  }, [serverCode])

  return state
}
