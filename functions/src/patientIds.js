const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore } = require('firebase-admin/firestore')

/**
 * assignPatientId — Phase 5 PR 5.2 (decision P5-A, gap N3).
 *
 * The patient display ID (PAT-000123) is printed and read out at the desk, so
 * it must be unique. Registration used the last six digits of the clock, which
 * repeat. Now the server assigns the next number from counters/patientIds in a
 * transaction, when a patient account is created; registration no longer sets
 * one (the rules refuse it).
 *
 * The first run seeds itself: with no counter yet, it starts one above the
 * highest PAT- number already in use, inside the same transaction, so
 * existing IDs (none repeat, checked 2026-11-22) are never reused.
 */

const COUNTER = 'counters/patientIds'
const RE = /^PAT-(\d+)$/
const format = (n) => `PAT-${String(n).padStart(6, '0')}`

async function highestInUse(tx, db) {
  const snap = await tx.get(db.collection('users').where('role', '==', 'patient'))
  let max = 0
  for (const d of snap.docs) {
    const m = RE.exec(d.data().patientId ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

async function handleAssignPatientId({ db, uid, user }) {
  if (user?.role !== 'patient') return { skipped: 'not-patient' }
  const userRef = db.doc(`users/${uid}`)
  const counterRef = db.doc(COUNTER)
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(userRef)
    if (!fresh.exists) return { skipped: 'gone' }
    if (fresh.data().patientId) return { skipped: 'has-id', patientId: fresh.data().patientId }
    const c = await tx.get(counterRef)
    const next = c.exists ? Number(c.data().next) || 1 : (await highestInUse(tx, db)) + 1
    tx.set(counterRef, { next: next + 1 }, { merge: true })
    tx.update(userRef, { patientId: format(next) })
    return { patientId: format(next) }
  })
}

exports.handleAssignPatientId = handleAssignPatientId
exports.formatPatientId = format

exports.assignPatientId = onDocumentCreated({
  document: 'users/{uid}', region: 'asia-southeast1', timeoutSeconds: 60, memory: '256MiB', retry: true,
}, async (event) => {
  try {
    const result = await handleAssignPatientId({ db: getFirestore(), uid: event.params.uid, user: event.data?.data() })
    if (result.patientId && !result.skipped) logger.info('[assignPatientId]', { uid: event.params.uid, ...result })
    return result
  } catch (err) {
    logger.error('[assignPatientId] failed', { uid: event.params.uid, err: err.message })
    throw err // retried: the account must get an ID
  }
})
