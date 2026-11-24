// Email confirmation before filing (registration research 2026-11-24).
//
// A patient account created ON OR AFTER this moment must confirm its email
// address (Firebase's verification link) before it can file a request. Older
// accounts are exempt: they never received a verification email. The same
// moment is written into firestore.rules (patientEmailConfirmed) — keep the
// two in agreement; tests/utils/emailConfirm.test.js checks that they are.
//
// 2026-11-25 00:00 Manila = 2026-11-24 16:00 UTC.
export const EMAIL_CONFIRM_FROM = new Date('2026-11-24T16:00:00Z')

// A Firestore Timestamp, a Date, or anything else (legacy/missing) → Date|null.
const toDate = (v) => {
  if (!v) return null
  if (typeof v.toDate === 'function') return v.toDate()
  if (v instanceof Date) return v
  return null
}

// Whether this patient must still confirm their email before filing.
// `profile` is the users/{uid} doc (AuthContext user); `authUser` is the
// Firebase Auth user (auth.currentUser).
export function needsEmailConfirm(profile, authUser) {
  if (!profile || profile.role !== 'patient') return false
  if (authUser?.emailVerified) return false
  const created = toDate(profile.createdAt)
  // No (or a non-timestamp) createdAt = an older account: exempt, as in the rules.
  if (!created) return false
  return created >= EMAIL_CONFIRM_FROM
}
