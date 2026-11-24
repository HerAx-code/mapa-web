import { test, expect } from '@playwright/test'

// Smoke tests for the public (unauthenticated) surface. Each asserts the
// page mounts and shows a stable, id-based element, and that the top-level
// ErrorBoundary fallback did NOT render — i.e. the built app boots through
// the real router + Firebase init without crashing. Selectors use element
// ids (not translated text) so they don't break when the UI language or
// copy changes.

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
}

test('landing page renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#root')).not.toBeEmpty()
  await assertNoErrorBoundary(page)
})

test('login page renders its form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('#login-email')).toBeVisible()
  await expect(page.locator('#login-password')).toBeVisible()
  await assertNoErrorBoundary(page)
})

test('register page renders step 1', async ({ page }) => {
  await page.goto('/register')
  await expect(page.locator('#reg-firstName')).toBeVisible()
  await assertNoErrorBoundary(page)
})

// The install page's main action depends on the browser (PR #447): a desktop
// gets a QR code to continue on a phone, an Android phone the Install button.
test('install page on desktop offers the QR code', async ({ page }) => {
  await page.goto('/install')
  await expect(page.getByRole('img', { name: /qr code/i })).toBeVisible()
  await assertNoErrorBoundary(page)
})

test.describe('on an Android phone', () => {
  test.use({
    viewport: { width: 360, height: 780 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    isMobile: true,
    hasTouch: true,
  })
  test('install page renders the install action', async ({ page }) => {
    await page.goto('/install')
    await expect(page.getByRole('button', { name: /install mapa/i })).toBeVisible()
    await assertNoErrorBoundary(page)
  })
})
