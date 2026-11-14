const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')

/**
 * onAuditLogCreated — multi-hospital Phase 9 (docs/multi-hospital-network-plan.md).
 *
 * Agency users are network-level, so the audit entries they write carry no
 * tenantId (the client can't know the case's hospital without a read, and the
 * rules only let a TAGGED entry carry the writer's own hospital). With tenant
 * scoping on, those entries vanished from the hospital's Audit Log page —
 * a gateway couldn't see that an agency approved, expired or redeemed a GL on
 * one of its cases. This trigger stamps the CASE's hospital onto them:
 *   - entry.requestId → requests/{id}.tenantId
 *   - else a targetType 'application' entry → applications/{targetId}.tenantId
 * Entries with no case (agency budget/team/promotion actions, platform-admin
 * network actions) stay untagged: they belong to no hospital.
 *
 * Admin SDK write (rules-bypassing); clients can never update auditLog.
 * Testable-handler pattern (verifyAccessCode / syncRequestFinancials).
 */
async function caseTenant(db, entry) {
  if (entry.requestId) {
    const snap = await db.doc(`requests/${entry.requestId}`).get()
    if (snap.exists) return snap.data().tenantId || DEFAULT_HOSPITAL_ID
  }
  if (entry.targetType === 'application' && entry.targetId) {
    const snap = await db.doc(`applications/${entry.targetId}`).get()
    if (snap.exists) return snap.data().tenantId || DEFAULT_HOSPITAL_ID
  }
  return null
}

async function handleAuditLogCreated({ db, entry, ref }) {
  if (!entry) return { skipped: 'no-entry' }
  if (typeof entry.tenantId === 'string' && entry.tenantId) return { skipped: 'already-tagged' }
  const tenantId = await caseTenant(db, entry)
  if (!tenantId) return { skipped: 'no-case' }
  await ref.update({ tenantId })
  return { stamped: tenantId }
}

exports.handleAuditLogCreated = handleAuditLogCreated

exports.onAuditLogCreated = onDocumentCreated({
  document: 'auditLog/{logId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const snap = event.data
  if (!snap) return
  try {
    const result = await handleAuditLogCreated({ db: admin.firestore(), entry: snap.data(), ref: snap.ref })
    if (result.stamped) logger.info('[onAuditLogCreated] stamped case hospital', { logId: event.params.logId, ...result })
  } catch (err) {
    logger.error('[onAuditLogCreated] failed', { logId: event.params.logId, err: err.message })
  }
})
