import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'

/**
 * Remove any service worker inside the packaged app.
 *
 * Installing a new APK does not clear app data, so a worker registered by an
 * earlier build survives the update and keeps serving its precached
 * index.html and JS bundle — the new files ship inside the APK and are never
 * used. The result is installing an update and still seeing the old app.
 *
 * A service worker buys nothing natively: the assets are already on the
 * device, served from the APK. So it is unregistered rather than refreshed,
 * which also heals installs that already have one.
 */
async function purgeServiceWorkers() {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  const hadController = Boolean(navigator.serviceWorker.controller)
  if (registrations.length === 0 && !hadController) return

  await Promise.all(registrations.map((r) => r.unregister()))
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  }

  // This page was itself served by the worker just removed, so it may still
  // be the stale build. One reload picks up the APK's real assets. The flag
  // stops that becoming a loop if anything re-registers.
  if (hadController && !sessionStorage.getItem('sw-purged')) {
    sessionStorage.setItem('sw-purged', '1')
    location.reload()
  }
}

if (Capacitor.isNativePlatform()) {
  void purgeServiceWorkers()
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Browser builds keep offline support; registration is manual because the
  // plugin's auto-injected script cannot tell native from browser.
  //
  // Production only: the dev server has no /sw.js, so the SPA fallback hands
  // back index.html and registration fails on the MIME type.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
