import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // The timetable host sends no CORS headers, so a browser cannot call it
  // directly. In the packaged Android app CapacitorHttp goes through native
  // HTTP where CORS does not apply; this proxy is the dev-server equivalent
  // so the same code path can be built and debugged in a browser.
  server: {
    proxy: {
      '/simrail-timetable': {
        target: 'https://api1.aws.simrail.eu:8082',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/simrail-timetable/, '/api'),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'icon.svg',
      ],
      manifest: {
        name: 'SimRail Mobile EDR',
        short_name: 'Mobile EDR',
        description:
          'Phone-friendly Electronic Dispatch Record for SimRail. Clear destinations for complex stations like Skierniewice.',
        theme_color: '#0f172a',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['games', 'utilities', 'productivity'],
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // allow testing PWA features in dev
      },
    }),
  ],
})
