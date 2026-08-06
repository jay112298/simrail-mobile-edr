/**
 * Fire-and-forget haptic tap. Silently no-ops when unsupported
 * (iOS Safari, desktop, older browsers).
 */
export function hapticTap(ms: number = 10): void {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(ms)
  } catch {
    // ignore
  }
}
