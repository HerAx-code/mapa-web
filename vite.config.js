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
        start_url:        '/patient/request',
        scope:            '/',
        display:          'standalone',
        orientation:      'portrait',
        theme_color:      '#0F6E56',
        background_color: '#f9fafb',
        lang:             'en',
        categories:       ['health', 'medical'],
        icons: [
          { src: '/pwa-192.png',          sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png',          sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Screenshots populate Android Chrome's rich install bottom sheet
        // (vs the basic install dialog). form_factor: 'narrow' = mobile;
        // all three are 375x667 portrait so Chrome's same-dimensions
        // requirement is satisfied.
        screenshots: [
          { src: '/screenshots/01-dashboard.png', sizes: '375x667', type: 'image/png', form_factor: 'narrow', label: 'See your application status at a glance' },
          { src: '/screenshots/02-status.png',    sizes: '375x667', type: 'image/png', form_factor: 'narrow', label: 'Track your request through CRMC and partner agencies' },
          { src: '/screenshots/03-request.png',   sizes: '375x667', type: 'image/png', form_factor: 'narrow', label: 'Submit a medical assistance request in minutes' },
        ],
        // Long-press the installed icon to jump straight into the most
        // common patient destinations without going through the dashboard.
        shortcuts: [
          {
            name:       'My Application',
            short_name: 'Status',
            description: 'Track your assistance request',
            url:        '/patient/status',
            icons:      [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name:       'Request Assistance',
            short_name: 'Request',
            description: 'Submit a new medical assistance request',
            url:        '/patient/request',
            icons:      [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name:       'My Interview',
            short_name: 'Interview',
            description: 'View scheduled assessment interview',
            url:        '/patient/interviews',
            icons:      [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
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
  // Phase 1.3 (post-review hardening): strip debug-only console calls
  // from production builds. ~200 console.log/debug statements ship today
  // -- noise in prod, useful in dev. Keeping console.error + console.warn
  // means real failures still surface to operator devtools and Vercel
  // Analytics, but the routine "[Foo] loading X" chatter goes away.
  //
  // No code changes needed; esbuild drops these at build time.
  esbuild: {
    drop: ['debugger'],
    pure: ['console.log', 'console.debug', 'console.info'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the big, stable vendor libraries into their own chunks so
        // an app-code deploy (which happens constantly) no longer busts the
        // ~800KB Firebase code the browser already cached. First-paint bytes
        // are similar, but repeat visits after a deploy re-download only the
        // small app chunks.
        //
        // IMPORTANT: only NAME libraries that are already eagerly imported at
        // boot (firebase for AuthContext, React core). Everything else returns
        // undefined so Rollup keeps its default splitting — that's what keeps
        // the dynamically-imported deps (tesseract.js via utils/idOcr, react-pdf
        // via the lazy GLViewer route) in their own on-demand chunks. A broad
        // node_modules catch-all here would pull those INTO an eager chunk and
        // make the bundle worse.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/@firebase/') || id.includes('/firebase/')) return 'vendor-firebase'
          if (
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/') ||
            /\/react\//.test(id)
          ) return 'vendor-react'
          // Everything else (tesseract.js, react-pdf/pdfjs, icons, …) → default.
        },
      },
    },
    // Firebase is irreducible and inherently large; raise the advisory limit
    // so the split vendor-firebase chunk doesn't trip a noisy build warning.
    chunkSizeWarningLimit: 900,
  },
})
