import { useEffect, useRef, useState } from 'react'
import { fetchServerTime, serverMsToSec } from './timetable'

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
