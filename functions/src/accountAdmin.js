const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { assertStaffMfa } = require('./mfaPolicy')
const { getAuth } = require('firebase-admin/auth')
const { getStorage } = require('firebase-admin/storage')

/**
 * Account lifecycle on the server (Phase 1, T2 — docs/phase1-messages-accounts-plan.md).
 *
 *   eraseAccount   — Hospital Admin only. Replaces deleteAuthUser, which let
 *                    any Hospital Admin delete ANY sign-in (gap I4), and the
 *                    browser cascade that stopped halfway because the rules
 *                    forbid deleting conversations (M1).
 *   disableAccount — blocks (or restores) a staff sign-in without deleting
 *                    anything (decision P1-B; M9). Profile `active` alone
 *                    was only checked after sign-in.
 *   resetStaffMfa  — clears a staff member's two-factor for a lost phone
 *                    (decision P1-C), before two-factor becomes required.
 *
 * Every check reads both profiles with the Admin SDK; nothing the browser
 * sends besides the target uid is trusted. Each action writes its own audit
 * entry, with no patient personal details.
 */

const GATEWAY = ['super_admin', 'staff_admin']
const AGENCY  = ['agency', 'agency_admin']

const hospitalsOf = (u) => [...new Set([...(Array.isArray(u?.tenantIds) ? u.tenantIds : []), ...(u?.tenantId ? [u.tenantId] : [])])]
const isSelfie = (name) => /selfie|live photo/i.test(name || '')
// Profile fields removed when a funded patient's account is restricted (D7).
// Name, birthdate, sex, city and province stay: the case record and the DOH
// monthly report need them.
const RESTRICT_REMOVE = ['email', 'contact', 'address', 'barangay', 'photoURL', 'managedBy']

const { fail, loadUser, loadCaller } = require('./serverWrites')

function targetUidOf(data) {
  const uid = data?.uid
  if (typeof uid !== 'string' || !uid) fail('invalid-argument', 'A target account is required.')
  return uid
}

const { writeAudit, notifyServer } = require('./serverWrites')

async function deleteQuery(db, query) {
  const snap = await query.get()
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch()
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  return snap.size
}

const removeSignIn = async (auth, uid) => {
  try { await auth.deleteUser(uid) } catch (err) { if (err?.code !== 'auth/user-not-found') throw err }
}

// ── eraseAccount ────────────────────────────────────────────────────────────

// Does this patient have anything that must be kept as a case record?
async function caseRecordOf(db, uid) {
  const [reqs, slices, certs] = await Promise.all([
    db.collection('requests').where('patientId', '==', uid).get(),
    db.collection('applications').where('patientId', '==', uid).get(),
    db.collection('eligibilityCertificates').where('patientId', '==', uid).get(),
  ])
  const endorsed = reqs.docs.some((d) => (d.data().agencyIds?.length ?? 0) > 0 || Number(d.data().amountCommitted) > 0)
  return { keep: endorsed || !slices.empty || !certs.empty, requestIds: reqs.docs.map((d) => d.id) }
}

async function removeIdentityIndex(db, uid) {
  const byUser = await db.doc(`identityIndexByUser/${uid}`).get()
  const keys = byUser.exists ? Object.values(byUser.data().keys ?? {}) : []
  for (const h of keys) {
    await db.doc(`identityIndex/${h}`).set({ uids: FieldValue.arrayRemove(uid) }, { merge: true })
  }
  if (byUser.exists) await byUser.ref.delete()
  await deleteQuery(db, db.collection('identityFlags').where('uid', '==', uid))
}

async function eraseFully(db, auth, bucket, uid, requestIds) {
  // Documents, their contents and any Storage files.
  const docs = await db.collection('documents').where('patientId', '==', uid).get()
  for (const d of docs.docs) {
    const path = d.data().storagePath
    if (path && bucket) await bucket.file(path).delete({ ignoreNotFound: true }).catch(() => {})
    await db.doc(`documentContents/${d.id}`).delete()
    await d.ref.delete()
  }
  for (const id of requestIds) {
    await deleteQuery(db, db.collection('billKeys').where('requestId', '==', id))
  }
  await deleteQuery(db, db.collection('requests').where('patientId', '==', uid))
  // Conversations and their messages (case record only once endorsed; this
  // patient never was).
  const convs = await db.collection('conversations').where('participants', 'array-contains', uid).get()
  for (const c of convs.docs) {
    await deleteQuery(db, c.ref.collection('messages'))
    await c.ref.delete()
  }
  await deleteQuery(db, db.collection('notifications').doc(uid).collection('items'))
  await db.doc(`notifications/${uid}`).delete()
  await removeIdentityIndex(db, uid)
  // The access codes the patient claimed: who they were issued to goes; the
  // code stays used so nobody can claim it again.
  const codes = await db.collection('hospitalIds').where('patId', '==', uid).get()
  for (const c of codes.docs) {
    await deleteQuery(db, c.ref.collection('privateInfo'))
    await c.ref.update({ patId: null, erased: true, erasedAt: FieldValue.serverTimestamp() })
  }
  // Audit entries are the hospital's record of its own actions and stay; the
  // patient's name is taken off them.
  const audits = await db.collection('auditLog').where('patientId', '==', uid).get()
  for (let i = 0; i < audits.docs.length; i += 400) {
    const batch = db.batch()
    audits.docs.slice(i, i + 400).forEach((a) => batch.update(a.ref, { targetName: 'Erased patient' }))
    await batch.commit()
  }
  await db.doc(`users/${uid}`).delete()
  await removeSignIn(auth, uid)
}

async function restrict(db, auth, uid, caller) {
  // Selfies go; everything else the case relies on stays (D7).
  const docs = await db.collection('documents').where('patientId', '==', uid).get()
  for (const d of docs.docs) {
    if (!isSelfie(d.data().documentTypeName || d.data().name)) continue
    await db.doc(`documentContents/${d.id}`).delete()
    await d.ref.set({ selfieContentPurgedAt: FieldValue.serverTimestamp(), selfieContentPurgedReason: 'account_restricted' }, { merge: true })
  }
  await deleteQuery(db, db.collection('notifications').doc(uid).collection('items'))
  await db.doc(`users/${uid}`).update({
    ...Object.fromEntries(RESTRICT_REMOVE.map((k) => [k, FieldValue.delete()])),
    active: false, deletion: true,
    erasedAt: FieldValue.serverTimestamp(), erasedByUid: caller.uid,
  })
  await removeSignIn(auth, uid)
}

async function handleEraseAccount({ callerUid, data, db, auth, bucket }) {
  const caller = await loadCaller(db, callerUid)
  if (caller.role !== 'super_admin' || !caller.tenantId) fail('permission-denied', 'Only a Hospital Admin can erase accounts.')
  const uid = targetUidOf(data)
  if (uid === caller.uid) fail('invalid-argument', 'You cannot erase your own account.')
  const target = await loadUser(db, uid)
  if (!target) fail('not-found', 'That account no longer has a profile, so its hospital cannot be checked.')

  if (GATEWAY.includes(target.role)) {
    if (target.tenantId !== caller.tenantId) fail('permission-denied', "That account belongs to another hospital.")
    if (target.role === 'super_admin') {
      const admins = await db.collection('users').where('tenantId', '==', caller.tenantId).where('role', '==', 'super_admin').get()
      const others = admins.docs.filter((d) => d.id !== uid && d.data().active !== false)
      if (!others.length) fail('failed-precondition', "This is the hospital's last Hospital Admin.")
    }
    await db.doc(`users/${uid}`).delete()
    await removeSignIn(auth, uid)
    await writeAudit(db, caller, { action: 'account_deleted', targetId: uid, targetName: target.name ?? '', details: `Hospital staff account deleted (${target.role})` })
    return { mode: 'staff_deleted' }
  }

  if (target.role !== 'patient') fail('permission-denied', 'A Hospital Admin can erase only its own staff and patients.')
  const hospitals = hospitalsOf(target)
  if (!hospitals.includes(caller.tenantId)) fail('permission-denied', 'That patient has not filed with your hospital.')
  if (hospitals.some((h) => h !== caller.tenantId)) fail('failed-precondition', 'This patient also has a case at another hospital.')

  const { keep, requestIds } = await caseRecordOf(db, uid)
  if (keep) {
    await restrict(db, auth, uid, caller)
    await writeAudit(db, caller, { action: 'account_restricted', targetType: 'patient', targetId: uid, targetName: 'Restricted patient account', details: 'Sign-in and contact details removed; case record kept for the retention period', patientId: uid })
    return { mode: 'restricted' }
  }
  await eraseFully(db, auth, bucket, uid, requestIds)
  await writeAudit(db, caller, { action: 'account_erased', targetType: 'patient', targetId: uid, targetName: 'Erased patient', details: 'Never-endorsed patient account and its data erased' })
  return { mode: 'erased' }
}

// ── disableAccount ──────────────────────────────────────────────────────────

// Who may block whose sign-in (P1-B; plus Hospital Admins for their own staff,
// whose Deactivate button is the same action).
function mayDisable(caller, target) {
  if (!target || target.uid === caller.uid || target.role === 'platform_admin' || target.role === 'patient') return false
  if (caller.role === 'super_admin') return GATEWAY.includes(target.role) && !!caller.tenantId && target.tenantId === caller.tenantId
  if (caller.role === 'agency_admin') return AGENCY.includes(target.role) && !!caller.agencyId && target.agencyId === caller.agencyId
  if (caller.role === 'platform_admin') return GATEWAY.includes(target.role) || AGENCY.includes(target.role)
  return false
}

async function handleDisableAccount({ callerUid, data, db, auth }) {
  const caller = await loadCaller(db, callerUid)
  const uid = targetUidOf(data)
  const enable = data?.enable === true
  const target = await loadUser(db, uid)
  if (!mayDisable(caller, target)) fail('permission-denied', 'You cannot change that account.')
  if (!enable && target.role === 'agency_admin') {
    const admins = await db.collection('users').where('agencyId', '==', target.agencyId).where('role', '==', 'agency_admin').get()
    if (!admins.docs.some((d) => d.id !== uid && d.data().active !== false)) fail('failed-precondition', "This is the agency's last active Agency Admin.")
  }
  if (!enable && target.role === 'super_admin') {
    const admins = await db.collection('users').where('tenantId', '==', target.tenantId).where('role', '==', 'super_admin').get()
    if (!admins.docs.some((d) => d.id !== uid && d.data().active !== false)) fail('failed-precondition', "This is the hospital's last active Hospital Admin.")
  }
  await auth.updateUser(uid, { disabled: !enable })
  if (!enable) await auth.revokeRefreshTokens(uid)
  await db.doc(`users/${uid}`).update({ active: enable })
  await notifyServer(db, uid, enable
    ? { type: 'account_activated', title: 'Account Reactivated', body: 'Your account has been reactivated. You can sign in again.' }
    : { type: 'account_deactivated', title: 'Account Deactivated', body: 'Your account has been deactivated and you have been signed out. Contact your administrator.' })
  await writeAudit(db, caller, { action: enable ? 'account_activated' : 'account_deactivated', targetId: uid, targetName: target.name ?? '', details: `${enable ? 'Sign-in restored' : 'Sign-in disabled'} (${target.role})` })
  return { disabled: !enable }
}

// ── resetStaffMfa ───────────────────────────────────────────────────────────

function mayResetMfa(caller, target) {
  if (!target || target.uid === caller.uid || target.role === 'patient' || target.role === 'platform_admin') return false
  if (caller.role === 'super_admin') return GATEWAY.includes(target.role) && !!caller.tenantId && target.tenantId === caller.tenantId
  if (caller.role === 'platform_admin') return target.role === 'super_admin' || AGENCY.includes(target.role)
  return false
}

async function handleResetStaffMfa({ callerUid, data, db, auth }) {
  const caller = await loadCaller(db, callerUid)
  const uid = targetUidOf(data)
  const target = await loadUser(db, uid)
  if (!mayResetMfa(caller, target)) fail('permission-denied', 'You cannot reset two-factor for that account.')
  await auth.updateUser(uid, { multiFactor: { enrolledFactors: null } })
  await auth.revokeRefreshTokens(uid)
  await notifyServer(db, uid, { type: 'mfa_reset', title: 'Two-factor sign-in was reset', body: 'Your administrator reset your two-factor sign-in. Sign in again and set up your authenticator app.' })
  await writeAudit(db, caller, { action: 'mfa_reset', targetId: uid, targetName: target.name ?? '', details: `Two-factor reset (${target.role})` })
  return { reset: true }
}

// ── Callables ──────────────────────────────────────────────────────────────

const wrap = (name, handler, deps = () => ({})) => onCall({
  region: 'asia-southeast1', timeoutSeconds: 300, memory: '256MiB',
}, async (request) => {
  try {
    // Two-factor stage 2 (Phase 5 PR 5.4): off until enabled in mfaPolicy.js.
    await assertStaffMfa(getFirestore(), request.auth)
    return await handler({ callerUid: request.auth?.uid, data: request.data, db: getFirestore(), auth: getAuth(), ...deps() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error(`[${name}] failed`, { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Try again; the action continues where it stopped.')
  }
})

exports.handleEraseAccount = handleEraseAccount
exports.handleDisableAccount = handleDisableAccount
exports.handleResetStaffMfa = handleResetStaffMfa
exports.mayDisable = mayDisable
exports.mayResetMfa = mayResetMfa

exports.eraseAccount = wrap('eraseAccount', handleEraseAccount, () => ({ bucket: getStorage().bucket() }))
exports.disableAccount = wrap('disableAccount', handleDisableAccount)
exports.resetStaffMfa = wrap('resetStaffMfa', handleResetStaffMfa)
