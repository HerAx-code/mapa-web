import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
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

// App Check — bot / abuse protection for self-registration and the public
// callables/endpoints. Initialised ONLY when an App Check site key is
// configured (VITE_APPCHECK_SITE_KEY); with no key this is a complete no-op,
// so local dev and any un-provisioned environment are unaffected. Registered
// right after the app — before Auth/Firestore/Storage/Functions — so its
// token attaches to their requests.
//
// Rollout (owner): in Firebase Console → App Check, register a reCAPTCHA v3
// provider (gives a site key), set VITE_APPCHECK_SITE_KEY in the deploy env
// (read at build time), start in "monitoring" mode, then enable enforcement
// per service once traffic looks clean. For local dev against an enforcing
// project, set VITE_APPCHECK_DEBUG='true' and register the debug token the
// console prints.
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_SITE_KEY
if (appCheckSiteKey) {
  if (import.meta.env.VITE_APPCHECK_DEBUG === 'true' && typeof self !== 'undefined') {
    // eslint-disable-next-line no-undef
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (err) {
    // App Check setup must never block the app from loading.
    console.warn('[appcheck] init failed:', err?.message)
  }
}

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
