// Patient Access Codes in the marketplace (docs/patient-marketplace-plan.md).
// A patient registers with the NETWORK; to file a request at a hospital they
// enter a code issued by THAT hospital (proof of an in-person visit). Each code
// backs one request. This module checks a code and claims it.
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db, functions, signInAnonymously, httpsCallable } from '../firebase'
import { accessCodeRe, DEFAULT_HOSPITAL_ID } from '../config/org'
import { fmtDate } from './dates'
import { codeProof, blankCodeExpired } from './codeIssue'

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
// Patient-bound codes (2026-11-15) also take the patient's last name and
// birthdate as recorded by the hospital; extra reasons 'mismatch' (they don't
// match), 'expired' (a blank pre-2026-11-15 slip past the cutoff) and
// 'needDetails' (a bound code checked without them).
export async function checkAccessCode(rawCode, { hospitalId, uid, lastName = '', birthdate = '' }) {
  const code = normalizeCode(rawCode)
  if (!accessCodeRe().test(code)) return { ok: false, reason: 'format' }
  if (overLimit()) return { ok: false, reason: 'rateLimit' }
  try {
    // Rate-limited server check when deployed; it never reveals who holds a code.
    let serverMatch = null
    try {
      if (!auth.currentUser) await signInAnonymously(auth)
      const res = await httpsCallable(functions, 'verifyAccessCode')({ code, lastName, birthdate })
      if (res.data.hospitalClosed) return { ok: false, reason: 'closed' }
      if (!res.data.exists) return { ok: false, reason: 'notFound' }
      if (res.data.expired) return { ok: false, reason: 'expired' }
      if (res.data.bound) serverMatch = !!res.data.match
    } catch (err) {
      if (err?.code === 'functions/resource-exhausted') return { ok: false, reason: 'rateLimit' }
      // Function unreachable (not deployed / network): fall through to the read.
    }
    const snap = await getDoc(doc(db, 'hospitalIds', code))
    if (!snap.exists()) return { ok: false, reason: 'notFound' }
    const c = snap.data()
    if (c.bound === true) {
      if (!lastName || !birthdate) return { ok: false, reason: 'needDetails' }
      // Without the server check we can't compare (the issued record is
      // staff-only); the rules still refuse a wrong claim.
      if (serverMatch === false) return { ok: false, reason: 'mismatch' }
      if (serverMatch === null) return { ok: false, reason: 'error' }
    } else if (blankCodeExpired()) {
      return { ok: false, reason: 'expired' }
    }
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
export async function claimAccessCode({ user, code: rawCode, tenantId, lastName = '', birthdate = '' }) {
  const code = normalizeCode(rawCode)
  const uid = user.uid
  const fields = {
    tenantId, tenantIds: nextTenantIds(user, tenantId), hospitalId: code,
    // An account made before patient-bound codes has no stored last name /
    // birthdate: keep the ones just proven, so the next claim is pre-filled.
    // (The rules let a patient set these once, never change them.)
    ...(!user.lastName && lastName ? { lastName: lastName.trim() } : {}),
    ...(!user.birthdate && birthdate ? { birthdate } : {}),
  }
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
        // Patient-bound codes: the rules compare this with the issued record.
        ...(c.bound === true ? { proof: codeProof(lastName, birthdate) } : {}),
      })
    }
    tx.update(doc(db, 'users', uid), fields)
  })
  try { sessionStorage.removeItem(PENDING_CODE_KEY) } catch { /* ignore */ }
  return fields
}

// Can the patient file with their CURRENT code? Yes if it's claimed by them
// and not yet backing a request — or (Phase 3A) it covers a course of
// treatment that hasn't ended (it then backs each new request in turn).
export async function currentCodeInfo(user) {
  if (!user?.hospitalId || !user?.tenantId) return { usable: false, courseUntil: null }
  try {
    const snap = await getDoc(doc(db, 'hospitalIds', user.hospitalId))
    if (!snap.exists() || snap.data().patId !== user.uid) return { usable: false, courseUntil: null }
    const until = snap.data().courseUntil?.toDate?.() ?? null
    const courseActive = !!until && until.getTime() > Date.now()
    return { usable: !snap.data().requestId || courseActive, courseUntil: courseActive ? until : null }
  } catch { return { usable: false, courseUntil: null } }
}

export async function currentCodeIsUnused(user) {
  return (await currentCodeInfo(user)).usable
}
