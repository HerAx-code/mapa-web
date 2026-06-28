import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions, httpsCallable } from 'firebase/functions'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Phase 1.5: persistent local cache. Patients on slow Mindanao
// connections lose signal mid-form; without persistence they see an
// empty dashboard and assume the app is broken. With it, the most
// recent reads stay available offline and the next online window
// flushes any queued writes. persistentMultipleTabManager lets us share
// a single IndexedDB cache across multiple tabs on the same device
// (otherwise opening a second tab fails the cache init).
//
// Falls back gracefully if the browser blocks IndexedDB (private mode,
// Safari Lockdown, etc.) -- the Firestore client just runs in
// memory-only mode for that session and online ops keep working.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

// Cloud Storage — used to host signed Guarantee Letter scans so they
// aren't constrained by Firestore's 1 MiB doc cap. See storage.rules.
export const storage = getStorage(app)

// Phase 3.5: Cloud Functions client. Co-located with Firestore in
// asia-southeast1 so the callable round-trip is short. Currently
// powers verifyAccessCode (server-side rate-limited access-code
// verification); future callables (e.g. reCAPTCHA-protected mutations)
// would register here.
export const functions = getFunctions(app, 'asia-southeast1')

// Convenience for callers that need to do a one-shot anonymous sign-in
// before invoking a callable function (Register.jsx access-code check).
export { signInAnonymously, httpsCallable }
export { firebaseConfig }
