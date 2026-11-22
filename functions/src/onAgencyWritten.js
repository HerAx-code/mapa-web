const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

/**
 * onAgencyWritten — projects the PUBLIC subset of an agency doc into a
 * separate `agenciesPublic/{id}` collection.
 *
 * WHY THIS EXISTS
 *
 * The public marketing Landing page shows a live "programs" teaser (agency
 * name + remaining interview slots) to unauthenticated visitors. It used to
 * read `agencies` directly, which forced `allow read: if true` on that
 * collection — exposing every partner agency's budget (allocated / committed /
 * disbursed), fund source, contacts and signatories to anyone on the internet
 * (audit SEC-3). Splitting a tiny public projection out lets us gate the rich
 * `agencies` collection to `if isAuth()` while the Landing page reads only the
 * harmless projection.
 *
 * WHY A TRIGGER (not a client-side mirror)
 *
 * `slots.remaining` changes from many writers — the endorsement transaction
 * decrements it, the `resetAgencySlots` scheduled function resets it daily,
 * SlotManagement adjusts it, admins edit capacity. A single onWrite trigger
 * catches them all with no drift; a client mirror would miss the
 * function-driven writes.
 *
 * SAFE IN ANY DEPLOY ORDER
 *
 * If this function (or the backfill) hasn't run yet, `agenciesPublic` is empty
 * and the Landing teaser simply shows no agencies — degraded, never broken.
 * Nothing authenticated depends on the projection.
 *
 * Only the public, non-sensitive fields are copied. Never budget / fundSource /
 * contacts / signatories.
 */

// The exact public projection. Anything added here becomes world-readable, so
// NEVER budget / fundSource / contacts / signatories / caps / repeat limits /
// slot history / fundingType.
//
// Phase 1 (N10, 2026-11-21): patients read this projection instead of the full
// agency record, so it carries what patient screens use — the profile text
// (Find Programs), assistance types and document requirements (filing), the
// partner hospitals and both slot shapes (the hospital marketplace and
// effectiveSlots()). `slots` stays the sum of all daily capacity, which is what
// the Landing teaser shows; `agencySlots` + `lastResetDate` + `hospitalSlots`
// are the raw counts effectiveSlots() needs (src/utils/agenciesPublic.js
// agencyFromPublic). This function is the ONLY writer (the rules refuse
// browsers); scripts/backfill-agencies-public.js imports it.
const num = (v) => Number(v) || 0
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 50) : [])

function projectPublicAgency(data = {}) {
  const raw = data.slots ?? {}
  const per = data.hospitalSlots && typeof data.hospitalSlots === 'object' ? Object.entries(data.hospitalSlots) : []
  const hospitalSlots = Object.fromEntries(per.map(([h, x]) => [h, {
    total: num(x?.total), remaining: num(x?.remaining), lastResetDate: typeof x?.lastResetDate === 'string' ? x.lastResetDate : null,
  }]))
  const sum = per.length
    ? per.reduce((a, [, x]) => ({ total: a.total + num(x?.total), remaining: a.remaining + num(x?.remaining) }), { total: 0, remaining: 0 })
    : { total: num(raw.total), remaining: num(raw.remaining) }
  return {
    name:     data.name ?? '',
    initials: data.initials ?? '',
    color:    data.color ?? '',
    location: data.location ?? '',
    enabled:  data.enabled !== false, // default-enabled unless explicitly false
    slots:    sum,
    agencySlots: { total: num(raw.total), remaining: num(raw.remaining) },
    lastResetDate: typeof data.lastResetDate === 'string' ? data.lastResetDate : null,
    hospitalSlots,
    // Absent stays absent: an agency with no list partners with hospital #1
    // only (partnerHospitalIdsOf), which an empty list would change.
    ...(Array.isArray(data.partnerHospitalIds) ? { partnerHospitalIds: names(data.partnerHospitalIds) } : {}),
    assistanceTypes: names(data.assistanceTypes),
    requirements:    names(data.requirements),
    description:     str(data.description, 2000),
    procedure:       str(data.procedure, 4000),
    processingTime:  str(data.processingTime, 200),
  }
}

async function handleAgencyWritten({ db, agencyId, before, after, serverTimestamp }) {
  const pubRef = db.collection('agenciesPublic').doc(agencyId)

  // Agency deleted → drop its public mirror.
  if (!after) {
    if (before) await pubRef.delete()
    return { deleted: agencyId }
  }

  // A training agency (the Training Hospital's practice funder) is never
  // public — it must not show on Landing. Drop any mirror it has.
  if (after.training === true) {
    if (before) await pubRef.delete()
    return { skipped: 'training', agencyId }
  }

  const next = projectPublicAgency(after)

  // Skip a write when the projected fields are unchanged, so unrelated agency
  // edits (e.g. a budget allocation) don't churn the public doc.
  if (before) {
    const prev = projectPublicAgency(before)
    if (JSON.stringify(prev) === JSON.stringify(next)) {
      return { skipped: 'projection-unchanged', agencyId }
    }
  }

  // A full set (not merge): the projection is the whole public doc, so a
  // field the agency no longer has disappears from it too.
  await pubRef.set({ ...next, updatedAt: serverTimestamp() })
  return { projected: next, agencyId }
}

// Rewrites the whole public listing from the agencies collection and removes
// any public doc whose agency is gone or is a training agency. The Super
// Admin's "Resync public" button (Phase 1: browsers no longer write the
// listing) and the one-off backfill after this projection changes.
async function handleResyncAgenciesPublic({ callerUid, db, serverTimestamp }) {
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const caller = await db.doc(`users/${callerUid}`).get()
  if (!caller.exists || caller.data().role !== 'platform_admin') {
    throw new HttpsError('permission-denied', 'Only the Super Admin can resync the public listing.')
  }
  const [agencies, published] = await Promise.all([db.collection('agencies').get(), db.collection('agenciesPublic').get()])
  const keep = new Set()
  let written = 0
  for (const a of agencies.docs) {
    if (a.data().training === true) continue
    keep.add(a.id)
    await db.collection('agenciesPublic').doc(a.id).set({ ...projectPublicAgency(a.data()), updatedAt: serverTimestamp() })
    written++
  }
  let pruned = 0
  for (const p of published.docs) {
    if (!keep.has(p.id)) { await p.ref.delete(); pruned++ }
  }
  return { written, pruned }
}

// ── Phase 4 PR 4.3 (P4-D, gaps M2, M13): partnership endings and disables ──
// Removing a hospital from partnerHospitalIds closes that hospital's open
// slices at this agency at once (the partnership is over; the hospital can
// endorse elsewhere). Disabling stamps disabledAt so the daily caseTimers can
// release slices held longer than the hospital's limit; re-enabling clears it.
const OPEN = ['endorsed', 'reviewing', 'awaiting_info']
const partnersOf = (a) => {
  const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')
  return Array.isArray(a?.partnerHospitalIds) ? a.partnerHospitalIds : [DEFAULT_HOSPITAL_ID]
}

async function handleAgencyEndings({ db, agencyId, before, after, serverTimestamp, deleteField = () => FieldValue.delete(), sliceOverrides = {} }) {
  if (!before || !after) return { skipped: 'create-or-delete' }
  const out = { closed: 0, disabledAt: null }
  const ref = db.collection('agencies').doc(agencyId)
  if (before.enabled !== false && after.enabled === false && !after.disabledAt) {
    await ref.update({ disabledAt: serverTimestamp() })
    out.disabledAt = 'set'
  } else if (after.enabled !== false && after.disabledAt) {
    await ref.update({ disabledAt: deleteField() })
    out.disabledAt = 'cleared'
  }

  const removed = partnersOf(before).filter((h) => !partnersOf(after).includes(h))
  if (!removed.length) return out
  const { closeSliceCore } = require('./sliceActions')
  const slices = await db.collection('applications').where('agencyId', '==', agencyId).get()
  const name = after.name ?? 'The agency'
  for (const d of slices.docs.filter((x) => OPEN.includes(x.data().status) && removed.includes(x.data().tenantId))) {
    const s = d.data()
    try {
      const done = await closeSliceCore({
        db, sliceRef: d.ref, from: OPEN, closedAs: 'partner_ended',
        reason: `${name} no longer partners with this hospital.`,
        actor: { uid: 'system', name: 'MAPA (automatic)', role: 'system', system: 'partner_ended', tenantId: s.tenantId },
        auditAction: 'slice_partner_ended',
        patient: { type: 'app_advanced', title: 'Application closed', body: `${name} no longer works with your hospital, so your application to it was closed. The hospital may endorse your request to another agency.` },
        hospital: { type: 'app_advanced', title: `${name} no longer partners with your hospital`, body: `${s.patientName ?? 'A patient'}'s endorsement to ${name} was closed. Endorse to another agency.` },
        overrides: sliceOverrides,
      })
      if (done) out.closed++
    } catch (err) {
      logger.error('[onAgencyWritten] closing a slice failed', { sliceId: d.id, err: err.message })
    }
  }
  return out
}

// The Super Admin can't read slices (no patient data), so the dialogs ask
// here how many open applications a partner removal or a disable affects.
async function handleCountAgencyOpenSlices({ callerUid, data, db }) {
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const caller = await db.doc(`users/${callerUid}`).get()
  if (!caller.exists || caller.data().role !== 'platform_admin') throw new HttpsError('permission-denied', 'Only the Super Admin can see this.')
  const agencyId = data?.agencyId
  if (typeof agencyId !== 'string' || !agencyId) throw new HttpsError('invalid-argument', 'An agency is required.')
  const slices = await db.collection('applications').where('agencyId', '==', agencyId).get()
  const byHospital = {}
  for (const d of slices.docs.filter((x) => OPEN.includes(x.data().status))) {
    const t = d.data().tenantId ?? 'unknown'
    byHospital[t] = (byHospital[t] ?? 0) + 1
  }
  return { total: Object.values(byHospital).reduce((a, b) => a + b, 0), byHospital }
}

exports.handleAgencyEndings = handleAgencyEndings
exports.handleCountAgencyOpenSlices = handleCountAgencyOpenSlices
exports.countAgencyOpenSlices = onCall({ region: 'asia-southeast1', timeoutSeconds: 30, memory: '256MiB' },
  async (request) => handleCountAgencyOpenSlices({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() }))

exports.handleAgencyWritten = handleAgencyWritten
exports.projectPublicAgency = projectPublicAgency
exports.handleResyncAgenciesPublic = handleResyncAgenciesPublic

exports.resyncAgenciesPublic = onCall({ region: 'asia-southeast1', timeoutSeconds: 120, memory: '256MiB' },
  async (request) => handleResyncAgenciesPublic({
    callerUid: request.auth?.uid, db: getFirestore(), serverTimestamp: () => FieldValue.serverTimestamp(),
  }))

exports.onAgencyWritten = onDocumentWritten({
  document: 'agencies/{agencyId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  // Phase 4 PR 4.3: partnership endings and the disable stamp (own try, so a
  // failure here never blocks the public projection, and vice versa).
  try {
    const endings = await handleAgencyEndings({
      db: getFirestore(), agencyId: event.params.agencyId, before, after,
      serverTimestamp: () => FieldValue.serverTimestamp(),
    })
    if (endings.closed || endings.disabledAt) logger.info('[onAgencyWritten] endings', { agencyId: event.params.agencyId, ...endings })
  } catch (err) {
    logger.error('[onAgencyWritten] endings failed', { agencyId: event.params?.agencyId, err: err.message })
  }
  try {
    const result = await handleAgencyWritten({
      db: getFirestore(),
      agencyId: event.params.agencyId,
      before,
      after,
      serverTimestamp: () => FieldValue.serverTimestamp(),
    })
    return result
  } catch (err) {
    // Never rethrow: a failed public projection must not retry-storm or block
    // anything. The Landing teaser tolerates a briefly-stale mirror.
    logger.error('[onAgencyWritten] projection failed', {
      agencyId: event.params?.agencyId, err: err.message,
    })
    return { failed: err.message }
  }
})
