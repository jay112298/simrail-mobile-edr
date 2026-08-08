import { useEffect, useRef, useState } from 'react'
import { fetchTrainSchedule, type EdrTrain } from './edrTimetable'

/**
 * How many single-train schedules to pull at once. Each is ~1 s, so a pool of
 * ten puts the first rows on screen within a couple of seconds.
 */
const POOL = 10

export type PrioritySchedules = {
  schedules: Map<string, EdrTrain>
  /** Resolved so far, and how many were asked for. */
  done: number
  total: number
}

/**
 * Fetch schedules for the given trains, nearest first, filling in as they
 * arrive.
 *
 * The caller orders by distance from the post, so trains about to matter
 * resolve first and the app is usable in seconds instead of waiting on the
 * ~21 MB whole-server download.
 *
 * The work queue deliberately outlives renders. An earlier version created an
 * AbortController per effect run, and because the ordering is by distance the
 * dependency changed on every 15 s live poll — so each poll aborted every
 * in-flight request and nothing ever completed. Only a server change or
 * unmount cancels now; re-prioritising just reorders what is still pending.
 */
export function usePrioritySchedules(
  serverCode: string,
  orderedTrainNos: string[],
  enabled: boolean,
): PrioritySchedules {
  const [schedules, setSchedules] = useState<Map<string, EdrTrain>>(
    () => new Map(),
  )
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)

  const requested = useRef<Set<string>>(new Set())
  const queue = useRef<string[]>([])
  const workers = useRef(0)
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    ctrl.current = controller
    requested.current = new Set()
    queue.current = []
    workers.current = 0
    setSchedules(new Map())
    setDone(0)
    setTotal(0)
    return () => controller.abort()
  }, [serverCode])

  const key = orderedTrainNos.join(',')

  useEffect(() => {
    if (!enabled) return
    const signal = ctrl.current?.signal
    if (!signal || signal.aborted) return

    const missing = orderedTrainNos.filter((n) => !requested.current.has(n))
    if (missing.length > 0) {
      for (const n of missing) requested.current.add(n)
      queue.current.push(...missing)
      setTotal((t) => t + missing.length)
    }

    // Re-sort what is still pending so the newest priority order applies to
    // work not yet started, without disturbing anything in flight.
    if (queue.current.length > 1) {
      const rank = new Map(orderedTrainNos.map((n, i) => [n, i]))
      queue.current.sort(
        (a, b) =>
          (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
    }

    const drain = async () => {
      while (queue.current.length) {
        if (signal.aborted) break
        const no = queue.current.shift()
        if (!no) break
        try {
          const tt = await fetchTrainSchedule(serverCode, no, signal)
          if (signal.aborted) break
          if (tt) {
            setSchedules((prev) => {
              const next = new Map(prev)
              next.set(no, tt)
              return next
            })
          }
        } catch {
          // One failure must not stall the pool. The bulk download, or a
          // later pass, can still supply this train.
        } finally {
          if (!signal.aborted) setDone((d) => d + 1)
        }
      }
      workers.current -= 1
    }

    while (workers.current < POOL && queue.current.length > workers.current) {
      workers.current += 1
      void drain()
    }
    // `key` is the stable projection of the ordered list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCode, key, enabled])

  return { schedules, done, total }
}
