const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const nodemailer = require('nodemailer')

// Gmail SMTP credentials, shared with the Vercel /api/send-email route (the
// same Gmail App Password). Stored as Firebase secrets and bound to this
// function — so they MUST be set before deploying functions:
//   firebase functions:secrets:set SMTP_USER   (the Gmail address)
//   firebase functions:secrets:set SMTP_PASS   (the 16-char App Password)
// The From line defaults to "MAPA CRMC <SMTP_USER>"; override with a plain
// (non-secret) SMTP_FROM env var if a different display From is wanted.
const SMTP_USER = defineSecret('SMTP_USER')
const SMTP_PASS = defineSecret('SMTP_PASS')

/**
 * interviewReminders — scheduled reminders for upcoming assessment interviews
 * (Phase 2b, docs/appointment-system-plan.md §4.5–4.6).
 *
 * Fires two in-app reminders per interview — ~24h before and ~1–2h before —
 * each exactly once, tracked by reminderSent24h / reminderSent1h on the request
 * (re-armed by onInterviewSlotWritten on every (re)booking). Reads interviewAt
 * (the instant, set by the sync trigger) so the window maths is exact.
 *
 * CHANNEL: in-app only for now. Email (the ~48h prep touch + a 24h copy) is the
 * Vercel /api/send-email route, not a Cloud-Functions-native mechanism, so it is
 * a deliberate follow-up (have this function POST that route). When the mobile
 * app ships, push (free via FCM) takes the urgency role SMS would otherwise own.
 *
 * COPY: pro-social framing — an RCT (14 hospitals, 161k patients) cut did-not-
 * attend 21.1% → 14.2% with wording alone. The slots genuinely are scarce here,
 * so the honest "another patient can use your time" frame is both effective and
 * ethical. Kept warm/civic, never shaming (CLAUDE.md tone). English to match
 * every other notify() string in the app; bilingual notifications are a separate,
 * system-wide follow-up.
 *
 * Testable-handler pattern: the onSchedule wrapper injects db/now/deps and calls
 * handleInterviewReminders().
 */

const CONCLUDED_OUTCOMES = ['completed', 'no_show']
const OFFICE = 'CRMC Malasakit Center — Ground Floor, Medical Social Services'

function reminderCopy(kind, req) {
  const online = req.interviewMode === 'online'
  const when = `${req.interviewDate} at ${req.interviewTime}`
  if (kind === 'final') {
    return {
      title: 'Your CRMC interview is in a couple of hours',
      body: online
        ? `Your assessment interview is today at ${req.interviewTime}. Join the Google Meet link a few minutes early and check your camera and microphone.`
        : `Your assessment interview is today at ${req.interviewTime} at ${OFFICE}. Please arrive 15 minutes early with your ID and original documents.`,
    }
  }
  return {
    title: 'Your CRMC interview is tomorrow',
    body: online
      ? `Your assessment interview is tomorrow, ${when}, via Google Meet. If you can't make it, please reschedule now so another patient waiting for assistance can use the time.`
      : `Your assessment interview is tomorrow, ${when}, at ${OFFICE}. Please come at your scheduled time. If you can't make it, reschedule now so another patient waiting for assistance can use the slot.`,
  }
}

// The 25h upper bound catches the 24h reminder; the 1–2h final reminder is a
// subset of that window, so a single query serves both.
const WINDOW_HOURS = 25

async function handleInterviewReminders({ db, nowMs, timestampFromMs, serverTimestamp, sendNotification }) {
  const snap = await db.collection('requests')
    .where('interviewAt', '>=', timestampFromMs(nowMs))
    .where('interviewAt', '<=', timestampFromMs(nowMs + WINDOW_HOURS * 3600000))
    .get()

  let sent24h = 0
  let sentFinal = 0
  for (const docSnap of snap.docs) {
    const req = docSnap.data()
    if (CONCLUDED_OUTCOMES.includes(req.interviewOutcome)) continue
    const atMs = req.interviewAt?.toMillis ? req.interviewAt.toMillis() : null
    if (atMs == null || atMs < nowMs) continue
    const hoursUntil = (atMs - nowMs) / 3600000

    let kind = null
    let flags = null
    if (hoursUntil <= 2 && !req.reminderSent1h) {
      kind = 'final'
      // Mark the 24h reminder sent too, so a missed 24h touch never fires late.
      flags = { reminderSent1h: true, reminderSent24h: true }
    } else if (hoursUntil <= 24 && !req.reminderSent24h && !req.reminderSent1h) {
      // ...but never send a "tomorrow" touch once the final one has gone (an
      // interview inside 2h whose final already fired must not get a 24h note).
      kind = '24h'
      flags = { reminderSent24h: true }
    }
    if (!kind) continue

    try {
      const { title, body } = reminderCopy(kind, req)
      await sendNotification({ uid: req.patientId, type: 'interview_reminder', title, body })
      await docSnap.ref.update({ ...flags, updatedAt: serverTimestamp() })
      if (kind === 'final') sentFinal++; else sent24h++
    } catch (err) {
      // One patient's failed reminder must not abort the batch.
      logger.error('[interviewReminders] one reminder failed', {
        requestId: docSnap.id, kind, err: err?.message ?? String(err),
      })
    }
  }
  return { scanned: snap.size, sent24h, sentFinal }
}

exports.handleInterviewReminders = handleInterviewReminders
exports.reminderCopy = reminderCopy

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

// The same branded shell notify() uses on the web, so a reminder email looks
// like every other MAPA email.
function reminderEmailHtml(title, body) {
  return [
    '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
    `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(title)}</h2>`,
    `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(body).replace(/\n/g, '<br>')}</p>`,
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
    '<p style="margin:0;color:#9ca3af;font-size:12px;">MAPA · Cotabato Regional Medical Center · Sinsuat Avenue, Cotabato City</p>',
    '</div>',
  ].join('')
}

exports.interviewReminders = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 2,
    secrets: [SMTP_USER, SMTP_PASS],
  },
  async () => {
    const db = admin.firestore()
    // One transport per invocation, reused across the batch's sends.
    const mailFrom = process.env.SMTP_FROM || `MAPA CRMC <${SMTP_USER.value()}>`
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
    })

    const result = await handleInterviewReminders({
      db,
      nowMs: Date.now(),
      timestampFromMs: (ms) => admin.firestore.Timestamp.fromMillis(ms),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      sendNotification: async ({ uid, type, title, body }) => {
        if (!uid) return
        // 1. In-app (primary): the same notifications/{uid}/items shape the
        //    client notify() writes. Admin SDK bypasses rules; fromUid null
        //    marks it system-generated.
        await db.collection('notifications').doc(uid).collection('items').add({
          type, title, body, read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          fromUid: null,
        })
        // 2. Email (secondary): only if the patient has an email on file.
        //    Best-effort — a mail failure never fails the reminder or the batch.
        try {
          const snap  = await db.collection('users').doc(uid).get()
          const email = snap.exists ? snap.data()?.email : null
          if (!email) return
          await transport.sendMail({
            from:    mailFrom,
            to:      email,
            subject: title,
            text:    `${body}\n\n— MAPA · Cotabato Regional Medical Center`,
            html:    reminderEmailHtml(title, body),
          })
        } catch (err) {
          logger.warn('[interviewReminders] email send failed', { uid, err: err?.message })
        }
      },
    })
    logger.info('[interviewReminders] run complete', result)
  }
)
