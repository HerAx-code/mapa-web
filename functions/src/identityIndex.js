const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const crypto = require('node:crypto')

/**
 * identityIndex — flags patient accounts that look like the same person
 * (input verification Phase 1, reports/Patient input verification.md).
 *
 * WHY: the 30-day repeat-claim block and "one active request" work per
 * ACCOUNT, so a second account with another email gets around them. COA's
 * main AICS finding (P397.45M, 2025) was the same people paid more than once
 * for lack of a way to see prior assistance.
 *
 * WHAT: three keys per patient, each a keyed hash (HMAC-SHA256 with the
 * IDENTITY_KEY secret — never stored or sent to clients):
 *   pcn         the PhilSys card fingerprint on the patient's ID document
 *   name_phone  normalised full name + mobile number
 *   phone       mobile number alone (weak: families share phones)
 * identityIndex/{hash} lists the uids that share a key; identityIndexByUser
 * holds each uid's current hashes. Both are Admin-SDK only.
 *
 * OUTPUT: identityFlags/{tenantId}__{uid}, one per hospital the patient filed
 * with. Same-hospital matches list uids (that gateway can already read those
 * patients); matches at OTHER hospitals are a COUNT only — no name, hospital
 * or case — so the tenant boundary holds. A flag is advice for the social
 * worker ("ask the patient"); nothing is blocked or rejected automatically.
 * A doc with matches: [] means "checked, nothing found".
 */

const IDENTITY_KEY = defineSecret('IDENTITY_KEY')
const KINDS = ['pcn', 'name_phone', 'phone']
const MAX_UIDS = 50 // a key shared by more accounts than this is not useful per-uid

const normalizeName = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()

// PH mobile: keep the last 10 digits (9XXXXXXXXX) so 09…, +639… and 639… agree.
const normalizePhone = (s) => {
  const d = String(s ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}

// Raw values per kind from a patient profile (users doc).
function profileValues(user) {
  if (!user || user.role !== 'patient') return { name_phone: null, phone: null }
  const name = normalizeName(user.name)
  const phone = normalizePhone(user.contact)
  return {
    name_phone: name && phone ? `${name}|${phone}` : null,
    phone: phone || null,
  }
}

const makeHmac = (secret) => (kind, value) =>
  crypto.createHmac('sha256', secret).update(`${kind}|${value}`).digest('hex')

// Recompute identityFlags for one uid from the index.
async function recomputeFlags({ db, uid, FieldValue }) {
  const [byUserSnap, userSnap] = await Promise.all([
    db.collection('identityIndexByUser').doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ])
  const user = userSnap.exists ? userSnap.data() : null
  const tenants = user?.role === 'patient' ? (user.tenantIds?.length ? user.tenantIds : [user.tenantId].filter(Boolean)) : []
  const hashes = byUserSnap.exists ? (byUserSnap.data().keys ?? {}) : {}

  const othersByKind = {}
  for (const kind of KINDS) {
    if (!hashes[kind]) continue
    const idx = await db.collection('identityIndex').doc(hashes[kind]).get()
    const uids = (idx.exists ? idx.data().uids ?? [] : []).filter(u => u !== uid).slice(0, MAX_UIDS)
    if (uids.length) othersByKind[kind] = uids
  }
  const otherIds = [...new Set(Object.values(othersByKind).flat())]
  const otherTenants = {}
  await Promise.all(otherIds.map(async (o) => {
    const s = await db.collection('users').doc(o).get()
    const d = s.exists ? s.data() : null
    otherTenants[o] = d ? (d.tenantIds?.length ? d.tenantIds : [d.tenantId].filter(Boolean)) : null
  }))

  const written = []
  for (const t of tenants) {
    const matches = []
    for (const kind of KINDS) {
      const others = (othersByKind[kind] ?? []).filter(o => otherTenants[o]) // skip deleted accounts
      if (!others.length) continue
      const sameHospitalUids = others.filter(o => otherTenants[o].includes(t))
      matches.push({ kind, sameHospitalUids, otherHospitalCount: others.length - sameHospitalUids.length })
    }
    // Phase 3 PR 3.2 (gap N18): a match found earlier is kept (marked
    // `past`) when the profile changes, until a social worker clears it with a
    // reason (clearIdentityFlag). Changing a phone no longer erases the flag
    // or the verification-call reason it carries.
    const flagRef = db.collection('identityFlags').doc(`${t}__${uid}`)
    const prevSnap = await flagRef.get()
    const prevMatches = prevSnap.exists ? (prevSnap.data().matches ?? []) : []
    const carried = prevMatches
      .filter((m) => !matches.some((c) => c.kind === m.kind))
      .map((m) => ({ ...m, past: true }))
    await flagRef.set({
      uid, tenantId: t, matches: [...matches, ...carried], updatedAt: FieldValue.serverTimestamp(),
      ...(prevSnap.exists && prevSnap.data().cleared ? { cleared: prevSnap.data().cleared } : {}),
    })
    written.push(t)
  }
  return written
}

/**
 * Update the index for one uid. `values` names only the kinds this event knows
 * (the profile trigger: name_phone + phone; the ID-document trigger: pcn); a
 * null value removes that key. Then recompute flags for every uid that shared
 * an old or new key.
 */
async function handleIdentityIndex({ db, uid, values, hmac, FieldValue }) {
  const byUserRef = db.collection('identityIndexByUser').doc(uid)
  const byUser = await byUserRef.get()
  const oldKeys = byUser.exists ? (byUser.data().keys ?? {}) : {}
  const newKeys = { ...oldKeys }
  const touched = new Set()

  for (const [kind, value] of Object.entries(values)) {
    if (!KINDS.includes(kind)) continue
    const next = value ? hmac(kind, value) : null
    const prev = oldKeys[kind] ?? null
    if (next === prev) continue
    if (prev) {
      await db.collection('identityIndex').doc(prev).set({ uids: FieldValue.arrayRemove(uid) }, { merge: true })
      touched.add(prev)
    }
    if (next) {
      await db.collection('identityIndex').doc(next).set({ kind, uids: FieldValue.arrayUnion(uid) }, { merge: true })
      touched.add(next)
      newKeys[kind] = next
    } else delete newKeys[kind]
  }
  await byUserRef.set({ keys: newKeys, updatedAt: FieldValue.serverTimestamp() })

  // Everyone who shared an old or new key may have gained or lost a match.
  const affected = new Set([uid])
  for (const h of touched) {
    const s = await db.collection('identityIndex').doc(h).get()
    for (const u of (s.exists ? s.data().uids ?? [] : []).slice(0, MAX_UIDS)) affected.add(u)
  }
  for (const u of affected) await recomputeFlags({ db, uid: u, FieldValue })
  return { uid, changed: touched.size, recomputed: affected.size }
}

const profileChanged = (before, after) => {
  if (!before || !after) return true
  const a = profileValues(before), b = profileValues(after)
  const ta = JSON.stringify(before.tenantIds ?? [before.tenantId]), tb = JSON.stringify(after.tenantIds ?? [after.tenantId])
  return a.name_phone !== b.name_phone || a.phone !== b.phone || ta !== tb || before.role !== after.role
}

// A social worker of the flag's hospital clears the PAST matches (ones no
// longer true of the profile) after asking the patient, with a reason.
// Matches that are true now come back on the next recompute anyway.
async function handleClearIdentityFlag({ callerUid, data, db, FieldValue: FV = FieldValue }) {
  const { fail, loadCaller, writeAudit } = require('./serverWrites')
  const caller = await loadCaller(db, callerUid)
  if (!['super_admin', 'staff_admin'].includes(caller.role) || !caller.tenantId) fail('permission-denied', "Only the hospital's staff can clear a flag.")
  const uid = typeof data?.patientId === 'string' ? data.patientId : ''
  const reason = typeof data?.reason === 'string' ? data.reason.trim().slice(0, 500) : ''
  if (!uid) fail('invalid-argument', 'A patient is required.')
  if (reason.length < 10) fail('invalid-argument', 'Give the reason (at least 10 characters).')
  const ref = db.collection('identityFlags').doc(`${caller.tenantId}__${uid}`)
  const snap = await ref.get()
  if (!snap.exists) fail('not-found', 'This patient has no flag at your hospital.')
  const past = (snap.data().matches ?? []).filter((m) => m.past)
  if (!past.length) fail('failed-precondition', 'There are no past matches to clear.')
  await ref.set({
    matches: (snap.data().matches ?? []).filter((m) => !m.past),
    cleared: { byUid: caller.uid, byName: caller.name ?? '', reason, kinds: past.map((m) => m.kind), at: FV.serverTimestamp() },
    updatedAt: FV.serverTimestamp(),
  }, { merge: true })
  await writeAudit(db, caller, {
    action: 'identity_flag_cleared', targetType: 'patient', targetId: uid, targetName: '',
    details: `Past duplicate-account matches cleared (${past.map((m) => m.kind).join(', ')}) · reason: ${reason}`,
    patientId: uid, tenantId: caller.tenantId,
  })
  return { cleared: past.length }
}

exports.handleClearIdentityFlag = handleClearIdentityFlag
exports.clearIdentityFlag = require('firebase-functions/v2/https').onCall({ region: 'asia-southeast1', timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const { HttpsError } = require('firebase-functions/v2/https')
  try {
    return await handleClearIdentityFlag({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error('[clearIdentityFlag] failed', { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Nothing was changed; try again.')
  }
})

exports.normalizeName = normalizeName
exports.normalizePhone = normalizePhone
exports.profileValues = profileValues
exports.makeHmac = makeHmac
exports.profileChanged = profileChanged
exports.recomputeFlags = recomputeFlags
exports.handleIdentityIndex = handleIdentityIndex

const OPTS = { region: 'asia-southeast1', timeoutSeconds: 120, memory: '256MiB', secrets: [IDENTITY_KEY] }

// Patient profile: name / phone / hospitals changed (most users writes — e.g.
// documentCount bumps — are skipped here).
exports.onPatientIdentityWritten = onDocumentWritten({ ...OPTS, document: 'users/{uid}' }, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  if (before?.role !== 'patient' && after?.role !== 'patient') return { skipped: 'not-patient' }
  if (!profileChanged(before, after)) return { skipped: 'unchanged' }
  try {
    const result = await handleIdentityIndex({
      db: getFirestore(), uid: event.params.uid, values: profileValues(after),
      hmac: makeHmac(IDENTITY_KEY.value()), FieldValue: FieldValue,
    })
    logger.info('[onPatientIdentityWritten]', result)
    return result
  } catch (err) {
    logger.error('[onPatientIdentityWritten] failed', { uid: event.params.uid, err: err.message })
    return { failed: err.message }
  }
})

// ID document: the PhilSys card fingerprint appeared or changed.
exports.onIdDocumentIdentityWritten = onDocumentWritten({ ...OPTS, document: 'documents/{docId}' }, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  const fp = after?.pcnFingerprint ?? null
  if (!after?.patientId || !fp || fp === (before?.pcnFingerprint ?? null)) return { skipped: 'no-pcn-change' }
  try {
    const result = await handleIdentityIndex({
      db: getFirestore(), uid: after.patientId, values: { pcn: fp },
      hmac: makeHmac(IDENTITY_KEY.value()), FieldValue: FieldValue,
    })
    logger.info('[onIdDocumentIdentityWritten]', result)
    return result
  } catch (err) {
    logger.error('[onIdDocumentIdentityWritten] failed', { docId: event.params.docId, err: err.message })
    return { failed: err.message }
  }
})
