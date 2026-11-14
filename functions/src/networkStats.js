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
 * Patient marketplace (docs/patient-marketplace-plan.md): a hospital's patients
 * are everyone who has filed with it (users.tenantIds). It also publishes, per
 * hospital, the TYPICAL TURNAROUND patients compare when choosing where to file
 * — the median days from filing to the first endorsement, over requests filed
 * in the last TURNAROUND_WINDOW_DAYS — to the world-readable
 * hospitalsPublicStats/{id}. A median of a count, never a single case: below
 * MIN_TURNAROUND_SAMPLE requests nothing is published.
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
const TURNAROUND_WINDOW_DAYS = 180
const MIN_TURNAROUND_SAMPLE  = 5
const DAY_MS = 86400000

const toMs = (v) => (v == null ? null
  : typeof v.toMillis === 'function' ? v.toMillis()
  : v instanceof Date ? v.getTime()
  : typeof v === 'number' ? v : null)

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Median days from filing to the first endorsement at one hospital, or null
// below the minimum sample. Reads only requestId/endorsedAt and submittedAt.
async function hospitalTurnaround({ db, tenantId, now }) {
  const since = now - TURNAROUND_WINDOW_DAYS * DAY_MS
  const firstEndorsed = new Map()
  const slices = await db.collection('applications').where('tenantId', '==', tenantId).select('requestId', 'endorsedAt').get()
  for (const d of slices.docs) {
    const { requestId, endorsedAt } = d.data()
    const t = toMs(endorsedAt)
    if (!requestId || t == null) continue
    if (!firstEndorsed.has(requestId) || t < firstEndorsed.get(requestId)) firstEndorsed.set(requestId, t)
  }
  const days = []
  const requests = await db.collection('requests').where('tenantId', '==', tenantId).select('submittedAt').get()
  for (const d of requests.docs) {
    const sub = toMs(d.data().submittedAt)
    const end = firstEndorsed.get(d.id)
    if (sub == null || end == null || end < sub || sub < since) continue
    days.push((end - sub) / DAY_MS)
  }
  return {
    turnaroundDays: days.length >= MIN_TURNAROUND_SAMPLE ? Math.round(median(days) * 10) / 10 : null,
    basedOn: days.length,
  }
}

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
    patients: await countOf(db.collection('users').where('tenantIds', 'array-contains', tenantId).where('role', '==', 'patient')),
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

// Per-hospital public turnaround: { [hospitalId]: { turnaroundDays, basedOn } }.
async function computePublicStats({ db, now = Date.now() }) {
  const hospitals = await db.collection('hospitals').get()
  const out = {}
  for (const h of hospitals.docs) out[h.id] = await hospitalTurnaround({ db, tenantId: h.id, now })
  return out
}

async function writeNetworkStats({ db, AggregateField, serverTimestamp, now = Date.now() }) {
  const stats = await computeNetworkStats({ db, AggregateField })
  await db.doc('networkStats/current').set({ ...stats, generatedAt: serverTimestamp() })
  const publicStats = await computePublicStats({ db, now })
  for (const [id, s] of Object.entries(publicStats)) {
    await db.doc(`hospitalsPublicStats/${id}`).set({ ...s, windowDays: TURNAROUND_WINDOW_DAYS, generatedAt: serverTimestamp() })
  }
  return { ...stats, publicStats }
}

module.exports = {
  REQUEST_GROUPS, MIN_TURNAROUND_SAMPLE, TURNAROUND_WINDOW_DAYS,
  computeNetworkStats, computePublicStats, writeNetworkStats, summarize,
}
