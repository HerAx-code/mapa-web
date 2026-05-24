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
          setUser({ uid: fbUser.uid, email: fbUser.email, ...snap.data() })
        } else {
          // Orphan — Auth account without a user doc. Clean up and force
          // re-auth so the patient sees a clear "account not found" error
          // instead of a dashboard with no role / broken routing.
          await handleOrphanAuth(fbUser)
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
