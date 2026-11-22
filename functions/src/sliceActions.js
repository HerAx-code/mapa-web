const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')
const { fail, loadCaller, writeAudit, notifyServer } = require('./serverWrites')
const {
  computeFunding, deriveRequestFinancials, syncedRequestStatus, isRequestClosed,
  sliceApproved, glExpiresAtFor, glExpiryMs, manilaDayKey,
  approvalCooldownBlock, repeatLimitOf, OVERRIDE_REASON_MIN,
} = require('./generated/shared.cjs')

/**
 * The agency's decisions and letters, on the server (Phase 2 PR 2.3 —
 * docs/phase2-money-plan.md):
 *
 *   decideSlice  — request_info, resume, approve, reject.
 *                  Approve only from "reviewing" (I2), on an open request,
 *                  from a current partner (M13), within the endorsed amount,
 *                  the agency's maximum per approval, its budget headroom when
 *                  an allocation is set (P2-C) and, for outpatients, what the
 *                  other agencies leave of the charge (N2); inside the repeat
 *                  limit only with a written reason.
 *   settleLetter — mark_issued, redeem, undo_redeem, expire, reverse.
 *
 * Every action re-reads the slice, its request, the sibling slices and the
 * agency in one transaction (M3), moves budget.committed / disbursed whether
 * or not an allocation is set, and writes the request's totals. The hourly
 * glExpirySweep expires letters through the same code (R2). The rules let
 * agency staff write only notes on a slice; status, amounts, letters and
 * budgets come only from here.
 */

const AGENCY_ROLES = ['agency', 'agency_admin']
const partnersOf = (agency) => (Array.isArray(agency?.partnerHospitalIds) ? agency.partnerHospitalIds : [DEFAULT_HOSPITAL_ID])
const tenantOf = (d) => d?.tenantId || DEFAULT_HOSPITAL_ID
const tsMillis = (ts) => ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : typeof ts?.seconds === 'number' ? ts.seconds * 1000 : null
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '')

const defaultDeps = {
  now: () => Date.now(),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  increment: (n) => FieldValue.increment(n),
  fromMillis: (ms) => Timestamp.fromMillis(ms),
}

// ── Shared core: read the case, write one change ───────────────────────────

// Everything a slice change needs, read inside the transaction.
async function readSliceCase(tx, db, sliceRef) {
  const snap = await tx.get(sliceRef)
  if (!snap.exists) fail('not-found', 'That application no longer exists.')
  const slice = snap.data()
  const reqRef = slice.requestId ? db.doc(`requests/${slice.requestId}`) : null
  const reqSnap = reqRef ? await tx.get(reqRef) : null
  const siblings = reqRef
    ? (await tx.get(db.collection('applications').where('requestId', '==', slice.requestId))).docs.map((d) => ({ id: d.id, ...d.data() }))
    : []
  const agencyRef = slice.agencyId ? db.doc(`agencies/${slice.agencyId}`) : null
  const agencySnap = agencyRef ? await tx.get(agencyRef) : null
  return {
    sliceRef, slice,
    reqRef, request: reqSnap?.exists ? reqSnap.data() : null,
    siblings,
    agencyRef, agency: agencySnap?.exists ? agencySnap.data() : null,
  }
}

// The slice change, the budget move and the request's recomputed totals.
// money: { committed, disbursed } deltas in pesos.
function writeSliceChange(tx, c, patch, money, deps) {
  tx.update(c.sliceRef, { ...patch, updatedAt: deps.serverTimestamp() })
  const move = {}
  if (money?.committed) move['budget.committed'] = deps.increment(money.committed)
  if (money?.disbursed) move['budget.disbursed'] = deps.increment(money.disbursed)
  if (c.agency && Object.keys(move).length) tx.update(c.agencyRef, move)
  if (c.request) {
    const after = c.siblings.map((s) => (s.id === c.sliceRef.id ? { ...s, ...patch } : s))
    const next = deriveRequestFinancials(after, Number(c.request.amountNeeded) || 0)
    tx.update(c.reqRef, {
      amountCommitted: next.amountCommitted,
      openLetters: next.openLetters,
      status: syncedRequestStatus(c.request.status, next.status),
      updatedAt: deps.serverTimestamp(),
    })
  }
}

// Expire one letter (a person or the sweep). Returns the amount released,
// or null when the letter is no longer open (someone settled it first).
async function expireLetterTx(tx, db, sliceRef, by, deps) {
  const first = await tx.get(sliceRef)
  if (!first.exists || first.data().glStatus !== 'issued') return null
  const c = await readSliceCase(tx, db, sliceRef)
  const amount = sliceApproved(c.slice)
  writeSliceChange(tx, c, { glStatus: 'expired', glExpiredAt: deps.serverTimestamp(), glExpiredBy: by }, { committed: -amount }, deps)
  return { amount, agencyFound: !!c.agency }
}

// A slot taken today goes back to the hospital it came from (N1: the server's
// Manila date, and only if that count was not reset since). Slots are daily
// capacity: one from an earlier day has already refilled.
function giveSlotBackTx(tx, c, now) {
  const s = c.slice
  const today = manilaDayKey(now)
  const at = tsMillis(s.endorsedAt ?? s.submittedAt)
  if (!c.agency || at == null || manilaDayKey(at) !== today) return
  const t = tenantOf(s)
  const own = c.agency.hospitalSlots?.[t]
  if (own && own.lastResetDate === today) {
    tx.update(c.agencyRef, { [`hospitalSlots.${t}.remaining`]: Math.min((Number(own.remaining) || 0) + 1, Number(own.total) || 0) })
  } else if (!own && c.agency.lastResetDate === today) {
    tx.update(c.agencyRef, { 'slots.remaining': Math.min((Number(c.agency.slots?.remaining) || 0) + 1, Number(c.agency.slots?.total) || 0) })
  }
}

// Phase 4 PR 4.1: an open slice ended by the system (not accepted in time, the
// partnership ended, the agency unavailable), with the same money, slot,
// request-total and audit handling as a person's action. `from` lists the
// statuses it may close from; a slice that moved on meanwhile is left alone
// (returns null).
async function closeSliceCore({ db, sliceRef, from, reason, closedAs, actor, auditAction, patient = null, hospital = null, overrides = {} }) {
  const deps = { ...defaultDeps, ...overrides }
  const now = deps.now()
  const c = await db.runTransaction(async (tx) => {
    const cc = await readSliceCase(tx, db, sliceRef)
    if (!from.includes(cc.slice.status)) return null
    writeSliceChange(tx, cc, {
      status: 'closed', closedReason: reason, closedAs, closedAt: deps.serverTimestamp(),
      closedBy: actor.system ? `system:${actor.system}` : actor.uid,
    }, null, deps)
    giveSlotBackTx(tx, cc, now)
    return cc
  })
  if (!c) return null
  await afterChange(db, actor, c.slice, sliceRef.id, { action: auditAction, details: `${c.slice.agencyName ?? 'Agency'}: ${c.slice.status} → closed · ${reason}`, patient, hospital })
  return { slice: c.slice }
}

async function loadAgencyCaller(db, callerUid) {
  const caller = await loadCaller(db, callerUid)
  if (!AGENCY_ROLES.includes(caller.role) || !caller.agencyId) fail('permission-denied', "Only the agency's staff can do this.")
  return caller
}

const sliceRefOf = (db, sliceId) => {
  if (typeof sliceId !== 'string' || !sliceId) fail('invalid-argument', 'An application is required.')
  return db.doc(`applications/${sliceId}`)
}

function assertOwnSlice(c, caller) {
  if (c.slice.agencyId !== caller.agencyId) fail('permission-denied', 'This application belongs to another agency.')
}

// After the commit (best-effort): the record and who to tell.
async function afterChange(db, caller, slice, sliceId, { action, details, patient, hospital, watchers }) {
  await writeAudit(db, caller, {
    action, targetType: 'application', targetId: sliceId, targetName: slice.patientName ?? '',
    details, requestId: slice.requestId ?? null, patientId: slice.patientId ?? null, tenantId: tenantOf(slice),
  }).catch((err) => logger.warn('[sliceActions] audit failed', { err: err?.message }))
  const sends = []
  // A system actor (the case timers) sends as a server event.
  const fromUid = caller.system ? null : caller.uid
  if (patient) sends.push(notifyServer(db, slice.patientId, patient, fromUid))
  if (hospital && slice.endorsedById) sends.push(notifyServer(db, slice.endorsedById, hospital, fromUid))
  for (const uid of watchers?.uids ?? []) {
    if (uid !== caller.uid && uid !== slice.endorsedById) sends.push(notifyServer(db, uid, watchers.note, fromUid))
  }
  await Promise.allSettled(sends)
}

// ── decideSlice ────────────────────────────────────────────────────────────

const ACTIONS = ['request_info', 'resume', 'approve', 'reject']

async function handleDecideSlice({ callerUid, data, db, ...overrides }) {
  const deps = { ...defaultDeps, ...overrides }
  const caller = await loadAgencyCaller(db, callerUid)
  const action = data?.action
  if (!ACTIONS.includes(action)) fail('invalid-argument', 'Unknown action.')
  const sliceRef = sliceRefOf(db, data?.sliceId)
  const now = deps.now()

  const input = {
    message: text(data?.message, 500),
    reason: text(data?.reason, 500),
    amount: Number(data?.amount),
    purposes: Array.isArray(data?.purposeOfAssistance) ? data.purposeOfAssistance.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim().slice(0, 100)).slice(0, 20) : [],
    payableTo: text(data?.payableTo, 200),
    overrideReason: text(data?.repeatOverrideReason, 500),
  }

  const out = await db.runTransaction(async (tx) => {
    const c = await readSliceCase(tx, db, sliceRef)
    assertOwnSlice(c, caller)
    const s = c.slice
    if (s.status === 'closed') fail('failed-precondition', 'The hospital closed this application.')

    if (action === 'request_info') {
      if (!['reviewing', 'awaiting_info'].includes(s.status)) fail('failed-precondition', 'You can ask for more information only while reviewing.')
      if (!input.message) fail('invalid-argument', 'Say what the patient needs to send.')
      writeSliceChange(tx, c, {
        status: 'awaiting_info', awaitingInfoMessage: input.message,
        awaitingInfoRequestedAt: deps.serverTimestamp(), awaitingInfoRequestedBy: caller.name ?? '',
      }, null, deps)
      return { c, from: s.status, to: 'awaiting_info' }
    }

    if (action === 'resume') {
      if (s.status !== 'awaiting_info') fail('failed-precondition', 'This application is not waiting on the patient.')
      writeSliceChange(tx, c, {
        status: 'reviewing', awaitingInfoMessage: null, awaitingInfoRequestedAt: null,
        awaitingInfoRequestedBy: null, awaitingInfoResumedAt: deps.serverTimestamp(),
      }, null, deps)
      return { c, from: s.status, to: 'reviewing' }
    }

    if (action === 'reject') {
      if (!['reviewing', 'awaiting_info'].includes(s.status)) fail('failed-precondition', 'Only an application under review can be rejected.')
      if (!input.reason) fail('invalid-argument', 'Give the reason for rejecting.')
      writeSliceChange(tx, c, { status: 'rejected', rejectionReason: input.reason, rejectedAt: deps.serverTimestamp(), rejectedByUid: caller.uid }, null, deps)
      giveSlotBackTx(tx, c, now)
      return { c, from: s.status, to: 'rejected' }
    }

    // approve
    if (s.status !== 'reviewing') fail('failed-precondition', 'Only an application under review can be approved (it may have been approved already).')
    if (!c.request) fail('failed-precondition', 'This application is not linked to a request and cannot be approved.')
    if (isRequestClosed(c.request.status)) fail('failed-precondition', 'The hospital has closed this request — it can no longer be approved.')
    if (!c.agency) fail('not-found', 'Your agency record is missing.')
    if (c.agency.enabled === false) fail('failed-precondition', 'Your agency is disabled and cannot approve.')
    if (!partnersOf(c.agency).includes(tenantOf(s))) fail('failed-precondition', 'Your agency no longer partners with this hospital.')

    const amount = input.amount
    if (!Number.isFinite(amount) || amount <= 0) fail('invalid-argument', 'Enter an amount greater than 0.')
    if (!input.purposes.length) fail('invalid-argument', 'Select at least one purpose of assistance.')
    if (!input.payableTo) fail('invalid-argument', 'Name the provider the letter is payable to.')
    const endorsed = Number(s.amountRequested) || 0
    if (endorsed > 0 && amount > endorsed) fail('failed-precondition', `The hospital endorsed ${peso(endorsed)}; approve at most that.`)
    const maxPer = Number(c.agency.maxPerApplicant) || 0
    if (maxPer > 0 && amount > maxPer) fail('failed-precondition', `Your agency's maximum per approval is ${peso(maxPer)}.`)
    const allocated = Number(c.agency.budget?.allocated) || 0
    if (allocated > 0) {
      const left = Math.max(0, allocated - (Number(c.agency.budget?.committed) || 0))
      if (amount > left) fail('failed-precondition', `Only ${peso(left)} of your budget is left (another approval may have just landed).`)
    }
    const need = Number(c.request.amountNeeded) || 0
    if (c.request.careSetting === 'outpatient') {
      const others = computeFunding(need, c.siblings.filter((x) => x.id !== sliceRef.id)).committed
      if (amount > need - others) fail('failed-precondition', `This outpatient charge is ${peso(need)} and other agencies already cover ${peso(others)}. Approve at most ${peso(Math.max(0, need - others))}.`)
    }

    const markRef = db.doc(`approvalMarks/${s.agencyId}__${s.patientId}`)
    const markSnap = await tx.get(markRef)
    const mark = markSnap.exists ? markSnap.data() : null
    const type = c.request.assistanceType ?? ''
    const block = approvalCooldownBlock(mark, s.requestId, now, repeatLimitOf(c.agency), type)
    if (block && input.overrideReason.length < OVERRIDE_REASON_MIN) {
      fail('failed-precondition', `Your agency approved ${block.type ? `${block.type} ` : ''}assistance for this patient ${block.daysAgo} day${block.daysAgo === 1 ? '' : 's'} ago, on another request (your limit is ${block.days} days). Give a reason of at least ${OVERRIDE_REASON_MIN} characters to approve anyway.`)
    }

    writeSliceChange(tx, c, {
      status: 'approved',
      amountApproved: amount,
      purposeOfAssistance: input.purposes,
      payableTo: input.payableTo,
      approvedBy: caller.name ?? '',
      approvedByUid: caller.uid,
      approvedAt: deps.serverTimestamp(),
      glStatus: 'issued',
      // Valid 10 days from approval (owner decision 2026-11-16).
      glExpiresAt: deps.fromMillis(glExpiresAtFor(now)),
      glRedeemedAt: null,
      redeemedAmount: null,
      glExpiredAt: null,
      glExpiredBy: null,
      repeatOverride: block ? { reason: input.overrideReason, byUid: caller.uid, byName: caller.name ?? '', at: deps.serverTimestamp() } : null,
    }, { committed: amount }, deps)
    tx.set(markRef, {
      agencyId: s.agencyId, patientId: s.patientId, requestId: s.requestId, sliceId: sliceRef.id,
      lastApprovedAt: deps.serverTimestamp(),
      ...(type || mark?.byType ? {
        byType: { ...(mark?.byType ?? {}), ...(type ? { [type]: { at: deps.serverTimestamp(), requestId: s.requestId } } : {}) },
      } : {}),
    })
    return { c, from: s.status, to: 'approved', amount, block }
  })

  const s = out.c.slice
  const agencyName = s.agencyName ?? 'The agency'
  if (action === 'approve') {
    const partial = out.amount < (Number(s.amountRequested) || 0)
    await afterChange(db, caller, s, sliceRef.id, {
      action: 'app_approved',
      details: `${agencyName} approved ${peso(out.amount)} (${input.purposes.join(', ')})${out.block ? ` · inside the repeat limit: ${input.overrideReason}` : ''}`,
      patient: { type: 'interview_approved', title: 'Application approved', body: `Your application to ${agencyName} is approved for ${peso(out.amount)} (${input.purposes.join(', ')}). A Guarantee Letter will be issued shortly.` },
      hospital: {
        type: 'app_advanced', title: `${agencyName} approved ${s.patientName ?? 'the patient'}'s slice`,
        body: partial
          ? `Approved ${peso(out.amount)} (less than the ${peso(s.amountRequested)} endorsed). You may need to top up coverage from another agency.`
          : `Approved the full endorsed ${peso(out.amount)}. Guarantee Letter pending issuance.`,
      },
      watchers: {
        uids: out.c.request?.watchers ?? [],
        note: { type: 'app_advanced', title: 'Sibling agency approved on a shared case', body: `${agencyName} approved ${peso(out.amount)} for ${s.patientName ?? 'the patient'}. Open the case to see updated coverage.` },
      },
    })
    return { status: 'approved' }
  }

  const transition = `${agencyName}: ${out.from} → ${out.to}`
  if (action === 'reject') {
    await afterChange(db, caller, s, sliceRef.id, {
      action: 'slice_advanced', details: `${transition} · ${input.reason}`,
      patient: { type: 'doc_rejected', title: 'Application rejected', body: `Your application to ${agencyName} was not approved. Reason: ${input.reason}.` },
      hospital: { type: 'app_advanced', title: `${agencyName} rejected ${s.patientName ?? 'the patient'}'s slice`, body: `Reason: ${input.reason}. Re-endorse to another agency to cover the balance.` },
      watchers: {
        uids: out.c.request?.watchers ?? [],
        note: { type: 'app_advanced', title: 'Sibling agency rejected on a shared case', body: `${agencyName} rejected ${s.patientName ?? 'the patient'}'s slice. The hospital may endorse to another agency.` },
      },
    })
  } else if (action === 'request_info') {
    await afterChange(db, caller, s, sliceRef.id, {
      action: 'slice_advanced', details: transition,
      patient: { type: 'awaiting_info_requested', title: 'Information requested by your agency', body: `${agencyName} is asking you to: ${input.message}` },
      hospital: { type: 'app_advanced', title: `${agencyName} requested more info from the patient`, body: `${s.patientName ?? 'The patient'}'s endorsed slice paused — agency needs: "${input.message}".` },
    })
  } else {
    await afterChange(db, caller, s, sliceRef.id, { action: 'slice_advanced', details: transition })
  }
  return { status: out.to }
}

// ── settleLetter ───────────────────────────────────────────────────────────

const LETTER_ACTIONS = ['mark_issued', 'redeem', 'undo_redeem', 'expire', 'reverse']
const isApprovedStatus = (st) => ['approved', 'certificate'].includes(st)

async function handleSettleLetter({ callerUid, data, db, ...overrides }) {
  const deps = { ...defaultDeps, ...overrides }
  const caller = await loadAgencyCaller(db, callerUid)
  const action = data?.action
  if (!LETTER_ACTIONS.includes(action)) fail('invalid-argument', 'Unknown action.')
  const sliceRef = sliceRefOf(db, data?.sliceId)
  const now = deps.now()

  const out = await db.runTransaction(async (tx) => {
    // Ownership first, then the action's own re-read.
    const c = await readSliceCase(tx, db, sliceRef)
    assertOwnSlice(c, caller)
    const s = c.slice
    const amount = sliceApproved(s)
    if (!isApprovedStatus(s.status)) fail('failed-precondition', 'This application has no approved letter.')
    const expiry = glExpiryMs(s)
    const pastExpiry = expiry != null && now >= expiry

    if (action === 'mark_issued') {
      if (s.status !== 'approved' || s.glStatus !== 'issued') fail('failed-precondition', 'This letter was already issued or is no longer valid.')
      writeSliceChange(tx, c, { status: 'certificate', glIssuedAt: deps.serverTimestamp() }, null, deps)
      return { c, amount }
    }

    if (action === 'redeem') {
      if (s.glStatus !== 'issued') fail('failed-precondition', 'This letter is no longer open (it was settled or expired).')
      if (pastExpiry) fail('failed-precondition', 'This letter has expired. Mark it expired instead.')
      const actual = Number(data?.redeemedAmount)
      if (!Number.isFinite(actual) || actual < 0 || actual > amount) fail('invalid-argument', `Enter the amount billed, from ₱0 up to the approved ${peso(amount)}.`)
      writeSliceChange(tx, c, {
        glStatus: 'redeemed', glRedeemedAt: deps.serverTimestamp(), redeemedAmount: actual,
        // A letter used before the agency clicked Mark as Issued was issued.
        ...(s.status === 'approved' ? { status: 'certificate' } : {}),
      }, { committed: -amount, disbursed: actual }, deps)
      return { c, amount, actual }
    }

    if (action === 'undo_redeem') {
      if (s.glStatus !== 'redeemed') fail('failed-precondition', 'This letter is not marked redeemed.')
      // Letters redeemed before Phase 1 have no redeemedAmount: settled in full.
      const actual = s.redeemedAmount != null ? Number(s.redeemedAmount) || 0 : amount
      writeSliceChange(tx, c, { glStatus: 'issued', glRedeemedAt: null, redeemedAmount: null }, { committed: amount, disbursed: -actual }, deps)
      return { c, amount, actual }
    }

    if (action === 'expire') {
      if (s.glStatus !== 'issued') fail('failed-precondition', 'This letter is no longer open (it was settled or expired).')
      if (!pastExpiry) fail('failed-precondition', 'This letter is still valid. Reverse the approval to withdraw it.')
      await expireLetterTx(tx, db, sliceRef, caller.uid, deps)
      return { c, amount }
    }

    // reverse: back to review, the letter withdrawn. The repeat-limit mark
    // stays, so the clock keeps running from the original approval.
    if (s.glStatus !== 'issued') fail('failed-precondition', 'Only an open letter can be reversed (not one redeemed or expired).')
    writeSliceChange(tx, c, {
      status: 'reviewing', approvedAt: null, glStatus: null, glExpiresAt: null, glRedeemedAt: null,
      // Kept so the Funds ledger still shows when the reversed approval was made.
      reversedApprovalAt: s.approvedAt ?? null,
      reversedAt: deps.serverTimestamp(), reversedBy: caller.name ?? '', reversedByUid: caller.uid,
    }, { committed: -amount }, deps)
    return { c, amount }
  })

  const s = out.c.slice
  const agencyName = s.agencyName ?? 'The agency'
  if (action === 'mark_issued') {
    await afterChange(db, caller, s, sliceRef.id, {
      action: 'gl_issued', details: `${agencyName} issued the Guarantee Letter for ${peso(out.amount)}`,
      patient: { type: 'certificate_ready', title: 'Your Guarantee Letter has been issued', body: `Your Guarantee Letter for ${peso(out.amount)} from ${agencyName} has been issued. ${agencyName} is preparing the signed copy — you'll be notified when it's ready to download.` },
    })
  } else if (action === 'redeem') {
    await afterChange(db, caller, s, sliceRef.id, {
      action: 'gl_redeemed',
      details: `${peso(out.actual)} of ${peso(out.amount)} billed by ${s.payableTo ?? 'the provider'}${out.actual < out.amount ? ` · ${peso(out.amount - out.actual)} returned to budget` : ''}`,
    })
  } else if (action === 'undo_redeem') {
    await afterChange(db, caller, s, sliceRef.id, { action: 'gl_unmark_redeemed', details: `${peso(out.amount)} returned to committed (redemption reversed)` })
  } else if (action === 'expire') {
    await afterChange(db, caller, s, sliceRef.id, { action: 'gl_expired', details: `${peso(out.amount)} released back to budget` })
  } else {
    await afterChange(db, caller, s, sliceRef.id, {
      action: 'approval_reversed', details: `${peso(out.amount)} released; the repeat limit still runs from the original approval.`,
      patient: { type: 'app_advanced', title: 'Approval reversed', body: `Your approved application to ${agencyName} has been returned to review. The agency may contact you with details.` },
      hospital: { type: 'app_advanced', title: `${agencyName} reversed an approval`, body: `${s.patientName ?? 'The patient'}'s slice is back to review. The previously-secured amount is no longer guaranteed.` },
    })
  }
  return { ok: true }
}

// ── Callables ──────────────────────────────────────────────────────────────

const wrap = (name, handler) => onCall({ region: 'asia-southeast1', timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  try {
    return await handler({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error(`[${name}] failed`, { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Nothing was changed; try again.')
  }
})

exports.handleDecideSlice = handleDecideSlice
exports.handleSettleLetter = handleSettleLetter
exports.expireLetterTx = expireLetterTx
exports.closeSliceCore = closeSliceCore
exports.readSliceCase = readSliceCase
exports.writeSliceChange = writeSliceChange
exports.decideSlice = wrap('decideSlice', handleDecideSlice)
exports.settleLetter = wrap('settleLetter', handleSettleLetter)
