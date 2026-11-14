// Create a staff login without signing the current operator out — the same
// secondary-Firebase-app pattern admin/Accounts.jsx and admin/AddAgency.jsx use.
// Used by the platform admin to create a hospital's first administrator
// (multi-hospital Phase 6).
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail, deleteUser } from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth, firebaseConfig } from '../firebase'

const getSecondaryAuth = () => {
  const existing = getApps().find((a) => a.name === 'secondary')
  return getAuth(existing ?? initializeApp(firebaseConfig, 'secondary'))
}

/**
 * Creates the Auth account and its users/{uid} doc. The user doc is written
 * while the secondary session still holds the new account, so a rules denial
 * or network failure can delete the Auth user instead of orphaning it.
 * Returns the new uid.
 */
export async function createStaffAccount({ email, password, profile, sendReset = true }) {
  const secondaryAuth = getSecondaryAuth()
  const cleanEmail = email.trim()
  const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password)
  const uid = cred.user.uid
  try {
    await setDoc(doc(db, 'users', uid), {
      email:     cleanEmail,
      agencyId:  null,
      contact:   '',
      active:    true,
      deletion:  false,
      cooldown:  0,
      ...profile,
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    try { await deleteUser(cred.user) } catch (cleanupErr) {
      console.error('[staffAccounts] orphaned Auth user cleanup failed for', cleanEmail, cleanupErr)
    }
    await fbSignOut(secondaryAuth).catch(() => {})
    throw err
  }
  await fbSignOut(secondaryAuth)
  if (sendReset) {
    await sendPasswordResetEmail(auth, cleanEmail).catch((err) =>
      console.error('[staffAccounts] reset email failed:', err))
  }
  return uid
}
