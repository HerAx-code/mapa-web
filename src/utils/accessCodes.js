// Patient Access Codes in the marketplace (docs/patient-marketplace-plan.md).
// A patient registers with the NETWORK; to file a request at a hospital they
// enter a code issued by THAT hospital (proof of an in-person visit). Each code
// backs one request. This module checks a code and claims it.
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db, functions, signInAnonymously, httpsCallable } from '../firebase'
import { accessCodeRe, DEFAULT_HOSPITAL_ID } from '../config/org'
import { fmtDate } from './dates'

// A scanned code slip (/register?code=…) is kept here until the patient picks
// that hospital in the request flow.
export const PENDING_CODE_KEY = 'mapa_pending_access_code'

// Soft per-session throttle on checks (the Cloud Function enforces the real
// per-uid / per-IP limits when deployed).
const BUCKET_KEY = 'mapa_verify_attempts'
const WINDOW_MS = 60 * 60 * 1000
const MAX_ATTEMPTS = 10
function overLimit() {
  try {
    const now = Date.now()
    const recent = JSON.parse(sessionStorage.getItem(BUCKET_KEY) || '[]').filter((t) => now - t < WINDOW_MS)
    if (recent.length >= MAX_ATTEMPTS) return true
    recent.push(now)
    sessionStorage.setItem(BUCKET_KEY, JSON.stringify(recent))
    return false
  } catch { return false }
}

export const normalizeCode = (s) => String(s ?? '').trim().toUpperCase()

/**
 * Check a code for filing at `hospitalId`. Resolves to
 *   { ok: true, tenantId, reuse }       — usable (reuse: the patient claimed it
 *                                         earlier and never filed with it)
 *   { ok: false, reason }               — 'format' | 'rateLimit' | 'notFound' |
 *                                         'used' | 'otherHospital' | 'closed' | 'error'
 */
export async function checkAccessCode(rawCode, { hospitalId, uid }) {
  const code = normalizeCode(rawCode)
  if (!accessCodeRe().test(code)) return { ok: false, reason: 'format' }
  if (overLimit()) return { ok: false, reason: 'rateLimit' }
  try {
    // Rate-limited server check when deployed; it never reveals who holds a code.
    try {
      if (!auth.currentUser) await signInAnonymously(auth)
      const res = await httpsCallable(functions, 'verifyAccessCode')({ code })
      if (res.data.hospitalClosed) return { ok: false, reason: 'closed' }
      if (!res.data.exists) return { ok: false, reason: 'notFound' }
    } catch (err) {
      if (err?.code === 'functions/resource-exhausted') return { ok: false, reason: 'rateLimit' }
      // Function unreachable (not deployed / network): fall through to the read.
    }
    const snap = await getDoc(doc(db, 'hospitalIds', code))
    if (!snap.exists()) return { ok: false, reason: 'notFound' }
    const c = snap.data()
    const tenantId = c.tenantId || DEFAULT_HOSPITAL_ID
    if (hospitalId && tenantId !== hospitalId) return { ok: false, reason: 'otherHospital', tenantId }
    const reuse = c.status === 'used' && c.patId === uid && !c.requestId
    if (c.status !== 'available' && !reuse) return { ok: false, reason: 'used' }
    const h = await getDoc(doc(db, 'hospitals', tenantId)).catch(() => null)
    if (h?.exists() && h.data().enabled === false) return { ok: false, reason: 'closed' }
    return { ok: true, tenantId, reuse }
  } catch (err) {
    console.error('[accessCodes] check failed:', err)
    return { ok: false, reason: 'error' }
  }
}

// The patient's hospitals after joining `tenantId`: every hospital they had
// (including a legacy single tenantId) plus the new one — the set the rules
// require (patientSwitchesHospital).
export const nextTenantIds = (user, tenantId) =>
  [...new Set([...(user?.tenantIds ?? []), ...(user?.tenantId ? [user.tenantId] : []), tenantId])]

/**
 * Claim `code` (issued by `tenantId`) for the signed-in patient and make that
 * hospital their current one — one transaction, as the rules require.
 * Resolves to the profile fields that changed (to merge into AuthContext).
 */
export async function claimAccessCode({ user, code: rawCode, tenantId }) {
  const code = normalizeCode(rawCode)
  const uid = user.uid
  const fields = { tenantId, tenantIds: nextTenantIds(user, tenantId), hospitalId: code }
  await runTransaction(db, async (tx) => {
    const codeRef = doc(db, 'hospitalIds', code)
    const snap = await tx.get(codeRef)
    if (!snap.exists()) throw new Error('CODE_NOT_FOUND')
    const c = snap.data()
    const mine = c.status === 'used' && c.patId === uid && !c.requestId
    if (c.status !== 'available' && !mine) throw new Error('CODE_USED')
    if ((c.tenantId || DEFAULT_HOSPITAL_ID) !== tenantId) throw new Error('CODE_OTHER_HOSPITAL')
    if (!mine) {
      tx.update(codeRef, { status: 'used', patId: uid, date: fmtDate(new Date()), time: new Date().toLocaleTimeString() })
      tx.set(doc(db, 'hospitalIds', code, 'privateInfo', 'details'), {
        usedBy: user.name ?? '', usedById: uid, createdAt: serverTimestamp(),
      })
    }
    tx.update(doc(db, 'users', uid), fields)
  })
  try { sessionStorage.removeItem(PENDING_CODE_KEY) } catch { /* ignore */ }
  return fields
}

// Can the patient file with their CURRENT code (claimed, not yet backing a request)?
export async function currentCodeIsUnused(user) {
  if (!user?.hospitalId || !user?.tenantId) return false
  try {
    const snap = await getDoc(doc(db, 'hospitalIds', user.hospitalId))
    return snap.exists() && snap.data().patId === user.uid && !snap.data().requestId
  } catch { return false }
}
