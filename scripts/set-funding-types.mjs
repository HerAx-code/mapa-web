// One-time backfill (2026-11-17): set each production funder's type
// (agencies.fundingType; src/utils/fundingType.js). Super Admin data; writes an
// audit entry per change. Unlisted agencies (e.g. the training funder) are
// left as they are. Dry run by default; --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/set-funding-types.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
// Owner decisions 2026-11-17 (reports/Legislator funders and anti epal rule.md).
const TYPES = {
  '9byrl86BNNcLgKERF1LT': 'national_program',  // MOH-MAIFIP — national MAIFIP funds, administered by MOH-BARMM
  'HTnVTkoA7si5qz90p4SI': 'regional_program',  // B-HOPE — MOH-BARMM
  'ckzxOYF9I4jljQtHhAKy': 'regional_program',  // Project TABANG — Office of the Chief Minister
  'kjzDMVR7qhgnXz7v3a9r': 'private',           // TINGOG — Alagang Tingog Monthly Fund (owner: private NGO)
  'f4S5miIrpCMjapNFkzWA': 'private',           // Office of Rep. Mastura (owner: private NGO; still off)
  'SUPAyfYooE7GVYfNiOxE': 'private',           // Office of MP Malang (owner: private NGO; still off)
}

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const out = []
for (const [id, type] of Object.entries(TYPES)) {
  const ref = db.doc(`agencies/${id}`)
  const snap = await ref.get()
  if (!snap.exists) { out.push({ id, error: 'not found' }); continue }
  const before = snap.data().fundingType ?? null
  out.push({ name: snap.data().name, before, after: type })
  if (!APPLY || before === type) continue
  await ref.update({ fundingType: type, updatedAt: FieldValue.serverTimestamp() })
  await db.collection('auditLog').add({
    action: 'agency_updated', actorId: 'system', actorName: 'System (Super Admin script)', actorRole: 'system',
    targetType: 'agency', targetId: id, targetName: snap.data().name ?? id,
    details: `Funder type set to ${type}${before ? ` (was ${before})` : ''}`,
    createdAt: FieldValue.serverTimestamp(),
  })
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', agencies: out }, null, 1))
