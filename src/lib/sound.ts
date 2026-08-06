// Alert tones, synthesised with Web Audio.
//
// No sound files: the APK stays small, nothing to load, and it works offline.
// Each alert gets a distinct shape so it can be told apart without looking —
// the phone is a second screen next to the game, and SimRail's own audio is
// competing for attention.
//
// Browsers start an AudioContext suspended until a user gesture, so the
// context is created lazily and `unlockAudio` must be called from a real tap
// (the Settings toggle and its test button both do).

export type ToneStep = {
  /** Hertz. */
  freq: number
  /** Seconds. */
  duration: number
  /** Seconds of silence after this step. */
  gap?: number
}

let ctx: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

/** Call from a user gesture so later programmatic alerts are allowed to play. */
export async function unlockAudio(): Promise<boolean> {
  const c = audioContext()
  if (!c) return false
  if (c.state === 'suspended') {
    try {
      await c.resume()
    } catch {
      return false
    }
  }
  return c.state === 'running'
}

/**
 * Play a sequence of tones. Square-ish timbre with a short attack/release so
 * it cuts through game audio without clicking.
 */
export function playTones(steps: ToneStep[], volume = 0.5): void {
  const c = audioContext()
  if (!c || c.state !== 'running') return

  let at = c.currentTime
  for (const step of steps) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(step.freq, at)

    // Envelope: without the ramps a bare gate produces an audible click.
    const peak = Math.max(0, Math.min(1, volume))
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
    gain.gain.setValueAtTime(peak, at + step.duration - 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + step.duration)

    osc.connect(gain).connect(c.destination)
    osc.start(at)
    osc.stop(at + step.duration + 0.01)
    at += step.duration + (step.gap ?? 0.05)
  }
}

/** Vibration pattern, silently ignored where unsupported. */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Vibration is a nicety; never let it break an alert.
  }
}
