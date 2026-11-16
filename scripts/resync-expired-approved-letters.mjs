// One-time fix (2026-11-16): letters that expired while their slice was still
// 'approved' (never marked Issued) kept counting as committed funding on the
// parent request — syncRequestFinancials only excluded expired letters at
// 'certificate'. After the functions deploy that fixes the trigger, --apply
// touches each such slice (updatedAt only) so the trigger recomputes its
// request. Read-only by default: lists the slices and, per request, the stored
// amountCommitted / status against what they should be.
//
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/resync-expired-approved-letters.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { deriveRequestFinancials } from '../src/utils/requests.js'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const stuck = (await db.collection('applications').where('glStatus', '==', 'expired').get())
  .docs.filter(d => d.data().status === 'approved')
const stillOpenAtApproved = (await db.collection('applications').where('glStatus', '==', 'issued').get())
  .docs.filter(d => d.data().status === 'approved').length

const requests = []
for (const requestId of [...new Set(stuck.map(d => d.data().requestId).filter(Boolean))]) {
  const req = await db.doc(`requests/${requestId}`).get()
  if (!req.exists) { requests.push({ requestId, missing: true }); continue }
  const slices = (await db.collection('applications').where('requestId', '==', requestId).get()).docs.map(d => d.data())
  const r = req.data()
  const should = deriveRequestFinancials(slices, Number(r.amountNeeded) || 0)
  requests.push({
    requestId, ref: r.requestId ?? '', status: r.status, amountCommitted: r.amountCommitted ?? 0,
    shouldBe: should, wrong: should.amountCommitted !== (r.amountCommitted ?? 0),
  })
}

if (APPLY) {
  for (const d of stuck) await d.ref.update({ updatedAt: FieldValue.serverTimestamp() })
}
console.log(JSON.stringify({
  mode: APPLY ? 'apply (touched slices; the trigger recomputes each request)' : 'dry-run',
  expiredAtApproved: stuck.map(d => ({ sliceId: d.id, agency: d.data().agencyName ?? d.data().agencyId, amount: d.data().amountApproved ?? d.data().approvedAmount ?? 0, requestId: d.data().requestId ?? null })),
  stillOpenAtApproved,
  requests,
}, null, 1))
