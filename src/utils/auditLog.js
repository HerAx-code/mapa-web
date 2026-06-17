import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Write an entry to the auditLog collection.
 *
 * actorAgencyId is included so that an agency_admin can read their own
 * agency's slice without being able to see other agencies' entries. CRMC
 * admin entries have actorAgencyId = null.
 *
 * `requestId` and `patientId` are optional denormalised fields added
 * for the Activity Timeline pattern (§B.26): a co-funding agency can
 * subscribe to every audit entry on the parent request its slice
 * belongs to, and the patient can subscribe to every entry where their
 * own data was accessed (Estonia X-Road citizen-visible audit pattern).
 * Rules use these fields directly; entries without them are admin-only
 * as before.
 *
 * @param {object} actor - { uid, name, role, agencyId } of the user performing the action
 * @param {object} entry - { action, targetType, targetId, targetName, details, requestId?, patientId? }
 */
export const logAudit = (actor, {
  action, targetType = '', targetId = '', targetName = '', details = '',
  requestId = null, patientId = null,
}) => {
  addDoc(collection(db, 'auditLog'), {
    action,
    actorId:        actor?.uid      ?? 'system',
    actorName:      actor?.name     ?? 'System',
    actorRole:      actor?.role     ?? '',
    actorAgencyId:  actor?.agencyId ?? null,
    targetType,
    targetId,
    targetName,
    details,
    requestId,
    patientId,
    createdAt:  serverTimestamp(),
  }).catch(e => console.error('auditLog write failed:', e))
}
