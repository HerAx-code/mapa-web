import { defineConfig, devices } from '@playwright/test'

// E2E smoke tests — a thin browser pass over the public pages to catch the
// "white screen / broken route" class of regression that unit + component
// tests can't see (they render components in isolation, not the built app
// through the real router + Firebase bootstrap).
//
// The webServer builds the production bundle and serves it with `vite
// preview`, so this exercises exactly what ships. Firebase runs with the
// dummy CI config; the public pages render without any network call, so no
// real credentials are needed.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
