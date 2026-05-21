import { createContext, useContext, useState, useEffect } from 'react'
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const snap = await getDoc(doc(db, 'users', fbUser.uid))
        setUser(snap.exists()
          ? { uid: fbUser.uid, email: fbUser.email, ...snap.data() }
          : { uid: fbUser.uid, email: fbUser.email }
        )
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
    if (!snap.exists()) throw new Error('User profile not found.')
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
