const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')

/**
 * Announcement notifications on the server (Phase 1, gaps M19 + M20).
 *
 * Before: the creating staff member's browser looped over every user it could
 * reach (its hospital, its patients and EVERY agency user in the network) and
 * notified each one, ignoring the audience picked on the form; the 24-hour
 * reminder was sent by whichever staff browser happened to load a page in that
 * window (and never, if none did).
 *
 * Now:
 *   - onAnnouncementCreated notifies the announcement's audience
 *     (targetRoles) at ITS hospital;
 *   - announcementReminders (every 15 min) sends the 24-hour reminder once.
 * Agency promotions (source 'agency') notify nobody, as before.
 * These notifications are in-app only (`channel: 'inapp'`): a broadcast to a
 * whole hospital must not use up the mail quota the case emails depend on.
 *
 * Audience values (admin/Announcements.jsx): 'patient', 'agency',
 * 'agency_admin', 'admin' (the hospital's own staff). A doc without
 * targetRoles uses the banner default (utils/announcements.js
 * computeTargetRoles): patients and agency users.
 */
const DEFAULT_ROLES = ['patient', 'agency', 'agency_admin']
const DAY_MS = 24 * 60 * 60 * 1000

const targetRolesOf = (ann) => (Array.isArray(ann?.targetRoles) && ann.targetRoles.length ? ann.targetRoles : DEFAULT_ROLES)

const fmtWhen = (ts) => {
  const d = ts?.toDate ? ts.toDate() : null
  return d ? d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : ''
}

// The uids an announcement reaches at its hospital.
async function audienceUids({ db, ann }) {
  if (ann?.source === 'agency') return []
  const t = ann?.tenantId || DEFAULT_HOSPITAL_ID
  const roles = targetRolesOf(ann)
  const users = db.collection('users')
  const uids = new Set()
  const add = (snap) => snap.docs.forEach((d) => {
    const u = d.data() ?? {}
    if (u.active === false || u.deletion === true) return
    uids.add(d.id)
  })

  if (roles.includes('patient')) {
    add(await users.where('tenantIds', 'array-contains', t).get())
    // Accounts from before the marketplace carry only tenantId.
    const legacy = await users.where('tenantId', '==', t).where('role', '==', 'patient').get()
    add(legacy)
  }
  if (roles.includes('admin')) {
    add(await users.where('tenantId', '==', t).where('role', 'in', ['super_admin', 'staff_admin']).get())
  }
  const agencyRoles = roles.filter((r) => r === 'agency' || r === 'agency_admin')
  if (agencyRoles.length) {
    const partners = await db.collection('agencies').where('partnerHospitalIds', 'array-contains', t).get()
    for (const a of partners.docs) {
      add(await users.where('agencyId', '==', a.id).where('role', 'in', agencyRoles).get())
    }
  }
  return [...uids]
}

async function fanOut({ db, uids, notification, serverTimestamp }) {
  for (let i = 0; i < uids.length; i += 400) {
    const batch = db.batch()
    for (const uid of uids.slice(i, i + 400)) {
      batch.set(db.collection('notifications').doc(uid).collection('items').doc(), {
        ...notification, read: false, fromUid: null, channel: 'inapp', createdAt: serverTimestamp(),
      })
    }
    await batch.commit()
  }
  return uids.length
}

async function handleAnnouncementCreated({ db, ann, serverTimestamp }) {
  if (!ann || ann.active === false) return { skipped: 'inactive' }
  const uids = await audienceUids({ db, ann })
  if (!uids.length) return { skipped: 'no-audience' }
  const window = [fmtWhen(ann.startAt), fmtWhen(ann.endAt)].filter(Boolean).join(' – ')
  const notified = await fanOut({
    db, uids, serverTimestamp,
    notification: {
      type: 'system_announcement',
      title: String(ann.title ?? '').slice(0, 200),
      body: String(`${ann.message ?? ''}${window ? ` · ${window}` : ''}`).slice(0, 2000),
    },
  })
  return { notified }
}

// Reminders for announcements starting within the next 24 hours, once each.
async function handleAnnouncementReminders({ db, nowMs = Date.now(), serverTimestamp }) {
  const snap = await db.collection('announcements').where('reminderSent', '==', false).get()
  let sent = 0
  for (const d of snap.docs) {
    const ann = d.data()
    const start = ann.startAt?.toMillis?.()
    if (ann.active === false || ann.source === 'agency' || typeof start !== 'number') continue
    if (start <= nowMs || start - nowMs > DAY_MS) continue
    // Claim it first, so two overlapping runs can't both send.
    let claimed = false
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref)
      if (!fresh.exists || fresh.data().reminderSent !== false) return
      tx.update(d.ref, { reminderSent: true, reminderSentAt: serverTimestamp() })
      claimed = true
    })
    if (!claimed) continue
    const uids = await audienceUids({ db, ann })
    await fanOut({
      db, uids, serverTimestamp,
      notification: {
        type: 'system_announcement',
        title: String(`Reminder: ${ann.title ?? ''}`).slice(0, 200),
        body: String(`Scheduled in less than 24 hours. ${ann.message ?? ''}`).slice(0, 2000),
      },
    })
    sent++
  }
  return { checked: snap.size, sent }
}

exports.audienceUids = audienceUids
exports.handleAnnouncementCreated = handleAnnouncementCreated
exports.handleAnnouncementReminders = handleAnnouncementReminders

exports.onAnnouncementCreated = onDocumentCreated({
  document: 'announcements/{annId}',
  region: 'asia-southeast1',
  timeoutSeconds: 300,
  memory: '256MiB',
}, async (event) => {
  try {
    const result = await handleAnnouncementCreated({
      db: getFirestore(), ann: event.data?.data() ?? null,
      serverTimestamp: () => FieldValue.serverTimestamp(),
    })
    logger.info('[onAnnouncementCreated]', { annId: event.params.annId, ...result })
    return result
  } catch (err) {
    logger.error('[onAnnouncementCreated] failed', { annId: event.params.annId, err: err.message })
    return { failed: err.message }
  }
})

exports.announcementReminders = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'Asia/Manila',
  region: 'asia-southeast1',
  retryCount: 1,
}, async () => {
  const result = await handleAnnouncementReminders({
    db: getFirestore(), serverTimestamp: () => FieldValue.serverTimestamp(),
  })
  logger.info('[announcementReminders]', result)
})

exports.targetRolesOf = targetRolesOf
