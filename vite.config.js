import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // PWA: lets patients install MAPA to their home screen and use the
    // app shell offline. Service worker auto-updates on the next page
    // navigation after a new deploy — no "update available" prompt
    // (better for non-technical users; trade-off documented in the
    // PWA design doc).
    VitePWA({
      registerType: 'autoUpdate',
      // Devtools only — don't show install prompts during dev
      devOptions: { enabled: false },
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name:             'MAPA — Medical Assistance Portal Access',
        short_name:       'MAPA',
        description:      'Apply for medical financial assistance at Cotabato Regional Medical Center.',
        start_url:        '/patient/dashboard',
        scope:            '/',
        display:          'standalone',
        orientation:      'portrait',
        theme_color:      '#3b82f6',
        background_color: '#f9fafb',
        lang:             'en',
        categories:       ['health', 'medical'],
        icons: [
          { src: '/pwa-192.png',          sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png',          sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + assets precached. Firestore + Auth deliberately
        // NetworkOnly so the Firebase SDK's own offline persistence
        // layer is the single source of truth for data — caching at
        // the SW level too would conflict.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Activate new SW immediately on deploy instead of waiting for
        // every MAPA tab to close. Without this, patients see the old
        // cached version after a refresh and assume the new feature
        // didn't ship. clientsClaim takes control of any open tabs so
        // they pick up the new SW without a tab-close dance.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\//,
            handler:    'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\//,
            handler:    'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/securetoken\.googleapis\.com\//,
            handler:    'NetworkOnly',
          },
        ],
        // The PDF.js worker is 1MB; let it precache so docs load fast offline.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  optimizeDeps: {
    include: ['react-pdf'],
  },
})
