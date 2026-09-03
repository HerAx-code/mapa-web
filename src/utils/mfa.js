// Multi-factor authentication (TOTP) helpers — thin wrappers over the Firebase
// modular MFA SDK so the UI never touches the raw generators. Targets STAFF
// roles only (a stolen staff password is the highest-likelihood breach path;
// patients are lowest-trust, own-data-only, and phone-primary, so they stay
// exempt). See docs/security-research.md §3.2.
//
// Requires Identity Platform (Blaze) + TOTP enabled in the Firebase console.
// Until that's on, enrolledFactors stays empty and every helper is inert, so
// this ships safely ahead of the console toggle.
import {
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth'

// Roles for which MFA is expected. Patients are intentionally absent.
export const MFA_ROLES = ['super_admin', 'staff_admin', 'agency_admin', 'agency']
export const roleNeedsMfa = (role) => MFA_ROLES.includes(role)

// Enforcement mode. Start at 'prompt' (a dismissible nudge) so enabling MFA on
// a live system can't lock working staff out before they've enrolled. Flip to
// 'required' once staff are enrolled to hard-gate access; 'off' disables the
// nudge entirely.
export const MFA_MODE = 'prompt' // 'off' | 'prompt' | 'required'

// Is this signed-in Firebase user already enrolled in a second factor?
export function isMfaEnrolled(fbUser) {
  try {
    return !!fbUser && multiFactor(fbUser).enrolledFactors.length > 0
  } catch {
    return false
  }
}

// Re-authenticate with the current password. Enrolling/unenrolling a factor
// requires a recent login; doing this up front makes enrollment reliable
// whether the user just logged in or opened the modal hours later.
export async function reauthWithPassword(fbUser, password) {
  const cred = EmailAuthProvider.credential(fbUser.email, password)
  await reauthenticateWithCredential(fbUser, cred)
}

// Begin TOTP enrollment: returns the secret (kept by the caller for the verify
// step), an otpauth:// URL to render as a QR, and the manual-entry key.
export async function startTotpEnrollment(fbUser, { issuer = 'MAPA (CRMC)' } = {}) {
  const session = await multiFactor(fbUser).getSession()
  const secret = await TotpMultiFactorGenerator.generateSecret(session)
  const qrUrl = secret.generateQrCodeUrl(fbUser.email ?? 'MAPA account', issuer)
  return { secret, qrUrl, sharedKey: secret.secretKey }
}

// Finish enrollment with the 6-digit code from the authenticator app.
export async function completeTotpEnrollment(fbUser, secret, code, displayName = 'Authenticator app') {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, String(code).trim())
  await multiFactor(fbUser).enroll(assertion, displayName)
}

// Remove the enrolled factor (requires a recent re-auth first).
export async function unenrollTotp(fbUser) {
  const factor = multiFactor(fbUser).enrolledFactors[0]
  if (factor) await multiFactor(fbUser).unenroll(factor)
}

// ── Sign-in challenge ─────────────────────────────────────────────────────
// signInWithEmailAndPassword throws `auth/multi-factor-auth-required` for an
// enrolled user; the login screen catches it and drives the TOTP prompt.
export function isMfaChallenge(err) {
  return err?.code === 'auth/multi-factor-auth-required'
}
export function resolverFor(auth, err) {
  return getMultiFactorResolver(auth, err)
}
export async function resolveTotpSignIn(resolver, code) {
  const hint =
    resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ??
    resolver.hints[0]
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, String(code).trim())
  return resolver.resolveSignIn(assertion)
}
