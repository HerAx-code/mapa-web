const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * onOnboardingRequestCreated — tells the network operators (platform_admin,
 * shown as "Super Admin") that a hospital asked to join from the public
 * "For hospitals" page.
 *
 * WHY server-side: the form's sender is an anonymous session, and the
 * notifications rules (rightly) don't let an anonymous visitor drop items into
 * staff feeds — that is a spam/phishing primitive (abuse hardening #1). So the
 * ping is written here with the Admin SDK. In-app only: the sender's contact
 * details stay in the queue, never in a notification body beyond the name.
 *
 * Testable-handler pattern (verifyAccessCode / onSliceProceeded).
 */
async function handleOnboardingRequestCreated({ db, request, serverTimestamp }) {
  if (!request || request.status !== 'new') return { skipped: 'not-new' }
  const snap = await db.collection('users').where('role', '==', 'platform_admin').get()
  if (snap.empty) return { skipped: 'no-operators' }
  const name = String(request.hospitalName || 'A hospital').slice(0, 150)
  const where = request.region ? ` (${String(request.region).slice(0, 40)})` : ''
  await Promise.all(snap.docs.map((d) =>
    db.collection('notifications').doc(d.id).collection('items').add({
      type:      'onboarding_request',
      title:     'New hospital onboarding request',
      body:      `${name}${where} asked to join MAPA. Review it in Onboarding requests.`,
      read:      false,
      createdAt: serverTimestamp(),
      fromUid:   null,
    }),
  ))
  return { notified: snap.size }
}

exports.handleOnboardingRequestCreated = handleOnboardingRequestCreated

exports.onOnboardingRequestCreated = onDocumentCreated({
  document: 'onboardingRequests/{reqId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  try {
    const result = await handleOnboardingRequestCreated({
      db: admin.firestore(),
      request: event.data?.data(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
    if (result.notified) logger.info('[onOnboardingRequestCreated] notified operators', { reqId: event.params.reqId, ...result })
  } catch (err) {
    logger.error('[onOnboardingRequestCreated] failed', { reqId: event.params.reqId, err: err.message })
  }
})
