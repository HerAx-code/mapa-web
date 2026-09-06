// Appendix D — Sample Input / Output / Reports capture tool.  NOT run in CI
// (see testIgnore in playwright.config.js). Run against a LIVE deployment
// seeded with demo data:
//
//   node scripts/seed-demo-scenario.js
//   APPENDIX_BASE_URL=https://mapa-web-six.vercel.app \
//     npx playwright test --config=playwright.capture.config.js
//
// Output: docs/manuscript/appendix-d/D-01-*.png … D-19-*.png.
// PATIENT screens 390x844, STAFF screens 1440x900.
//
// PII: uses DEMO ACCOUNTS + demo-seeded data only (patient@gmail.com is the
// demo patient). Before folding any capture into the manuscript, eyeball it —
// if a real name, address, contact number, ID image, or selfie appears, delete
// that PNG and capture it manually against clean demo data instead.
//
// Screens that require opening a specific record or modal are BEST-EFFORT: the
// spec clicks into the first seeded record; if the seed/selectors differ it
// logs "MANUAL:" and you capture that one by hand. The route-level screens are
// reliable.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const DIR = 'docs/manuscript/appendix-d'
const PHONE = { width: 390, height: 844 }
const DESK  = { width: 1440, height: 900 }

const PATIENT = { email: 'patient@gmail.com',                 pw: 'patient123' }
const STAFF   = { email: 'admin@crmc.gov.ph',                 pw: 'admin123'   }
const COORD   = { email: 'coordinator@malasakit.gov.ph',      pw: 'agency123'  }

test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }) })

async function login(page, { email, pw }) {
  await page.goto('/login')
  await page.fill('#login-email', email)
  await page.fill('#login-password', pw)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Enrolled MFA would interrupt here; demo accounts are not enrolled.
  await page.waitForURL(/\/(patient|agency|admin)\//, { timeout: 30_000 })
}

async function shot(page, name) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(700) // let async Firestore reads paint
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true })
}

// Best-effort: try to open the first record/modal; on failure, flag MANUAL.
async function tryOrManual(label, fn) {
  try { await fn() } catch (e) { console.log(`MANUAL: ${label} — ${e.message}`) }
}

// ── Patient (phone) ────────────────────────────────────────────────────────
test('patient screens (390x844)', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/');        await shot(page, 'D-01-landing')
  await page.goto('/install'); await shot(page, 'D-01b-install')
  await page.goto('/register');await shot(page, 'D-02-registration')

  await login(page, PATIENT)
  await page.goto('/patient/dashboard');  await shot(page, 'D-03-patient-dashboard')
  await page.goto('/patient/request');    await shot(page, 'D-04-request-wizard-step1')
  await page.goto('/patient/interviews'); await shot(page, 'D-06-interviews')
  await page.goto('/patient/status');     await shot(page, 'D-07-coverage-plan')
  await shot(page, 'D-08-request-tracking') // same page, tracking view
  await page.goto('/patient/access-log'); await shot(page, 'D-18-access-log')

  // D-05 Household Intake Wizard lives at /patient/request/:id/intake — needs
  // the seeded request id. Best-effort via the dashboard's intake entry point.
  await tryOrManual('D-05 intake wizard', async () => {
    await page.goto('/patient/dashboard')
    await page.getByRole('link', { name: /intake|household/i }).first().click({ timeout: 5000 })
    await shot(page, 'D-05-intake-wizard')
  })
  // D-04 remaining steps + D-18 export FILE are captured by hand (multi-step
  // form / a downloaded JSON, not a single screenshot).
})

// ── CRMC staff administrator (desktop) ─────────────────────────────────────
test('staff admin screens (1440x900)', async ({ page }) => {
  await page.setViewportSize(DESK)
  await login(page, STAFF)
  await page.goto('/admin/requests');  await shot(page, 'D-09-crmc-requests')
  await page.goto('/admin/auditlog');  await shot(page, 'D-17a-admin-auditlog')
  await page.goto('/admin/logs');      await shot(page, 'D-17b-application-logs')
  await page.goto('/admin/reports');   await shot(page, 'D-19-reports')
  await page.goto('/admin/analytics'); await shot(page, 'D-19b-analytics')

  // D-10 doc verification, D-11 intake sheet, D-12 endorse modal all live
  // inside a request's guided stepper — best-effort open the first request.
  await tryOrManual('D-10/11/12 request stepper', async () => {
    await page.goto('/admin/requests')
    await page.getByRole('button', { name: /review|open|verify/i }).first().click({ timeout: 5000 })
    await shot(page, 'D-10-document-verification')
  })
})

// ── Agency coordinator (desktop) ───────────────────────────────────────────
test('agency screens (1440x900)', async ({ page }) => {
  await page.setViewportSize(DESK)
  await login(page, COORD)
  await page.goto('/agency/inbox');      await shot(page, 'D-13-funding-inbox')
  await page.goto('/agency/allocation'); await shot(page, 'D-16a-budget-allocation')
  await page.goto('/agency/audit');      await shot(page, 'D-16b-agency-audit')

  // D-13 detail, D-14 approve modal, D-15 GL: open the first slice in the inbox.
  await tryOrManual('D-13/14 application detail + approve', async () => {
    await page.goto('/agency/inbox')
    await page.getByRole('button', { name: /open|review|view/i }).first().click({ timeout: 5000 })
    await shot(page, 'D-13b-application-detail')
  })
  // D-15 Guarantee Letter (signed + unsigned) — capture from the GL viewer by
  // hand; it depends on a signed scan having been uploaded for the slice.
})
