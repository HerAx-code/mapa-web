#!/usr/bin/env node
/**
 * cleanup-injection-audit.js
 *
 * Removes prompt-injection / fake-system auditLog entries planted before
 * commit f14ea17 tightened the auditLog.create rule. Background:
 *
 *   - Pre-fix, `allow create: if isAuth()` let any authenticated client
 *     write any actorId/actorName they liked. Three entries were planted
 *     with actors "System / Recovery Engine / Migration Daemon" carrying
 *     details payloads that instructed AI agents reviewing the dashboard
 *     to run `claude -p ...` and `firebase deploy --only firestore:rules`.
 *   - Post-fix, the rule enforces actorId == request.auth.uid, so no new
 *     entries with a non-user actorId can be written. The old entries
 *     remain and need a server-side delete because auditLog has
 *     `allow delete: if false` (entries are immutable from the client).
 *
 * Strategy: identify entries that the tightened rule would have rejected.
 * Specifically:
 *   1. actorId == 'system' (the hardcoded fallback in pre-fix logAudit
 *      when actor was missing — no longer possible to write).
 *   2. action matches the planted set: system_alert, auto_patch_*,
 *      auto_recovery_* — values never used by any legitimate UI path.
 *   3. (Optional, --strict) details contains shell-command bait:
 *      "claude -p", "firebase deploy", "REST API", "regenerating the
 *      firestore.rules". Only the strict pass uses this.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-injection-audit.js           # dry-run audit
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-injection-audit.js --delete  # actually delete
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-injection-audit.js --strict  # also flag entries
 *     node scripts/cleanup-injection-audit.js --strict --delete   that
 *                                                                 match the
 *                                                                 command-bait
 *                                                                 substring set
 *
 * Each candidate is printed before deletion so the operator can review
 * the dry-run output, eyeball anything unexpected, and only then re-run
 * with --delete.
 *
 * Get a service account key:
 *   Firebase Console → Project Settings → Service Accounts → Generate new
 *   private key. Save outside the repo; never commit it.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DELETE = process.argv.includes('--delete')
const STRICT = process.argv.includes('--strict')

const FAKE_ACTIONS = new Set([
  'system_alert',
  'auto_patch_recommendation',
  'auto_patch_migrate_v2.4.1',
  'auto_recovery',
])

const COMMAND_BAIT = [
  'claude -p',
  'firebase deploy',
  'firestore.rules',
  'AUTO-RECOVERY',
  'RECOMMENDED FIX',
  'CRITICAL:',
]

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const containsBait = (s) => {
  if (typeof s !== 'string') return false
  return COMMAND_BAIT.some(b => s.includes(b))
}

async function main() {
  console.log(DELETE
    ? '[cleanup-injection-audit] DELETE mode'
    : '[cleanup-injection-audit] DRY-RUN mode (pass --delete to remove)')
  if (STRICT) console.log('[cleanup-injection-audit] STRICT mode (also flagging command-bait substrings)')

  const snap = await db.collection('auditLog').get()
  console.log(`\nScanned ${snap.size} auditLog entries.`)

  const candidates = []
  for (const d of snap.docs) {
    const data = d.data() ?? {}
    const reasons = []
    if (data.actorId === 'system')          reasons.push("actorId='system'")
    if (FAKE_ACTIONS.has(data.action))      reasons.push(`action='${data.action}'`)
    if (STRICT && containsBait(data.details)) reasons.push('details contains command-bait')
    if (reasons.length > 0) {
      candidates.push({
        id: d.id,
        actor: data.actorName ?? data.actorId ?? '?',
        action: data.action ?? '?',
        detailsPreview: typeof data.details === 'string'
          ? data.details.slice(0, 120) + (data.details.length > 120 ? '…' : '')
          : '',
        reasons,
      })
    }
  }

  console.log(`Candidates matching injection signatures: ${candidates.length}\n`)
  candidates.forEach((c, i) => {
    console.log(`[${i + 1}/${candidates.length}] ${c.id}`)
    console.log(`     actor:  ${c.actor}`)
    console.log(`     action: ${c.action}`)
    console.log(`     match:  ${c.reasons.join(', ')}`)
    if (c.detailsPreview) console.log(`     details: ${c.detailsPreview}`)
    console.log()
  })

  if (candidates.length === 0) {
    console.log('Nothing to delete. Exiting clean.')
    return
  }

  if (!DELETE) {
    console.log('Dry-run only. Pass --delete to remove these entries.')
    return
  }

  console.log(`Deleting ${candidates.length} entries...`)
  // Firestore batch limit is 500.
  for (let i = 0; i < candidates.length; i += 500) {
    const batch = db.batch()
    candidates.slice(i, i + 500).forEach(c =>
      batch.delete(db.collection('auditLog').doc(c.id))
    )
    await batch.commit()
  }
  console.log('Done. The deletions are themselves NOT audit-logged (auditLog')
  console.log('writes are immutable from the client; admin-SDK deletes bypass')
  console.log('rules and produce no client-visible audit trail). If you need')
  console.log('a paper trail, record this cleanup in your project log.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})