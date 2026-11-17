// Switch funding agencies off (or on), as the Super Admin's Agencies-page
// toggle does: agencies/{id}.enabled, the public projection (agenciesPublic,
// also kept in sync by the onAgencyWritten function), an in-app notice to the
// agency's coordinators, and an audit entry. Open cases are untouched: an
// approved letter stays valid and the agency can still record its use.
//
// Used 2026-11-17 to switch off the political-office funders
// (reports/Legislator funders and anti epal rule.md).
//
// Dry run by default; --apply to write. --on switches them back on.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/set-agency-enabled.mjs <agencyId> [<agencyId>…] [--reason="…"] [--on] [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const ENABLE = process.argv.includes('--on')
const reason = process.argv.find(a => a.startsWith('--reason='))?.slice(9) ?? ''
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!ids.length) { console.error('Usage: node scripts/set-agency-enabled.mjs <agencyId>… [--reason="…"] [--on] [--apply]'); process.exit(1) }

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const out = []
for (const id of ids) {
  const ref = db.doc(`agencies/${id}`)
  const snap = await ref.get()
  if (!snap.exists) { out.push({ id, error: 'not found' }); continue }
  const a = snap.data()
  const open = (await db.collection('applications').where('agencyId', '==', id).get()).docs
    .filter(d => ['endorsed', 'reviewing', 'awaiting_info'].includes(d.data().status) || d.data().glStatus === 'issued').length
  out.push({ id, name: a.name, enabledBefore: a.enabled !== false, enabledAfter: ENABLE, openCases: open })
  if (!APPLY || (a.enabled !== false) === ENABLE) continue
  await ref.update({ enabled: ENABLE, updatedAt: FieldValue.serverTimestamp() })
  await db.doc(`agenciesPublic/${id}`).set({ enabled: ENABLE, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  const coords = await db.collection('users').where('agencyId', '==', id).where('role', '==', 'agency').get()
  for (const u of coords.docs) {
    await db.collection('notifications').doc(u.id).collection('items').add({
      type: ENABLE ? 'agency_enabled' : 'agency_disabled',
      title: ENABLE ? 'Agency Enabled' : 'Agency Disabled',
      body: ENABLE
        ? `${a.name} has been re-enabled. You are now accepting patient applications.`
        : `${a.name} has been disabled. Hospitals can no longer endorse new requests to it; approved letters stay valid and can still be marked used.`,
      read: false, createdAt: FieldValue.serverTimestamp(), fromUid: null,
    })
  }
  await db.collection('auditLog').add({
    action: ENABLE ? 'agency_enabled' : 'agency_disabled', actorId: 'system', actorName: 'System (Super Admin script)', actorRole: 'system',
    targetType: 'agency', targetId: id, targetName: a.name ?? id,
    details: `Agency ${ENABLE ? 're-enabled' : 'disabled'}${reason ? ` · reason: ${reason}` : ''}`,
    createdAt: FieldValue.serverTimestamp(),
  })
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', reason, agencies: out }, null, 1))
