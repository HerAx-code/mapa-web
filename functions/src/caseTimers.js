const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')
const { notifyServer } = require('./serverWrites')
const { closeCaseCore, systemActor } = require('./caseActions')
const { closeSliceCore } = require('./sliceActions')
const { caseTimerDays, computeFunding, isRequestClosed } = require('./generated/shared.cjs')

/**
 * caseTimers — Phase 4 PR 4.2 (docs/phase4-case-endings-plan.md). Daily at
 * 06:00 Manila. The hospital (or the patient, for their own step) acts first;
 * these steps only stop a case being forgotten. Each is idempotent (its own
 * marker), and every close goes through the same core as a person's, which
 * re-reads inside its transaction and leaves anything that moved on.
 *
 *   1. Slices not proceeded (P4-B): remind the patient at 24 h and 48 h
 *      (`proceedReminders`); close at the hospital's limit as "Not accepted".
 *   2. Needs info (P4-E): remind the patient at 3 days, tell the agency at 7
 *      (`infoReminders`). Never closes — that stays the agency's decision.
 *   3. Nothing pending (P4-A): warn the hospital a day before
 *      (`closingWarnedAt`); close at the limit as "partially funded" or
 *      "no agency could fund", and tell the patient they can file again.
 *   4. Held at a disabled agency (P4-D): an open slice at an agency disabled
 *      for longer than the hospital's nothing-pending limit closes as
 *      "Agency unavailable" (`agencies.disabledAt`, stamped by onAgencyWritten).
 */

const HOUR = 3600000
const DAY = 24 * HOUR
const OPEN = ['endorsed', 'reviewing', 'awaiting_info']
const tenantOf = (d) => d?.tenantId || DEFAULT_HOSPITAL_ID
const millis = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : typeof ts?.seconds === 'number' ? ts.seconds * 1000 : null)

async function handleCaseTimers({ db, nowMs = Date.now(), serverTimestamp = () => FieldValue.serverTimestamp(), sliceOverrides = {} }) {
  const settingsCache = new Map()
  const settingsOf = async (t) => {
    if (!settingsCache.has(t)) {
      const s = await db.doc(`hospitalSettings/${t}`).get()
      settingsCache.set(t, s.exists ? s.data() : {})
    }
    return settingsCache.get(t)
  }
  const result = { proceedReminded: 0, notAccepted: 0, infoReminded: 0, infoAgencyTold: 0, warned: 0, autoClosed: 0, agencyUnavailable: 0, failed: 0 }
  const guarded = async (label, fn) => {
    try { await fn() } catch (err) { result.failed++; logger.error(`[caseTimers] ${label} failed`, { err: err?.message }) }
  }
  const sliceDeps = { now: () => nowMs, serverTimestamp, ...sliceOverrides }

  // 1. Slices the patient never proceeded on.
  const endorsed = await db.collection('applications').where('status', '==', 'endorsed').get()
  for (const d of endorsed.docs) {
    await guarded(`proceed ${d.id}`, async () => {
      const s = d.data()
      const at = millis(s.endorsedAt ?? s.submittedAt)
      if (at == null) return
      const age = nowMs - at
      const limitDays = caseTimerDays(await settingsOf(tenantOf(s)), 'sliceProceedDays')
      if (age >= limitDays * DAY) {
        const out = await closeSliceCore({
          db, sliceRef: d.ref, from: ['endorsed'], closedAs: 'not_accepted',
          reason: `Not accepted by the patient within ${limitDays} day${limitDays === 1 ? '' : 's'}.`,
          actor: systemActor('slice_not_accepted', tenantOf(s)), auditAction: 'slice_not_accepted',
          patient: { type: 'app_advanced', title: 'Endorsement closed', body: `You didn't accept the endorsement to ${s.agencyName ?? 'the agency'} within ${limitDays} days, so it was closed. The hospital may endorse your request to another agency.` },
          hospital: { type: 'app_advanced', title: `${s.patientName ?? 'A patient'} didn't accept an endorsement`, body: `The endorsement to ${s.agencyName ?? 'the agency'} closed after ${limitDays} days without the patient's acceptance.` },
          overrides: sliceDeps,
        })
        if (out) result.notAccepted++
        return
      }
      const due = age >= 48 * HOUR ? 2 : age >= 24 * HOUR ? 1 : 0
      if (due > (Number(s.proceedReminders) || 0)) {
        await notifyServer(db, s.patientId, {
          type: 'app_advanced', title: 'Please review your coverage plan',
          body: `${s.agencyName ?? 'An agency'} is ready to consider your request once you accept the endorsement. Open your coverage plan and tap Proceed. It closes after ${limitDays} days if not accepted.`,
        })
        await d.ref.update({ proceedReminders: due })
        result.proceedReminded++
      }
    })
  }

  // 2. "Needs info" the patient hasn't answered. Never closed here.
  const waiting = await db.collection('applications').where('status', '==', 'awaiting_info').get()
  for (const d of waiting.docs) {
    await guarded(`info ${d.id}`, async () => {
      const s = d.data()
      const at = millis(s.awaitingInfoRequestedAt)
      if (at == null) return
      const age = nowMs - at
      const done = Number(s.infoReminders) || 0
      if (age >= 7 * DAY && done < 2) {
        const staff = await db.collection('users').where('agencyId', '==', s.agencyId).get()
        for (const u of staff.docs.filter((x) => ['agency', 'agency_admin'].includes(x.data().role))) {
          await notifyServer(db, u.id, {
            type: 'app_advanced', title: 'No reply to your request for information',
            body: `${s.patientName ?? 'The patient'} hasn't answered "${String(s.awaitingInfoMessage ?? '').slice(0, 120)}" in 7 days. Decide whether to keep waiting or to reject.`,
          })
        }
        await d.ref.update({ infoReminders: 2 })
        result.infoAgencyTold++
      } else if (age >= 3 * DAY && done < 1) {
        await notifyServer(db, s.patientId, {
          type: 'awaiting_info_requested', title: 'Your agency is still waiting for information',
          body: `${s.agencyName ?? 'Your agency'} asked you to: ${String(s.awaitingInfoMessage ?? '').slice(0, 300)}`,
        })
        await d.ref.update({ infoReminders: 1 })
        result.infoReminded++
      }
    })
  }

  // 3. Endorsed cases with nothing pending at any agency.
  const idle = await db.collection('requests').where('status', 'in', ['endorsed', 'partially_funded', 'under_review']).get()
  for (const d of idle.docs) {
    await guarded(`nothing-pending ${d.id}`, async () => {
      const r = d.data()
      const since = millis(r.nothingPendingSince)
      if (since == null || isRequestClosed(r.status)) return
      const t = tenantOf(r)
      const limitDays = caseTimerDays(await settingsOf(t), 'nothingPendingDays')
      const age = nowMs - since
      if (age >= limitDays * DAY) {
        const guard = (fresh, slices) => !!fresh.nothingPendingSince &&
          millis(fresh.nothingPendingSince) === since &&
          !slices.some((x) => OPEN.includes(x.status))
        const funded = computeFunding(r.amountNeeded, (await db.collection('applications').where('requestId', '==', d.id).get()).docs.map((x) => x.data())).committed > 0
        const out = await closeCaseCore({
          db, reqRef: d.ref, outcome: 'closed', guard,
          closedAs: funded ? 'partially_funded' : 'no_funding',
          reason: funded
            ? `Closed — partially funded. No agency was still deciding for ${limitDays} days.`
            : `Closed — no agency could fund this request within ${limitDays} days.`,
          closeNote: 'The case closed automatically.',
          patientNote: funded
            ? 'Your request closed with the assistance already approved. Any Guarantee Letter you received stays valid until its date.'
            : 'No agency could fund your request, so it was closed.',
          actor: systemActor('nothing_pending', t), auditAction: 'request_auto_closed',
          now: () => nowMs, serverTimestamp,
        })
        if (out) result.autoClosed++
        return
      }
      if (age >= (limitDays - 1) * DAY && !r.closingWarnedAt) {
        const staff = await db.collection('users').where('tenantId', '==', t).get()
        for (const u of staff.docs.filter((x) => ['super_admin', 'staff_admin'].includes(x.data().role))) {
          await notifyServer(db, u.id, {
            type: 'app_advanced', title: 'A case closes itself tomorrow',
            body: `No agency is still deciding on ${r.patientName ?? 'a patient'}'s request (${r.requestId ?? ''}). Endorse it to another agency or close it; otherwise it closes itself tomorrow.`,
          })
        }
        await d.ref.update({ closingWarnedAt: serverTimestamp() })
        result.warned++
      }
    })
  }

  // 4. Open slices held at an agency disabled for too long.
  const agencies = await db.collection('agencies').get()
  for (const a of agencies.docs.filter((x) => x.data().enabled === false && millis(x.data().disabledAt) != null)) {
    const disabledAt = millis(a.data().disabledAt)
    const held = (await db.collection('applications').where('agencyId', '==', a.id).get()).docs.filter((x) => OPEN.includes(x.data().status))
    for (const d of held) {
      await guarded(`agency-unavailable ${d.id}`, async () => {
        const s = d.data()
        const limitDays = caseTimerDays(await settingsOf(tenantOf(s)), 'nothingPendingDays')
        if (nowMs - disabledAt < limitDays * DAY) return
        const out = await closeSliceCore({
          db, sliceRef: d.ref, from: OPEN, closedAs: 'agency_unavailable',
          reason: `${a.data().name ?? 'The agency'} has been unavailable for more than ${limitDays} days.`,
          actor: systemActor('agency_unavailable', tenantOf(s)), auditAction: 'slice_agency_unavailable',
          patient: { type: 'app_advanced', title: 'Application closed — agency unavailable', body: `${a.data().name ?? 'The agency'} is unavailable, so your application to it was closed. The hospital may endorse your request to another agency.` },
          hospital: { type: 'app_advanced', title: `${a.data().name ?? 'An agency'} is unavailable`, body: `${s.patientName ?? 'A patient'}'s endorsement to ${a.data().name ?? 'the agency'} closed because the agency has been disabled for more than ${limitDays} days. Endorse to another agency.` },
          overrides: sliceDeps,
        })
        if (out) result.agencyUnavailable++
      })
    }
  }
  return result
}

exports.handleCaseTimers = handleCaseTimers

exports.caseTimers = onSchedule({
  schedule: '0 6 * * *',
  timeZone: 'Asia/Manila',
  region: 'asia-southeast1',
  timeoutSeconds: 540,
  memory: '256MiB',
  retryCount: 1,
}, async () => {
  const result = await handleCaseTimers({ db: getFirestore() })
  logger.info('[caseTimers] daily run', result)
})
