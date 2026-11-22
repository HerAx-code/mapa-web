const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { assertStaffMfa } = require('./mfaPolicy')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')
const { fail, loadCaller, writeAudit, notifyServer } = require('./serverWrites')
const { isIntakeComplete, PATIENT_FACT_KEYS, isRequestClosed } = require('./generated/shared.cjs')

/**
 * amendAssessment — Phase 3 PR 3.2 (decision P3-B / D6, gap M7).
 *
 * The intake sheet locks at endorsement: agencies decide on it, and its
 * AO 2021-0044 class drives entitlement. A correction after that comes through
 * here, never a silent edit. In one transaction it:
 *   - applies the change to the amendable fields (the patient facts and the
 *     assessment), refusing one that would leave the sheet incomplete;
 *   - records the amendment (who, when, the reason, before / after) on the sheet;
 *   - voids the active Certificate of Eligibility if the class changed (it
 *     prints the class);
 *   - marks every approved slice `assessmentChangedAt` for its agency to look at.
 * Then it writes the audit entry and tells the endorsed agencies. Nothing is
 * reversed automatically.
 */

const GATEWAY = ['super_admin', 'staff_admin']
const AMENDABLE = [
  ...PATIENT_FACT_KEYS,
  'hospitalCaseNumber', 'caseStudyNarrative', 'recommendation',
  'meansTestCategory', 'meansTestOverrideReason', 'is4Ps', 'circumstances', 'circumstancesOther',
  'classificationValidMonths', 'classificationBasis',
]
const REASON_MIN = 10
const tenantOf = (d) => d?.tenantId || DEFAULT_HOSPITAL_ID
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const defaultDeps = {
  now: () => Date.now(),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  fromMillis: (ms) => Timestamp.fromMillis(ms),
}

async function handleAmendAssessment({ callerUid, data, db, ...overrides }) {
  const deps = { ...defaultDeps, ...overrides }
  const caller = await loadCaller(db, callerUid)
  if (!GATEWAY.includes(caller.role) || !caller.tenantId) fail('permission-denied', "Only the hospital's staff can amend an assessment.")
  const requestId = data?.requestId
  if (typeof requestId !== 'string' || !requestId) fail('invalid-argument', 'A request is required.')
  const reason = typeof data?.reason === 'string' ? data.reason.trim().slice(0, 1000) : ''
  if (reason.length < REASON_MIN) fail('invalid-argument', `Give the reason for the amendment (at least ${REASON_MIN} characters).`)
  const changes = data?.changes && typeof data.changes === 'object' && !Array.isArray(data.changes) ? data.changes : null
  if (!changes || !Object.keys(changes).length) fail('invalid-argument', 'Nothing to amend.')
  const bad = Object.keys(changes).filter((k) => !AMENDABLE.includes(k))
  if (bad.length) fail('invalid-argument', `These fields can't be amended here: ${bad.join(', ')}.`)
  if (JSON.stringify(changes).length > 20000) fail('invalid-argument', 'The amendment is too large.')

  const reqRef = db.doc(`requests/${requestId}`)
  const now = deps.now()
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef)
    if (!snap.exists) fail('not-found', 'That request no longer exists.')
    const r = snap.data()
    if (tenantOf(r) !== caller.tenantId) fail('permission-denied', 'That request belongs to another hospital.')
    if (!(r.agencyIds ?? []).length) fail('failed-precondition', 'This request is not endorsed yet — edit the assessment directly.')
    if (isRequestClosed(r.status)) fail('failed-precondition', 'This request is closed.')
    const prev = r.intakeSheet ?? {}
    const fields = Object.keys(changes).filter((k) => !same(prev[k], changes[k]))
    if (!fields.length) fail('invalid-argument', 'Nothing changed.')
    const next = { ...prev, ...Object.fromEntries(fields.map((k) => [k, changes[k]])) }
    if (!isIntakeComplete(next, r.totalBill)) fail('failed-precondition', 'This change would leave the assessment incomplete.')
    const classChanged = !same(prev.meansTestCategory, next.meansTestCategory)

    const slices = (await tx.get(db.collection('applications').where('requestId', '==', reqRef.id))).docs
    const cert = r.eligibilityCert && r.eligibilityCert.status !== 'voided' && r.eligibilityCert.id
      ? db.doc(`eligibilityCertificates/${r.eligibilityCert.id}`) : null

    const amendment = {
      at: deps.fromMillis(now), byUid: caller.uid, byName: caller.name ?? '', reason, fields,
      before: Object.fromEntries(fields.map((k) => [k, prev[k] ?? null])),
      after: Object.fromEntries(fields.map((k) => [k, next[k] ?? null])),
      classChanged,
    }
    tx.update(reqRef, {
      intakeSheet: { ...next, amendments: [...(prev.amendments ?? []), amendment], lastEditedBy: caller.name ?? '', lastEditedAt: deps.serverTimestamp() },
      ...(classChanged && cert ? { eligibilityCert: { ...r.eligibilityCert, status: 'voided' } } : {}),
      updatedAt: deps.serverTimestamp(),
    })
    if (classChanged && cert) {
      tx.update(cert, {
        status: 'voided',
        voided: { reason: `The classification was amended: ${reason}`, by: caller.name ?? '', byUid: caller.uid, at: deps.serverTimestamp() },
        updatedAt: deps.serverTimestamp(),
      })
    }
    const approved = slices.filter((d) => ['approved', 'certificate'].includes(d.data().status))
    for (const d of approved) {
      tx.update(d.ref, {
        assessmentChangedAt: deps.serverTimestamp(),
        assessmentChange: { fields, classFrom: prev.meansTestCategory ?? null, classTo: next.meansTestCategory ?? null, reason, byName: caller.name ?? '' },
        updatedAt: deps.serverTimestamp(),
      })
    }
    return { r, fields, classChanged, certVoided: !!(classChanged && cert), approvedAgencies: approved.map((d) => d.data().agencyId) }
  })

  await writeAudit(db, caller, {
    action: 'assessment_amended', targetType: 'request', targetId: requestId, targetName: out.r.requestId ?? '',
    details: `Amended ${out.fields.join(', ')}${out.classChanged ? ` · class ${out.r.intakeSheet?.meansTestCategory ?? '—'} → ${changes.meansTestCategory ?? '—'}` : ''}`
      + `${out.certVoided ? ' · Certificate of Eligibility voided' : ''} · reason: ${reason}`,
    requestId, patientId: out.r.patientId ?? null, tenantId: tenantOf(out.r),
  }).catch((err) => logger.warn('[amendAssessment] audit failed', { err: err?.message }))

  const agencyIds = (out.r.agencyIds ?? []).slice(0, 30)
  if (agencyIds.length) {
    const staff = await db.collection('users').where('agencyId', 'in', agencyIds).get()
    await Promise.allSettled(staff.docs.filter((d) => ['agency', 'agency_admin'].includes(d.data().role)).map((d) =>
      notifyServer(db, d.id, {
        type: 'app_advanced',
        title: 'Assessment amended on an endorsed case',
        body: `The hospital amended the assessment for ${out.r.patientName ?? 'a patient'} (${out.r.requestId ?? ''}): ${out.fields.join(', ')}.`
          + (out.classChanged ? ' The patient classification changed.' : '')
          + (out.approvedAgencies.includes(d.data().agencyId) ? ' You already approved this case — please review it.' : '')
          + ` Reason: ${reason}`,
      }, caller.uid)))
  }
  return { fields: out.fields, classChanged: out.classChanged, certVoided: out.certVoided }
}

exports.handleAmendAssessment = handleAmendAssessment
exports.AMENDABLE = AMENDABLE
exports.amendAssessment = onCall({ region: 'asia-southeast1', timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  try {
    await assertStaffMfa(getFirestore(), request.auth)
    return await handleAmendAssessment({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error('[amendAssessment] failed', { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Nothing was changed; try again.')
  }
})
