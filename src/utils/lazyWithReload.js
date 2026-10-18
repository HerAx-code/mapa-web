import { lazy } from 'react'

// Route-chunk loader that survives a deploy landing mid-session.
//
// Every route is code-split into a content-hashed chunk. When a new build is
// deployed, an already-open page still references the OLD hashes; those files no
// longer exist, and behind the SPA rewrite the server returns index.html for
// them — so the dynamic import fails with "Failed to fetch dynamically imported
// module" / a text/html MIME error, and the whole route blanks out. This hits
// exactly the users MAPA serves least able to recover (indigent patients on
// phones who won't know to hard-reload).
//
// Fix: on a failed import, reload ONCE to pull the fresh index.html + chunks.
// A short sessionStorage guard prevents a reload loop when the failure is
// something else (offline, a genuine runtime error) — then the ErrorBoundary
// takes over instead.
const RELOAD_KEY = 'mapa.chunkReloadedAt'

export function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      let last = 0
      try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0 } catch { last = 0 }
      if (typeof window !== 'undefined' && Date.now() - last > 10_000) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked */ }
        window.location.reload()
        return new Promise(() => {}) // never resolves — the reload takes over
      }
      throw err // reloaded recently → let the ErrorBoundary surface a real error
    }
  })
}
