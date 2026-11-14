/**
 * networkStats — multi-hospital Phase 9 (docs/multi-hospital-network-plan.md).
 *
 * The platform admin (network operator) must see how the network is doing
 * without reading a single patient record — the rules deny it every hospital
 * collection, and Firestore count()/sum() queries need read access to what they
 * count. So the counts are computed here with the Admin SDK and saved as ONE
 * summary doc, networkStats/current, which only the platform admin may read.
 *
 * Counts and peso totals only — no names, ids or per-patient values. Records
 * without a tenantId (before the Phase 3 backfill) are not counted.
 *
 * PURE: no firebase-functions import, so the manual runner
 * (scripts/compute-network-stats.mjs) shares this exact code with the scheduled
 * function (refreshNetworkStats.js). Dependencies are passed in for testing.
 */

// Request statuses grouped the way the gateway reads its queue.
const REQUEST_GROUPS = {
  inReview: ['submitted', 'under_review', 'assessment'],
  inFunding: ['endorsed', 'partially_funded'],
  funded: ['fully_funded'],
  closed: ['closed', 'rejected'],
}
const APPROVED_SLICE = ['approved', 'certificate']

async function countOf(query) {
  const snap = await query.count().get()
  return snap.data().count ?? 0
}

async function hospitalStats({ db, AggregateField, tenantId }) {
  const inTenant = (col) => db.collection(col).where('tenantId', '==', tenantId)
  const requests = {}
  for (const [group, statuses] of Object.entries(REQUEST_GROUPS)) {
    requests[group] = await countOf(inTenant('requests').where('status', 'in', statuses))
  }
  // sum() needs the composite index applications (status, tenantId,
  // amountApproved) — in firestore.indexes.json; the emulator doesn't enforce it.
  const approved = await inTenant('applications')
    .where('status', 'in', APPROVED_SLICE)
    .aggregate({ count: AggregateField.count(), total: AggregateField.sum('amountApproved') })
    .get()
  return {
    patients: await countOf(inTenant('users').where('role', '==', 'patient')),
    requests,
    approvedSlices: approved.data().count ?? 0,
    amountApproved: approved.data().total ?? 0,
  }
}

// Network totals from the per-hospital rows.
function summarize(byHospital) {
  const totals = { patients: 0, approvedSlices: 0, amountApproved: 0, requests: {} }
  for (const g of Object.keys(REQUEST_GROUPS)) totals.requests[g] = 0
  for (const s of Object.values(byHospital)) {
    totals.patients += s.patients
    totals.approvedSlices += s.approvedSlices
    totals.amountApproved += s.amountApproved
    for (const g of Object.keys(REQUEST_GROUPS)) totals.requests[g] += s.requests[g] ?? 0
  }
  return totals
}

async function computeNetworkStats({ db, AggregateField }) {
  const hospitals = await db.collection('hospitals').get()
  const byHospital = {}
  for (const h of hospitals.docs) {
    byHospital[h.id] = await hospitalStats({ db, AggregateField, tenantId: h.id })
  }
  return { hospitals: byHospital, totals: summarize(byHospital) }
}

async function writeNetworkStats({ db, AggregateField, serverTimestamp }) {
  const stats = await computeNetworkStats({ db, AggregateField })
  await db.doc('networkStats/current').set({ ...stats, generatedAt: serverTimestamp() })
  return stats
}

module.exports = { REQUEST_GROUPS, computeNetworkStats, writeNetworkStats, summarize }
