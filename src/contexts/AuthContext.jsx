import { createContext, useContext, useState, useEffect } from 'react'
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, deleteUser } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

const AuthContext = createContext(null)

// Orphan auth handler — an Auth account exists but the Firestore user doc
// doesn't. This can happen if registration's transactional rollback failed
// (rare, but possible on partial network failure). Try one more cleanup
// pass, then sign the session out so the patient lands on a recoverable
// state instead of a half-broken dashboard with no role.
async function handleOrphanAuth(fbUser) {
  try { await deleteUser(fbUser) } catch { /* needs recent sign-in; ignore */ }
  await signOut(auth).catch(() => {})
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const snap = await getDoc(doc(db, 'users', fbUser.uid))
        if (snap.exists()) {
          const data = snap.data()
          // Enforce the deactivated / marked-for-deletion gates on EVERY auth
          // resolution — not just the password login() path. Otherwise an
          // account that authenticated via the MFA challenge (which bypasses
          // login()) or one that simply refreshed the page would keep a
          // session after being deactivated. Sign out and drop to null.
          if (data.active === false || data.deletion === true) {
            await signOut(auth)
            setUser(null)
            setLoading(false)
            return
          }
          setUser({ uid: fbUser.uid, email: fbUser.email, ...data })
        } else {
          // User doc not present (yet). Two legitimate possibilities:
          //   (a) Registration is IN FLIGHT — the Register flow creates
          //       the Auth account first, then writes the users/{uid}
          //       doc inside a transaction. onAuthStateChanged fires
          //       BEFORE that transaction runs, so the read here will
          //       always miss on first registration. Register.jsx
          //       follows up with updateUser({...}) once the transaction
          //       commits, which populates the user state correctly.
          //   (b) A true orphan from a failed registration — handled in
          //       the login() path below (which CAN safely run cleanup
          //       because it knows the user just attempted to log in,
          //       not register).
          // Auto-cleaning here would race legitimate registrations:
          // the delete would void request.auth mid-transaction and
          // every subsequent tx step would fail with permission-denied.
          // Just set null and let updateUser() or login() resolve it.
          setUser(null)
        }
      } else {
        setUser(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const updateUser = (updates) => setUser(prev => ({ ...prev, ...updates }))

  const login = async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    const snap = await getDoc(doc(db, 'users', cred.user.uid))
    if (!snap.exists()) {
      // Orphan auth: clean up the broken account so the patient can
      // re-register with the same email instead of being permanently
      // locked out by "email already in use".
      await handleOrphanAuth(cred.user)
      throw new Error('Account anomaly detected. Please re-register or contact CRMC Medical Social Services.')
    }
    const data = snap.data()
    if (data.active === false) {
      await signOut(auth)
      throw new Error('Your account has been deactivated. Please contact your administrator.')
    }
    // Patient soft-deletion: admin/Patients flips this flag to start the
    // holding period before a hard delete. Allowing login during that
    // window defeats the purpose -- the patient could continue to use
    // the system, submit new requests, etc. while flagged for removal.
    // Discovered during the 2026-06-03 end-to-end review (R1).
    if (data.deletion === true) {
      await signOut(auth)
      throw new Error('This account is marked for deletion. Contact CRMC Medical Social Services to restore it.')
    }
    const userData = { uid: cred.user.uid, email, ...data }
    setUser(userData)
    return userData
  }

  const logout = () => signOut(auth)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
