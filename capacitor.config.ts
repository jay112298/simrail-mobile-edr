import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jitu.simrailedr',
  appName: 'SimRail EDR',
  // Vite's build output. `npx cap sync` copies this into the APK, so the
  // app ships its own assets and never needs hosting.
  webDir: 'dist',
  android: {
    // Serve the bundled assets from https://localhost inside the WebView.
    androidScheme: 'https',
  },
  plugins: {
    // Routes fetch/XHR through native Java HTTP instead of the WebView
    // network stack. That is what lets us read the SimRail timetable host,
    // which sends no CORS headers at all and is therefore unreachable from
    // any browser. Without this the app would need a proxy server.
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
