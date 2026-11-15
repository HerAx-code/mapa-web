// Marks the Valid ID and PhilHealth ID document types as reusable in
// documentTypes, matching src/data/referenceData.js (production had drifted:
// every type was "submit fresh each time", while the patient guide said a
// verified ID carries over). Reuse itself is limited to the hospital that
// verified the document and to verifications under 12 months old
// (src/utils/documentReuse.js).
//
// Dry run by default; pass --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/set-reusable-doc-types.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { DOCUMENT_TYPES } from '../src/data/referenceData.js'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const wantReusable = new Set(DOCUMENT_TYPES.filter(t => t.reusable).map(t => t.id))
const snap = await db.collection('documentTypes').get()
const changes = []
for (const d of snap.docs) {
  const want = wantReusable.has(d.id)
  if (!!d.data().reusable !== want) changes.push({ id: d.id, from: !!d.data().reusable, to: want })
}
if (APPLY && changes.length) {
  const batch = db.batch()
  for (const c of changes) batch.update(db.collection('documentTypes').doc(c.id), { reusable: c.to })
  await batch.commit()
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', changes }, null, 1))
