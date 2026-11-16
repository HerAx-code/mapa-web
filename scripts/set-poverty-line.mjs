// Sets a hospital's DOH AO 2021-0044 poverty line (hospitalSettings), the same
// fields the Hospital Settings → Means test card writes. Merges; other settings
// are kept. Writes an audit entry for the hospital.
//
// Dry run by default; pass --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/set-poverty-line.mjs <hospitalId> <amount> <year> [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const [hospitalId, amountArg, yearArg] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const amount = Number(amountArg), year = Number(yearArg)
if (!hospitalId || !(amount > 0 && amount < 100000) || !Number.isInteger(year) || year < 2015) {
  console.error('Usage: node scripts/set-poverty-line.mjs <hospitalId> <amount per person per month> <PSA year> [--apply]')
  process.exit(1)
}

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const hospital = await db.doc(`hospitals/${hospitalId}`).get()
if (!hospital.exists) { console.error(`No hospital ${hospitalId}`); process.exit(1) }
const region = hospital.data().region ?? ''
const before = (await db.doc(`hospitalSettings/${hospitalId}`).get()).data() ?? null

if (APPLY) {
  await db.doc(`hospitalSettings/${hospitalId}`).set({
    tenantId: hospitalId, povertyLinePerCapita: amount, povertyLineYear: year, region,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: 'Setup script',
  }, { merge: true })
  await db.collection('auditLog').add({
    action: 'means_test_line_updated', actorId: 'system', actorName: 'System (setup)', actorRole: 'system',
    targetType: 'hospital', targetId: hospitalId, targetName: hospital.data().facilityName ?? hospitalId,
    details: `Poverty line ₱${amount.toLocaleString()} per person per month (PSA ${year}${region ? `, ${region}` : ''})`,
    tenantId: hospitalId, createdAt: FieldValue.serverTimestamp(),
  })
}
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run', hospitalId, region,
  before: before ? { povertyLinePerCapita: before.povertyLinePerCapita ?? null, povertyLineYear: before.povertyLineYear ?? null } : null,
  after: { povertyLinePerCapita: amount, povertyLineYear: year },
}, null, 1))
