import { httpsCallable } from 'firebase/functions'
import { sendEmailVerification } from 'firebase/auth'
import { functions, auth } from '../firebase'

// Email the signed-in user their address-confirmation link.
//
// Prefers the server path (sendVerificationEmail → MAPA's own SMTP, much better
// inbox placement than Firebase's default firebaseapp.com sender). Falls back to
// Firebase's native verification email if the callable is unavailable — a deploy
// window where the function isn't live yet, or an SMTP outage — so the patient
// still receives a link. A server rate-limit is respected (re-thrown), never
// papered over with the native send.
export async function requestVerificationEmail() {
  try {
    const res = await httpsCallable(functions, 'sendVerificationEmail')()
    return res?.data ?? { sent: true }
  } catch (err) {
    const code = String(err?.code || '')
    if (code.includes('resource-exhausted')) throw err // honour the hourly limit
    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await sendEmailVerification(auth.currentUser)
      return { sent: true, via: 'native' }
    }
    throw err
  }
}
