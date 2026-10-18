import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  SESSION_IDLE_MS, SESSION_WARN_MS, SESSION_ABSOLUTE_MS, isTimeoutRole,
} from '../utils/constants'

/**
 * Idle session timeout — STAFF ONLY (security-improvement-plan §1.3;
 * docs/session-timeout-and-terms-plan.md). Mounted once in App inside
 * AuthProvider; it is a no-op for patients and logged-out users, so the warning
 * modal can never appear on the patient phone path. Patients are deliberately
 * exempt — auto-logout would punish the indigent users MAPA exists to serve.
 *
 * Two independent limits (OWASP session-management guidance):
 *   - idle:     log out after SESSION_IDLE_MS of no interaction, with a
 *               SESSION_WARN_MS countdown and a "Stay signed in" escape.
 *   - absolute: a hard cap (SESSION_ABSOLUTE_MS) since the app loaded, so a
 *               forgotten/hijacked session can't live indefinitely.
 * Logout syncs across tabs via BroadcastChannel. Timers are client-side; the
 * Firebase ID token's own ~1h refresh is separate. Staff surfaces are
 * English-only by design, and only staff ever see this UI.
 */

const SESSION_START_KEY = 'mapa.sessionStart'
const CHANNEL = 'mapa-session'

export default function SessionTimeoutProvider({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const armed = !!user && isTimeoutRole(user.role)

  const lastActivity = useRef(Date.now())
  const [warnLeft, setWarnLeft] = useState(null) // seconds remaining, or null when not warning
  const bcRef = useRef(null)

  // Absolute-timeout anchor: when this app session started. Survives reloads
  // within the tab (sessionStorage), resets on a new tab / after logout.
  const sessionStart = useRef(0)
  // One-shot guard: logout flips `user` to null (disarming the effect), but the
  // ticking interval could otherwise fire endSession again before that lands.
  const ended = useRef(false)

  const endSession = useCallback((broadcast = true) => {
    if (ended.current) return
    ended.current = true
    try { if (broadcast) bcRef.current?.postMessage({ type: 'logout' }) } catch { /* no channel */ }
    try { sessionStorage.removeItem(SESSION_START_KEY) } catch { /* storage blocked */ }
    logout()
    navigate('/login?reason=timeout', { replace: true })
  }, [logout, navigate])

  useEffect(() => {
    if (!armed) { setWarnLeft(null); return }
    ended.current = false // fresh arm (new login / role change)

    // Anchor the absolute timeout (reuse an existing anchor across reloads).
    let start = 0
    try { start = Number(sessionStorage.getItem(SESSION_START_KEY)) || 0 } catch { start = 0 }
    if (!start) {
      start = Date.now()
      try { sessionStorage.setItem(SESSION_START_KEY, String(start)) } catch { /* ignore */ }
    }
    sessionStart.current = start
    lastActivity.current = Date.now()

    // Cross-tab sync: any tab's activity keeps the others alive; any tab's
    // logout logs the others out.
    let bc = null
    try {
      bc = new BroadcastChannel(CHANNEL)
      bc.onmessage = (e) => {
        if (e.data?.type === 'activity') {
          lastActivity.current = Math.max(lastActivity.current, Number(e.data.ts) || 0)
        } else if (e.data?.type === 'logout') {
          endSession(false)
        }
      }
      bcRef.current = bc
    } catch { bcRef.current = null }

    // Activity listeners (throttled). Broadcasting is rate-limited so we don't
    // flood the channel on every mousemove.
    let lastBroadcast = 0
    const onActivity = () => {
      const now = Date.now()
      lastActivity.current = now
      if (now - lastBroadcast > 5000) {
        lastBroadcast = now
        try { bcRef.current?.postMessage({ type: 'activity', ts: now }) } catch { /* ignore */ }
      }
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'visibilitychange']
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))

    // One ticking interval drives both limits + the countdown.
    const tick = () => {
      const now = Date.now()
      const idle = now - lastActivity.current
      const sinceStart = now - sessionStart.current
      if (idle >= SESSION_IDLE_MS || sinceStart >= SESSION_ABSOLUTE_MS) {
        endSession()
        return
      }
      const toIdle = SESSION_IDLE_MS - idle
      if (toIdle <= SESSION_WARN_MS) setWarnLeft(Math.max(1, Math.ceil(toIdle / 1000)))
      else setWarnLeft(null)
    }
    const id = setInterval(tick, 1000)

    return () => {
      clearInterval(id)
      events.forEach(ev => window.removeEventListener(ev, onActivity))
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [armed, endSession])

  const stay = () => { lastActivity.current = Date.now(); setWarnLeft(null) }

  return (
    <>
      {children}
      {armed && warnLeft != null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
             role="alertdialog" aria-modal="true" aria-labelledby="session-timeout-title">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="session-timeout-title" className="text-base font-semibold text-gray-900">
              Still there?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              You'll be signed out in <span className="font-semibold tabular-nums">{warnLeft}s</span> for
              inactivity, to keep patient records secure.
            </p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={stay}
                className="flex-1 h-11 rounded-xl bg-brand-500 text-sm font-semibold text-white hover:bg-brand-600 transition-colors">
                Stay signed in
              </button>
              <button type="button" onClick={() => endSession()}
                className="h-11 px-4 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
