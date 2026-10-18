import { useState, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

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
  const { user } = useAuth()
  const uid = user?.uid
  const [open, setOpen] = useState(false)
  const pending = useRef(null)

  const requireReauth = useCallback((action) => {
    if (typeof action !== 'function') return
    // Freshness is tied to THIS user, so a different account signing into the
    // same tab can't inherit the prior user's re-auth.
    let fresh = false
    try {
      const raw = sessionStorage.getItem(FRESH_KEY)
      if (raw) {
        const { at, uid: storedUid } = JSON.parse(raw)
        fresh = storedUid === uid && Date.now() - Number(at) < freshnessMs
      }
    } catch { fresh = false }
    if (fresh) { action(); return }
    pending.current = action
    setOpen(true)
  }, [freshnessMs, uid])

  const onSuccess = useCallback(() => {
    try { sessionStorage.setItem(FRESH_KEY, JSON.stringify({ at: Date.now(), uid })) } catch { /* storage blocked */ }
    setOpen(false)
    const action = pending.current
    pending.current = null
    action?.()
  }, [uid])

  const onClose = useCallback(() => {
    pending.current = null
    setOpen(false)
  }, [])

  return { requireReauth, reauthProps: { open, onSuccess, onClose } }
}
