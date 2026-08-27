#!/usr/bin/env node
/**
 * migrate-philhealth-first.js
 *
 * Executes the data half of docs/philhealth-first-plan.md (Option 1):
 * PhilHealth becomes the first-charge coverage that REDUCES the bill, not an
 * endorsable GL-issuing agency.
 *
 * WHAT THIS DOES
 *
 *   1. BACKFILL requests: every request missing `totalBill` gets
 *        totalBill = amountNeeded, philhealthCovered = 0, otherCovered = 0
 *      This is NON-DESTRUCTIVE — amountNeeded is unchanged, so no funding
 *      figure or status moves. It just gives legacy requests the new fields so
 *      the bill -> coverage -> residual UI renders consistently.
 *
 *   2. DISABLE the `philhealth` agency (enabled:false + a description stating
 *      it models NHIF coverage, not a funder). Same mechanism as `malasakit`.
 *      The audit (2026-08-26) confirmed 0 philhealth slices and allocated:0,
 *      so this strands no money and orphans nothing.
 *
 *   3. DEACTIVATE the two philhealth Auth accounts
 *      (admin@ / coordinator@philhealth.gov.ph) so their logins can't sign in,
 *      matching the malasakit precedent and the Login demo-panel change.
 *
 * SAFETY
 *   - Dry-run by default. Pass --apply to write.
 *   - On --apply, writes a JSON backup of every touched doc + auth record to
 *     backups/<timestamp>/ FIRST.
 *   - Fully reversible: re-enable the agency + accounts, same as malasakit.
 *
 * USAGE
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/migrate-philhealth-first.js            # dry-run
 *   node scripts/migrate-philhealth-first.js --apply    # write
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { mkdirSync, writeFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const auth = getAuth()

const PH_EMAILS = ['admin@philhealth.gov.ph', 'coordinator@philhealth.gov.ph']
const tag = APPLY ? '✅ APPLIED' : '➕ WOULD'
const line = () => console.log('─'.repeat(64))

async function main() {
  line()
  console.log(`PHILHEALTH-FIRST MIGRATION — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`)
  line()

  const backup = { at: new Date().toISOString(), requests: [], agency: null, authUsers: [] }

  // ── 1. Backfill requests ──────────────────────────────────────────────
  const reqSnap = await db.collection('requests').get()
  const toBackfill = reqSnap.docs.filter(d => d.data().totalBill === undefined)
  console.log(`\n1) REQUESTS backfill: ${toBackfill.length} of ${reqSnap.size} need totalBill`)
  for (const d of toBackfill) {
    const r = d.data()
    const totalBill = Number(r.amountNeeded) || 0
    backup.requests.push({ id: d.id, before: { totalBill: r.totalBill ?? null, philhealthCovered: r.philhealthCovered ?? null, otherCovered: r.otherCovered ?? null, amountNeeded: r.amountNeeded ?? null } })
    console.log(`   ${tag} set requests/${d.id}  totalBill=${totalBill} philhealthCovered=0 otherCovered=0 (amountNeeded stays ${r.amountNeeded})`)
    if (APPLY) {
      await d.ref.update({ totalBill, philhealthCovered: 0, otherCovered: 0, updatedAt: FieldValue.serverTimestamp() })
    }
  }

  // ── 2. Disable philhealth agency ──────────────────────────────────────
  const agRef = db.collection('agencies').doc('philhealth')
  const agSnap = await agRef.get()
  console.log(`\n2) AGENCY philhealth:`)
  if (!agSnap.exists) {
    console.log('   (no philhealth agency doc — nothing to disable)')
  } else {
    const a = agSnap.data()
    backup.agency = { id: 'philhealth', before: { enabled: a.enabled ?? null, description: a.description ?? null } }
    console.log(`   ${tag} set agencies/philhealth  enabled: ${a.enabled} -> false`)
    if (APPLY) {
      await agRef.update({
        enabled: false,
        description: 'PhilHealth NHIF — modelled as the first-charge coverage that reduces the bill (Order of Charging, JAO 2020-0001), not an endorsable GL-issuing funder. Disabled as an agency; its coverage is captured on the request (philhealthCovered). See docs/philhealth-first-plan.md.',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  }

  // ── 3. Deactivate philhealth Auth accounts ────────────────────────────
  console.log(`\n3) AUTH accounts:`)
  for (const email of PH_EMAILS) {
    try {
      const u = await auth.getUserByEmail(email)
      backup.authUsers.push({ email, uid: u.uid, before: { disabled: u.disabled } })
      console.log(`   ${tag} disable ${email}  (uid=${u.uid}, disabled: ${u.disabled} -> true)`)
      if (APPLY) await auth.updateUser(u.uid, { disabled: true })
    } catch (e) {
      console.log(`   - ${email}  (not found: ${e.code || e.message})`)
    }
  }

  // ── Backup on apply ───────────────────────────────────────────────────
  if (APPLY) {
    const dir = `backups/${backup.at.replace(/[:.]/g, '-')}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/philhealth-first-backup.json`, JSON.stringify(backup, null, 2))
    console.log(`\nBackup written to ${dir}/philhealth-first-backup.json`)
  }

  line()
  console.log(APPLY ? 'MIGRATION APPLIED.' : 'DRY RUN COMPLETE — no data modified. Re-run with --apply to write.')
  line()
}

main().then(() => process.exit(0)).catch(e => { console.error('MIGRATION FAILED:', e); process.exit(1) })
