const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { assertStaffMfa } = require('./mfaPolicy')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')
const { fail, loadCaller, writeAudit, notifyServer } = require('./serverWrites')
const {
  deriveRequestStage, interviewReasons, secondPersonHold, missingAgencyDocs,
  computeFunding, deriveRequestFinancials, effectiveSlots, manilaDayKey,
  isRequestClosed, OPEN_SLICE_STATUSES,
} = require('./generated/shared.cjs')

/**
 * The hospital's money actions on a case, on the server (Phase 2 PR 2.2 —
 * docs/phase2-money-plan.md):
 *
 *   endorseRequest — gaps M8 (gate only in the browser), M14 (endorsing a
 *                    case someone just closed), I6 (slots counted only in the
 *                    browser). Re-reads the request and re-runs the endorse
 *                    gate — the same deriveRequestStage the page shows, with
 *                    documents read from documents/, the verification-call
 *                    reasons and the second-person rule by uid (M15) — then
 *                    takes one of today's slots from each agency's share for
 *                    this hospital, in one transaction.
 *   closeRequest   — close or reject: ends every open slice, refuses
 *                    "rejected" once money is committed, and gives back a
 *                    slot taken today.
 *
 * The rules no longer let hospital staff write slices, the request's money
 * fields or any agency slot count; these functions are the only path.
 */

const GATEWAY = ['super_admin', 'staff_admin']
const partnersOf = (agency) => (Array.isArray(agency?.partnerHospitalIds) ? agency.partnerHospitalIds : [DEFAULT_HOSPITAL_ID])
const tenantOf = (d) => d?.tenantId || DEFAULT_HOSPITAL_ID
const tsMillis = (ts) => ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : typeof ts?.seconds === 'number' ? ts.seconds * 1000 : null
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`
const newAppId = (now) => `APP-${new Date(now).getFullYear()}-${String(now).slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`

async function loadGatewayCaller(db, callerUid) {
  const caller = await loadCaller(db, callerUid)
  if (!GATEWAY.includes(caller.role) || !caller.tenantId) fail('permission-denied', "Only the hospital's staff can do this.")
  return caller
}

async function loadCase(db, caller, requestId) {
  if (typeof requestId !== 'string' || !requestId) fail('invalid-argument', 'A request is required.')
  const ref = db.doc(`requests/${requestId}`)
  const snap = await ref.get()
  if (!snap.exists) fail('not-found', 'That request no longer exists.')
  if (tenantOf(snap.data()) !== caller.tenantId) fail('permission-denied', 'That request belongs to another hospital.')
  return { ref, request: snap.data() }
}

const hospitalName = async (db, tenantId) => {
  const h = await db.doc(`hospitals/${tenantId}`).get().catch(() => null)
  return h?.exists ? (h.data().gatewayName || h.data().facilityName || 'The hospital') : 'The hospital'
}

// ── endorseRequest ─────────────────────────────────────────────────────────

// The documents the gate counts, with their live status (the request's own
// copy can be stale, gap M4).
async function liveDocuments(db, request) {
  const attached = (request.attachedDocuments ?? []).filter((a) => a?.documentId)
  const snaps = await Promise.all(attached.map((a) => db.doc(`documents/${a.documentId}`).get()))
  return attached.map((a, i) => ({ ...a, status: snaps[i].exists ? snaps[i].data().status : a.status }))
}

async function gateFor(db, request, docs, caller) {
  const t = tenantOf(request)
  const [settingsSnap, flagSnap] = await Promise.all([
    db.doc(`hospitalSettings/${t}`).get(),
    db.doc(`identityFlags/${t}__${request.patientId}`).get(),
  ])
  const settings = settingsSnap.exists ? settingsSnap.data() : {}
  const callReasons = interviewReasons({ request, settings, identityFlag: flagSnap.exists ? flagSnap.data() : null })
  const hold = secondPersonHold({ request, settings, user: { uid: caller.uid, name: caller.name } })
  return deriveRequestStage(request, docs, { callReasons, holds: hold ? [hold] : [] })
}

async function handleEndorseRequest({ callerUid, data, db, now = () => Date.now(), serverTimestamp = () => FieldValue.serverTimestamp(), arrayUnion = (...v) => FieldValue.arrayUnion(...v) }) {
  const caller = await loadGatewayCaller(db, callerUid)
  const agencyIds = [...new Set(Array.isArray(data?.agencyIds) ? data.agencyIds.filter((x) => typeof x === 'string' && x) : [])]
  if (!agencyIds.length || agencyIds.length > 10) fail('invalid-argument', 'Choose between 1 and 10 agencies.')
  const notes = typeof data?.notes === 'string' && data.notes.trim() ? data.notes.trim().slice(0, 1000) : null
  const { ref: reqRef, request: pre } = await loadCase(db, caller, data?.requestId)
  const t = tenantOf(pre)

  // Read outside the transaction: the gate's inputs and who to watch.
  const docs = await liveDocuments(db, pre)
  const staffSnap = await db.collection('users').where('agencyId', 'in', agencyIds).get()
  const watcherUids = staffSnap.docs.filter((d) => ['agency', 'agency_admin'].includes(d.data().role)).map((d) => d.id)
  const today = manilaDayKey(now())

  const out = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(reqRef)
    if (!fresh.exists) fail('not-found', 'That request no longer exists.')
    const r = fresh.data()
    if (isRequestClosed(r.status)) fail('failed-precondition', 'This request was closed or rejected, so it can no longer be endorsed.')
    const stage = await gateFor(db, r, docs, caller)
    if (!stage.canEndorse) {
      fail('failed-precondition', `Not ready to endorse: ${stage.blockers.map((b) => b.detail ? `${b.label} (${b.detail})` : b.label).join('; ') || 'prerequisites pending'}.`)
    }
    const existing = (await tx.get(db.collection('applications').where('requestId', '==', reqRef.id))).docs.map((d) => d.data())
    const need = Number(r.amountNeeded) || 0
    if (computeFunding(need, existing).headroom <= 0) fail('failed-precondition', 'The endorsed agencies already cover the amount needed.')
    const used = new Set(existing.map((s) => s.agencyId))

    const agencies = []
    for (const id of agencyIds) {
      const snap = await tx.get(db.doc(`agencies/${id}`))
      if (!snap.exists) fail('not-found', 'One of the agencies no longer exists.')
      const a = snap.data()
      if (a.enabled === false) fail('failed-precondition', `${a.name ?? 'An agency'} is not taking endorsements.`)
      if (!partnersOf(a).includes(t)) fail('failed-precondition', `${a.name ?? 'An agency'} doesn't partner with this hospital.`)
      if (used.has(id)) fail('failed-precondition', `This request was already endorsed to ${a.name ?? 'that agency'}.`)
      const slots = effectiveSlots(a, today, t)
      if (slots.remaining <= 0) fail('resource-exhausted', `${a.name ?? 'An agency'} has no slots left today. Unselect it and try again.`)
      agencies.push({ id, data: a, slots })
    }

    const newSlices = []
    for (const { id, data: a, slots } of agencies) {
      const sliceRef = db.collection('applications').doc()
      const slice = {
        tenantId: t,
        appId: newAppId(now()),
        requestId: reqRef.id,
        amountRequested: need,
        amountApproved: 0,
        patientId: r.patientId,
        patientName: r.patientName ?? '',
        patientContact: r.patientContact ?? '',
        patientAddress: r.patientAddress ?? '',
        patientHospitalId: r.patientHospitalId ?? null,
        agencyId: id,
        agencyName: a.name ?? '',
        agencyColor: a.color ?? 'bg-gray-500',
        agencyInitials: a.initials ?? (a.name ?? '').slice(0, 2).toUpperCase(),
        assistanceType: r.assistanceType ?? '',
        careSetting: r.careSetting ?? 'inpatient',
        ...(r.careUnit ? { careUnit: r.careUnit } : {}),
        status: 'endorsed',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        attachedDocuments: r.attachedDocuments ?? [],
        endorsedById: caller.uid,
        endorsedBy: caller.name ?? '',
        endorsedAt: serverTimestamp(),
        gatewayNotes: notes,
      }
      tx.set(sliceRef, slice)
      newSlices.push({ id: sliceRef.id, ...slice })
      // Take one of today's slots: this hospital's share, else the agency-wide count.
      if (slots.perHospital) {
        tx.update(db.doc(`agencies/${id}`), {
          [`hospitalSlots.${t}.remaining`]: slots.remaining - 1,
          [`hospitalSlots.${t}.lastResetDate`]: today,
        })
      } else {
        tx.update(db.doc(`agencies/${id}`), { 'slots.remaining': slots.remaining - 1, lastResetDate: today })
      }
    }

    const next = deriveRequestFinancials([...existing, ...newSlices], need)
    tx.update(reqRef, {
      agencyIds: arrayUnion(...agencyIds),
      status: next.status,
      amountCommitted: next.amountCommitted,
      openLetters: next.openLetters,
      ...(watcherUids.length ? { watchers: arrayUnion(...watcherUids) } : {}),
      updatedAt: serverTimestamp(),
    })
    return { request: r, agencies, sliceIds: newSlices.map((s) => s.id) }
  })

  // After the commit (best-effort): who may read what, the record, the patient.
  for (const d of docs) {
    await db.doc(`documents/${d.documentId}`).update({ agencyIds: arrayUnion(...agencyIds) }).catch((err) => {
      if (err?.code !== 5) logger.warn('[endorseRequest] document stamp failed', { docId: d.documentId, err: err?.message })
    })
  }
  if (out.request.patientId) {
    await db.doc(`users/${out.request.patientId}`).update({ agencyIds: arrayUnion(...agencyIds) })
      .catch((err) => logger.warn('[endorseRequest] patient stamp failed', { err: err?.message }))
  }
  const names = out.agencies.map((a) => a.data.name ?? a.id).join(', ')
  await writeAudit(db, caller, {
    action: 'request_endorsed', targetType: 'request', targetId: reqRef.id, targetName: out.request.requestId ?? '',
    details: `Endorsed to ${out.agencies.length} agenc${out.agencies.length === 1 ? 'y' : 'ies'}: ${names}${notes ? ` · note: ${notes}` : ''}`,
    requestId: reqRef.id, patientId: out.request.patientId ?? null, tenantId: t,
  })
  const haveNames = (out.request.attachedDocuments ?? []).map((a) => a?.documentTypeName ?? a?.name).filter(Boolean)
  const toAdd = out.agencies
    .map((a) => ({ name: a.data.name ?? a.id, missing: missingAgencyDocs(a.data.requirements, haveNames, out.request) }))
    .filter((a) => a.missing.length)
    .map((a) => `${a.name}: ${a.missing.join(', ')}`)
  const office = await hospitalName(db, t)
  await notifyServer(db, out.request.patientId, {
    type: 'app_advanced', title: 'Your request was endorsed',
    body: `${office} referred your request to ${out.agencies.length} agenc${out.agencies.length === 1 ? 'y' : 'ies'} (${names}). Each will assess your case. Review your coverage plan and proceed.`
      + (toAdd.length ? ` Please also upload in your coverage plan: ${toAdd.join('; ')}.` : ''),
  }, caller.uid)
  return { sliceIds: out.sliceIds }
}

// ── closeRequest ───────────────────────────────────────────────────────────

// The one closing path (Phase 4 PR 4.1), used by a person (closeRequest) and
// by the case timers (P4-A). `actor` is the staff member, or
// systemActor(timer, tenantId); `guard(request, slices)` re-checks inside the
// transaction and returns false to leave the case alone (someone acted first).
// Letters already issued are not touched (D4): only OPEN slices close.
const systemActor = (timer, tenantId) => ({ uid: 'system', name: 'MAPA (automatic)', role: 'system', system: timer, tenantId })

async function closeCaseCore({
  db, reqRef, outcome, reason = null, actor, closedAs = null, guard = null,
  closeNote = outcome === 'rejected' ? 'The hospital rejected this request.' : 'The hospital closed this request.',
  patientNote = null, auditAction = null,
  now = () => Date.now(), serverTimestamp = () => FieldValue.serverTimestamp(),
}) {
  const today = manilaDayKey(now())
  const out = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(reqRef)
    if (!fresh.exists) fail('not-found', 'That request no longer exists.')
    const r = fresh.data()
    if (isRequestClosed(r.status)) {
      if (guard) return null
      fail('failed-precondition', 'This request is already closed.')
    }
    const sliceDocs = (await tx.get(db.collection('applications').where('requestId', '==', reqRef.id))).docs
    const slices = sliceDocs.map((d) => d.data())
    if (guard && !guard(r, slices)) return null
    if (outcome === 'rejected' && computeFunding(r.amountNeeded, slices).committed > 0) {
      fail('failed-precondition', 'An agency has already committed funds — close the request instead of rejecting it.')
    }
    const open = sliceDocs.filter((d) => OPEN_SLICE_STATUSES.includes(d.data().status))
    // A slot taken today comes back (a slot from an earlier day has refilled).
    const giveBack = open.filter((d) => {
      const at = tsMillis(d.data().endorsedAt ?? d.data().submittedAt)
      return at != null && manilaDayKey(at) === today
    })
    const agencySnaps = {}
    for (const d of giveBack) {
      const id = d.data().agencyId
      if (id && !agencySnaps[id]) agencySnaps[id] = await tx.get(db.doc(`agencies/${id}`))
    }

    tx.update(reqRef, {
      status: outcome, ...(reason ? { closeReason: reason } : {}), ...(closedAs ? { closedAs } : {}),
      ...(actor.system ? { closedBy: `system:${actor.system}` } : {}),
      updatedAt: serverTimestamp(),
    })
    for (const d of open) {
      tx.update(d.ref, {
        status: 'closed', closedReason: reason ? `${closeNote} ${reason}` : closeNote,
        closedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
    }
    const back = {}
    for (const d of giveBack) back[d.data().agencyId] = (back[d.data().agencyId] ?? 0) + 1
    const t = tenantOf(r)
    for (const [id, n] of Object.entries(back)) {
      const snap = agencySnaps[id]
      if (!snap?.exists) continue
      const a = snap.data()
      const own = a.hospitalSlots?.[t]
      if (own && own.lastResetDate === today) {
        tx.update(snap.ref, { [`hospitalSlots.${t}.remaining`]: Math.min((Number(own.remaining) || 0) + n, Number(own.total) || 0) })
      } else if (!own && a.lastResetDate === today) {
        tx.update(snap.ref, { 'slots.remaining': Math.min((Number(a.slots?.remaining) || 0) + n, Number(a.slots?.total) || 0) })
      }
    }
    return { request: r, openAgencyIds: [...new Set(open.map((d) => d.data().agencyId).filter(Boolean))] }
  })
  if (!out) return null

  const fromUid = actor.system ? null : actor.uid
  if (out.openAgencyIds.length) {
    const staff = await db.collection('users').where('agencyId', 'in', out.openAgencyIds.slice(0, 30)).get()
    for (const u of staff.docs.filter((d) => ['agency', 'agency_admin'].includes(d.data().role))) {
      await notifyServer(db, u.id, {
        type: 'app_advanced', title: 'Endorsement closed',
        body: `${closeNote} ${out.request.patientName ?? ''} (${out.request.requestId ?? ''}) no longer needs your review.`,
      }, fromUid)
    }
  }
  await writeAudit(db, actor, {
    action: auditAction ?? (outcome === 'rejected' ? 'request_rejected' : 'request_closed'), targetType: 'request',
    targetId: reqRef.id, targetName: out.request.requestId ?? '', details: reason ?? outcome,
    requestId: reqRef.id, patientId: out.request.patientId ?? null, tenantId: tenantOf(out.request),
  })
  await notifyServer(db, out.request.patientId, {
    type: 'app_advanced',
    title: outcome === 'rejected' ? 'Request not approved' : 'Request closed',
    body: (patientNote || reason || (outcome === 'rejected' ? 'Your assistance request was not approved.' : 'Your assistance request was closed.'))
      + " To apply again, ask the hospital's social-services office for a new access code.",
  }, fromUid)
  return { closedSlices: out.openAgencyIds.length, request: out.request }
}

async function handleCloseRequest({ callerUid, data, db, now = () => Date.now(), serverTimestamp = () => FieldValue.serverTimestamp() }) {
  const caller = await loadGatewayCaller(db, callerUid)
  const outcome = data?.outcome
  if (!['closed', 'rejected'].includes(outcome)) fail('invalid-argument', 'Choose close or reject.')
  const reason = typeof data?.reason === 'string' && data.reason.trim() ? data.reason.trim().slice(0, 500) : null
  const { ref: reqRef } = await loadCase(db, caller, data?.requestId)
  const out = await closeCaseCore({ db, reqRef, outcome, reason, actor: caller, now, serverTimestamp })
  return { closedSlices: out.closedSlices }
}

// ── Callables ──────────────────────────────────────────────────────────────

const wrap = (name, handler) => onCall({ region: 'asia-southeast1', timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  try {
    // Two-factor stage 2 (Phase 5 PR 5.4): off until enabled in mfaPolicy.js.
    await assertStaffMfa(getFirestore(), request.auth)
    return await handler({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error(`[${name}] failed`, { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Nothing was changed; try again.')
  }
})

exports.handleEndorseRequest = handleEndorseRequest
exports.handleCloseRequest = handleCloseRequest
exports.closeCaseCore = closeCaseCore
exports.systemActor = systemActor
exports.endorseRequest = wrap('endorseRequest', handleEndorseRequest)
exports.closeRequest = wrap('closeRequest', handleCloseRequest)
exports._peso = peso
