import { useState, useRef, useCallback } from 'react'

/**
 * Step-up (re-)authentication for high-stakes actions — the phase-2 item in
 * docs/session-timeout-and-terms-plan.md. Before a sensitive action runs (an
 * approval that issues a Guarantee Letter, or an approval reversal), confirm the
 * person at the keyboard is the account owner by re-entering their password.
 *
 * To keep friction low for staff who do many approvals, a successful re-auth is
 * "fresh" for `freshnessMs` (per tab, in sessionStorage): within that window,
 * guarded actions run immediately without another prompt. Pair with ReauthModal:
 *
 *   const { requireReauth, reauthProps } = useStepUpAuth()
 *   // onConfirm={(data) => requireReauth(() => handleApprove(data))}
 *   // …
 *   <ReauthModal {...reauthProps} />
 */

const FRESH_KEY = 'mapa.reauthAt'

export function useStepUpAuth({ freshnessMs = 10 * 60 * 1000 } = {}) {
  const [open, setOpen] = useState(false)
  const pending = useRef(null)

  const requireReauth = useCallback((action) => {
    if (typeof action !== 'function') return
    let last = 0
    try { last = Number(sessionStorage.getItem(FRESH_KEY)) || 0 } catch { last = 0 }
    if (Date.now() - last < freshnessMs) { action(); return } // still fresh — run it
    pending.current = action
    setOpen(true)
  }, [freshnessMs])

  const onSuccess = useCallback(() => {
    try { sessionStorage.setItem(FRESH_KEY, String(Date.now())) } catch { /* storage blocked */ }
    setOpen(false)
    const action = pending.current
    pending.current = null
    action?.()
  }, [])

  const onClose = useCallback(() => {
    pending.current = null
    setOpen(false)
  }, [])

  return { requireReauth, reauthProps: { open, onSuccess, onClose } }
}
