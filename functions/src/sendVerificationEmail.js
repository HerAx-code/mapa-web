const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')
const { bumpWindowCounter } = require('./rateLimit')
const { SMTP_USER, SMTP_PASS, NETWORK_NAME, escapeHtml, sendMail } = require('./mailer')

/**
 * sendVerificationEmail — email the signed-in user their own address-confirmation
 * link, through MAPA's own SMTP (not Firebase's default firebaseapp.com sender,
 * which lands in spam). Used by registration and the "Resend" on the verify
 * screen. See docs/phase1-messages-accounts-plan.md + the email-confirmation
 * decision (registration research 2026-11-24).
 *
 * Safety:
 *   - self only: the address comes from request.auth.token.email, never the
 *     client, so a caller can only ever mail their own account;
 *   - no-op if already verified;
 *   - rate-limited per uid (fixed hourly window) so Resend can't be abused.
 * The link is minted with the Admin SDK (generateEmailVerificationLink) with NO
 * actionCodeSettings — so it uses the always-authorized __/auth/action handler
 * and never risks auth/unauthorized-continue-uri.
 */
const RESEND_MAX_PER_HOUR = 6

function renderVerification({ link }) {
  const subject = `Confirm your email · ${NETWORK_NAME}`
  const safe = escapeHtml(link)
  const text = [
    `Confirm your email address to finish setting up your ${NETWORK_NAME} account.`,
    '',
    'Open this link in your browser:',
    link,
    '',
    "If you didn't create an account, you can ignore this email.",
  ].join('\n')
  const html = [
    '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
    `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">Confirm your email</h2>`,
    `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">Confirm your email address to finish setting up your ${escapeHtml(NETWORK_NAME)} account.</p>`,
    `<p style="margin:0 0 20px;"><a href="${safe}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600;">Confirm email</a></p>`,
    `<p style="margin:0 0 8px;color:#6b7280;font-size:12px;">Or paste this link into your browser:</p>`,
    `<p style="margin:0 0 16px;word-break:break-all;font-size:12px;"><a href="${safe}" style="color:#166534;">${safe}</a></p>`,
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
    `<p style="margin:0;color:#9ca3af;font-size:12px;">If you didn't create an account, you can ignore this email.</p>`,
    '</div>',
  ].join('')
  return { subject, text, html }
}

// Testable core: pure except for the injected db / generateLink / sendMail.
async function handleSendVerification({
  uid, email, alreadyVerified, db, generateLink, sendMail: send, now = () => Date.now(), max = RESEND_MAX_PER_HOUR,
}) {
  if (!uid || !email) throw new HttpsError('unauthenticated', 'Please sign in first.')
  if (alreadyVerified) return { sent: false, reason: 'already-verified' }

  const limit = await bumpWindowCounter({ db, ref: db.doc(`_rateLimit/email_verify_${uid}`), max, now })
  if (!limit.allowed) {
    throw new HttpsError('resource-exhausted', `Too many requests. Try again in about ${limit.minutesLeft} minute(s).`)
  }

  let link
  try {
    link = await generateLink(email)
  } catch (err) {
    logger.error('[sendVerificationEmail] link generation failed', { uid, code: err?.code, msg: err?.message })
    throw new HttpsError('internal', 'Could not create the verification link.')
  }

  try {
    const { subject, text, html } = renderVerification({ link })
    await send({ to: email, subject, text, html })
  } catch (err) {
    logger.error('[sendVerificationEmail] send failed', { uid, code: err?.code, msg: err?.message })
    throw new HttpsError('internal', 'Could not send the email. Please try again in a moment.')
  }

  return { sent: true }
}

exports.renderVerification = renderVerification
exports.handleSendVerification = handleSendVerification

exports.sendVerificationEmail = onCall({
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
  secrets: [SMTP_USER, SMTP_PASS],
}, async (request) => handleSendVerification({
  uid: request.auth?.uid,
  email: request.auth?.token?.email,
  alreadyVerified: request.auth?.token?.email_verified === true,
  db: getFirestore(),
  generateLink: (email) => getAuth().generateEmailVerificationLink(email),
  sendMail,
}))
