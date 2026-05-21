import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Write an entry to the auditLog collection.
 *
 * actorAgencyId is included so that an agency_admin can read their own
 * agency's slice without being able to see other agencies' entries. CRMC
 * admin entries have actorAgencyId = null.
 *
 * @param {object} actor - { uid, name, role, agencyId } of the user performing the action
 * @param {object} entry - { action, targetType, targetId, targetName, details }
 */
export const logAudit = (actor, { action, targetType = '', targetId = '', targetName = '', details = '' }) => {
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
    createdAt:  serverTimestamp(),
  }).catch(e => console.error('auditLog write failed:', e))
}
