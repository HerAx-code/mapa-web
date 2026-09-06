import { defineConfig, devices } from '@playwright/test'

// Manual capture config for Appendix D screenshots. NOT part of CI.
//
// Prereq: seed the live target with `node scripts/seed-demo-scenario.js` so
// there is an in-flight request to photograph, then:
//   APPENDIX_BASE_URL=https://mapa-web-six.vercel.app \
//     npx playwright test --config=playwright.capture.config.js
//
// Targets a LIVE deployment (real Firebase + seeded demo data) — there is no
// webServer here. Uses demo accounts only, so no real PII is captured.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/capture-appendix-d.spec.js',
  fullyParallel: false,          // one browser, deterministic order
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: process.env.APPENDIX_BASE_URL || 'https://mapa-web-six.vercel.app',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
