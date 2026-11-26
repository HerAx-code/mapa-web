const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { mayEmail, emailLimitFor } = require('./emailScope')
const { bumpWindowCounter } = require('./rateLimit')
const { SMTP_USER, SMTP_PASS, NETWORK_NAME, escapeHtml, sendMail } = require('./mailer')

/**
 * sendNotificationEmail — the ONLY place MAPA sends email (Phase 1, T1).
 *
 * Every in-app notification (notifications/{uid}/items/{id}) is written by
 * notify() in the browser or by another Cloud Function. This trigger emails
 * it to the recipient when:
 *   - it hasn't been handled already (triggers can fire twice),
 *   - the notification doesn't opt out (`channel: 'inapp'`, used by
 *     announcement fan-outs so a broadcast can't exhaust the mail quota),
 *   - the sender may reach the recipient (emailScope.mayEmail, decision P1-A),
 *   - the sender is under their hourly limit (decision P1-D).
 * The subject and body come from the notification (rules cap their length);
 * the HTML is built here and every value is escaped, so no client markup is
 * ever mailed. The outcome is stamped on the notification as `email`.
 *
 * Replaces the Vercel /api/send-email and /api/send-sms endpoints, which
 * mailed any address with any content for any signed-in account (gap I5).
 */
// SMTP transport, secrets and the From header live in ./mailer (shared with
// sendVerificationEmail) so the two senders can't drift apart.

function renderEmail({ title, body, footer }) {
  const subject = String(title || `${NETWORK_NAME} notification`).slice(0, 200)
  const text = `${body ?? ''}\n\n— ${footer}`
  const html = [
    '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
    `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(title ?? '')}</h2>`,
    `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(body ?? '').replace(/\n/g, '<br>')}</p>`,
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
    `<p style="margin:0;color:#9ca3af;font-size:12px;">${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('')
  return { subject, text, html }
}

const getData = async (ref) => {
  const s = await ref.get()
  return s.exists ? s.data() : null
}

// The footer names the recipient's hospital when they have one (patients and
// gateway staff); agency and Super Admin users get the network name.
async function footerFor(db, recipient) {
  const tenantId = ['patient', 'super_admin', 'staff_admin'].includes(recipient?.role) ? recipient?.tenantId : null
  if (!tenantId) return NETWORK_NAME
  const h = await getData(db.doc(`hospitals/${tenantId}`)).catch(() => null)
  const name = h?.facilityName || h?.shortName
  return name ? `${NETWORK_NAME} · ${name}` : NETWORK_NAME
}

async function handleNotificationEmail({ db, uid, notifId, sendMail, now = () => Date.now() }) {
  const ref = db.doc(`notifications/${uid}/items/${notifId}`)

  // 1. Claim it once.
  let notif = null
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data().email) return
    notif = snap.data()
    tx.update(ref, { email: { state: 'sending' } })
  })
  if (!notif) return { skipped: 'already-handled' }

  const finish = async (email) => {
    await ref.update({ email: { ...email, at: FieldValue.serverTimestamp() } })
    return email
  }
  if (notif.channel === 'inapp') return finish({ state: 'skipped', reason: 'in-app-only' })

  // 2. Who is involved.
  const recipient = await getData(db.doc(`users/${uid}`))
  const fromUid = typeof notif.fromUid === 'string' && notif.fromUid ? notif.fromUid : null
  const senderDoc = fromUid ? await getData(db.doc(`users/${fromUid}`)) : null
  if (fromUid && !senderDoc) return finish({ state: 'skipped', reason: 'unknown-sender' })
  const sender = senderDoc ? { ...senderDoc, uid: fromUid } : null

  const agencyIds = [...new Set([sender?.agencyId, recipient?.agencyId].filter(Boolean))]
  const partners = {}
  await Promise.all(agencyIds.map(async (id) => {
    const a = await getData(db.doc(`agencies/${id}`)).catch(() => null)
    partners[id] = Array.isArray(a?.partnerHospitalIds) ? a.partnerHospitalIds : []
  }))

  // 3. May this sender reach this recipient?
  const scope = mayEmail(sender, recipient ? { ...recipient, uid } : null, partners)
  if (!scope.allowed) return finish({ state: 'skipped', reason: scope.reason })

  // 4. Hourly limit per sender (server events are not counted).
  if (sender) {
    const limit = await bumpWindowCounter({
      db, ref: db.doc(`_rateLimit/email_sender_${fromUid}`), max: emailLimitFor(sender), now,
    })
    if (!limit.allowed) return finish({ state: 'skipped', reason: 'rate-limited' })
  }

  // 5. Send.
  const { subject, text, html } = renderEmail({ title: notif.title, body: notif.body, footer: await footerFor(db, recipient) })
  try {
    await sendMail({ to: recipient.email, subject, text, html })
  } catch (err) {
    logger.error('[sendNotificationEmail] send failed', { uid, notifId, code: err?.code, err: err?.message })
    return finish({ state: 'failed', reason: String(err?.code || 'send-error').slice(0, 60) })
  }
  return finish({ state: 'sent' })
}

exports.handleNotificationEmail = handleNotificationEmail
exports.renderEmail = renderEmail
exports.escapeHtml = escapeHtml

exports.sendNotificationEmail = onDocumentCreated({
  document: 'notifications/{uid}/items/{notifId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
  secrets: [SMTP_USER, SMTP_PASS],
}, async (event) => {
  try {
    const result = await handleNotificationEmail({
      db: getFirestore(),
      uid: event.params.uid,
      notifId: event.params.notifId,
      sendMail,
    })
    if (result?.state === 'failed') logger.warn('[sendNotificationEmail] not sent', { uid: event.params.uid, ...result })
    return result
  } catch (err) {
    logger.error('[sendNotificationEmail] handler failed', { uid: event.params.uid, err: err.message })
    return { failed: err.message }
  }
})
