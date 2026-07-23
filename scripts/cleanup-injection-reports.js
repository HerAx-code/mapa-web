#!/usr/bin/env node
/**
 * cleanup-injection-reports.js
 *
 * Removes the forged `reports` documents planted during the same
 * 2026-06-01 incident that scripts/cleanup-injection-audit.js cleans out
 * of auditLog. Background:
 *
 *   - Pre-fix, the reports.create rule made every guarded field OPTIONAL
 *     (`!('x' in data) || <valid>`), so omitting a field skipped its
 *     validation entirely. A forged report needed only
 *     {category, reportedBy, description} to be accepted.
 *   - 6,481 such docs were written under a single uid
 *     (bD3m9zTt1GVWYEoJUBnCXwG18Gn1, since deleted from users). Contents
 *     are junk: category values truncated to "s"/"sys"/"system" and
 *     random-alphanumeric descriptions, 6,166 of them exact duplicates.
 *   - They stayed invisible for weeks because the admin Reports view
 *     filters on `status`, which the forged docs omit entirely.
 *   - Phase 1.3 tightened the rule (status == 'open' and
 *     createdAt == request.time are now required), so no new docs of this
 *     shape can be written. The existing ones need a server-side sweep.
 *
 * Signature used here -- a doc is a candidate when BOTH `status` and
 * `createdAt` are missing. Every legitimate write path sends both:
 *   src/components/ProfileModals.jsx  (patient report modal)
 *   src/pages/agency/Dashboard.jsx    (agency budget request)
 * so this cannot match a real report. `--strict` additionally requires
 * the reporter uid to no longer exist in users/, which is true of the
 * whole known incident set.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-injection-reports.js            # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-injection-reports.js --delete   # actually delete
 *
 *   ... --strict / --strict --delete                       # also require
 *                                                            a dangling
 *                                                            reportedBy
 *
 * ALWAYS run scripts/export-firestore.js first. Review the dry-run
 * output before passing --delete.
 *
 * Pattern mirrors scripts/cleanup-injection-audit.js and
 * scripts/cleanup-orphans.js.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DELETE = process.argv.includes('--delete')
const STRICT = process.argv.includes('--strict')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[cleanup-injection-reports] ${DELETE ? 'DELETE' : 'DRY-RUN'} mode` +
              `${STRICT ? ' (strict: reporter must no longer exist)' : ''}`)

  const snap = await db.collection('reports').get()
  console.log(`\nScanned ${snap.size} reports.`)

  // Cache user existence so we do one read per distinct reporter, not
  // one per report.
  const userExists = new Map()
  const checkUser = async (uid) => {
    if (!uid) return false
    if (!userExists.has(uid)) {
      userExists.set(uid, (await db.collection('users').doc(uid).get()).exists)
    }
    return userExists.get(uid)
  }

  const candidates = []
  for (const d of snap.docs) {
    const r = d.data()
    const reasons = []

    if (!('status' in r))    reasons.push("missing 'status'")
    if (!('createdAt' in r)) reasons.push("missing 'createdAt'")

    // Both must be absent -- a real report always carries both.
    if (reasons.length < 2) continue

    if (STRICT) {
      if (await checkUser(r.reportedBy)) continue
      reasons.push('reportedBy no longer exists in users/')
    }

    candidates.push({
      id: d.id,
      category: r.category ?? '(none)',
      reportedBy: r.reportedBy ?? '(none)',
      preview: String(r.description ?? '').slice(0, 60),
      reasons,
    })
  }

  console.log(`Candidates matching the forged-report signature: ${candidates.length}\n`)

  // Group the printout so 6k rows don't drown the operator -- show a
  // per-reporter tally plus a sample, not every single doc.
  const byReporter = {}
  for (const c of candidates) byReporter[c.reportedBy] = (byReporter[c.reportedBy] ?? 0) + 1
  console.log('By reporter uid:')
  for (const [uid, n] of Object.entries(byReporter).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${uid}  exists=${userExists.get(uid) ?? 'unchecked'}`)
  }

  console.log('\nSample (first 10):')
  candidates.slice(0, 10).forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.id}`)
    console.log(`      category:   ${c.category}`)
    console.log(`      reportedBy: ${c.reportedBy}`)
    console.log(`      preview:    ${c.preview}`)
    console.log(`      match:      ${c.reasons.join(', ')}`)
  })

  const survivors = snap.size - candidates.length
  console.log(`\nWould keep ${survivors} report(s).`)

  if (candidates.length === 0) {
    console.log('Nothing to delete. Exiting clean.')
    return
  }

  if (!DELETE) {
    console.log('\nDry-run only. Pass --delete to remove these reports.')
    console.log('Run scripts/export-firestore.js first if you have not already.')
    return
  }

  console.log(`\nDeleting ${candidates.length} reports...`)
  // Firestore batch limit is 500.
  for (let i = 0; i < candidates.length; i += 500) {
    const batch = db.batch()
    candidates.slice(i, i + 500).forEach(c =>
      batch.delete(db.collection('reports').doc(c.id))
    )
    await batch.commit()
    console.log(`  committed ${Math.min(i + 500, candidates.length)}/${candidates.length}`)
  }
  console.log('Done.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
