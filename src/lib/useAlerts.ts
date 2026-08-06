import { useEffect, useMemo, useRef, useState } from 'react'
import type { Train } from '../data'
import {
  detectAlerts,
  tonesFor,
  vibrationFor,
  type ActiveAlert,
  type AlertKind,
  type AlertSettings,
} from './alerts'
import { playTones, vibrate } from './sound'

export type LoggedAlert = ActiveAlert & { at: number }

/**
 * Most urgent first. Several conditions can become true in the same poll, and
 * playing five tones on top of each other communicates nothing — so one tone
 * sounds (the most urgent) while every new alert is written to the log.
 */
const PRIORITY: AlertKind[] = ['held', 'conflict', 'overdue', 'player', 'approach']

const LOG_LIMIT = 30

/**
 * @param ready Whether the underlying data has settled. Timetables stream in
 *   over ~30 s after launch, so a set primed before they land is nearly
 *   empty, and every train then reads as a brand-new event — a burst of
 *   alerts on every restart, which teaches the user to ignore them. While
 *   this is false the known set keeps adopting whatever is true, silently.
 */
export function useAlerts(
  trains: Train[],
  conflicts: Map<string, string[]>,
  nowSec: number | null,
  settings: AlertSettings,
  ready: boolean,
): { log: LoggedAlert[]; clearLog: () => void } {
  const [log, setLog] = useState<LoggedAlert[]>([])
  // null means "not primed yet" — see the seeding note below.
  const known = useRef<Set<string> | null>(null)

  const active = useMemo(
    () => detectAlerts(trains, conflicts, nowSec, settings),
    [trains, conflicts, nowSec, settings],
  )

  // Turning alerts off discards the primed set, so switching back on re-seeds
  // rather than announcing everything that happened while muted.
  useEffect(() => {
    if (!settings.enabled) known.current = null
  }, [settings.enabled])

  useEffect(() => {
    if (!settings.enabled) return

    const currentKeys = new Set(active.map((a) => a.key))

    // Adopt whatever is already true without sounding it, both on the first
    // pass after enabling and for as long as the data is still arriving.
    // Otherwise enabling mid-shift — or simply restarting — fires for every
    // train that was already approaching.
    if (known.current === null || !ready) {
      known.current = currentKeys
      return
    }

    const fresh = active.filter((a) => !known.current!.has(a.key))
    known.current = currentKeys
    if (fresh.length === 0) return

    const now = Date.now()
    setLog((prev) =>
      [...fresh.map((a) => ({ ...a, at: now })), ...prev].slice(0, LOG_LIMIT),
    )

    const lead = [...fresh].sort(
      (a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind),
    )[0]
    playTones(tonesFor(lead.kind), settings.volume)
    vibrate(vibrationFor(lead.kind))
  }, [active, ready, settings.enabled, settings.volume])

  return { log, clearLog: () => setLog([]) }
}

/**
 * Hold the screen on while dispatching.
 *
 * Uses the Wake Lock API rather than a native plugin — it is available in the
 * Android WebView on a secure origin, which the packaged app is
 * (https://localhost). The lock is dropped whenever the page is hidden, so it
 * is re-acquired on visibilitychange.
 */
export function useWakeLock(enabled: boolean): { supported: boolean } {
  const sentinel = useRef<WakeLockSentinel | null>(null)
  const supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator

  useEffect(() => {
    if (!supported) return
    let cancelled = false

    const acquire = async () => {
      if (!enabled || document.visibilityState !== 'visible') return
      if (sentinel.current) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void lock.release()
          return
        }
        sentinel.current = lock
        lock.addEventListener('release', () => {
          sentinel.current = null
        })
      } catch {
        // Denied or unsupported in this context — nothing to recover.
      }
    }

    const release = () => {
      void sentinel.current?.release()
      sentinel.current = null
    }

    if (enabled) void acquire()
    else release()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [enabled, supported])

  return { supported }
}
