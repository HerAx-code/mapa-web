// Error tracking (Phase 2 — observability).
//
// Sentry is wired lazily: the SDK is only imported and initialised when a
// DSN is present (VITE_SENTRY_DSN in the deploy env). With no DSN configured
// — the default — @sentry/react is never loaded, so it costs nothing in the
// bundle or at runtime. Turning it on is purely: create a Sentry project,
// set VITE_SENTRY_DSN in Vercel, redeploy.
//
// Usage:
//   initSentry()               — call once at startup (main.jsx)
//   captureError(err, extra?)  — report a caught error (no-op until active)
//
// Once init runs, Sentry's default integrations also capture uncaught
// window errors and unhandled promise rejections automatically.

let sentry = null

export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  try {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // The app handles patient data — never attach default PII.
      sendDefaultPii: false,
    })
    sentry = Sentry
  } catch (err) {
    // Error tracking must never break the app it is watching.
    console.warn('[sentry] init failed:', err?.message)
  }
}

// Report a caught exception. No-ops until/unless Sentry has initialised.
export function captureError(error, context) {
  if (!sentry) return
  try {
    sentry.captureException(error, context ? { extra: context } : undefined)
  } catch {
    /* swallow — reporting a failure must not throw */
  }
}
