const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { assertStaffMfa } = require('./mfaPolicy')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')
const { fail, loadCaller, writeAudit } = require('./serverWrites')

/**
 * Case conversations — Phase 3 PR 3.3 (decision P3-C / D11, gaps M16, N13).
 *
 * openCaseConversation({ requestId }) — the conversation between the
 *   hospital and the patient about one case belongs to the CASE, not to the
 *   staff member who started it. Gateway staff of the case's hospital get the
 *   case's conversation: created on first use (tenantId, requestId,
 *   kind 'case', stored on the request as caseConversationId), or joined if
 *   another staff member started it. Joining adds the caller as a participant
 *   and writes an audit entry the patient sees in their access log. Reading
 *   stays "participants only" in the rules, so no list query leaks a thread.
 *
 * onConversationMessage — writes a thread's lastAt, preview and unread
 *   counters from each new message, on the server. Participants may change
 *   only their own read marker, so a patient can no longer move lastAt (the
 *   5-second reply throttle), the names staff see, or the preview (N13).
 */

const GATEWAY = ['super_admin', 'staff_admin']
const tenantOf = (d) => d?.tenantId || DEFAULT_HOSPITAL_ID

async function handleOpenCaseConversation({ callerUid, data, db, serverTimestamp = () => FieldValue.serverTimestamp(), arrayUnion = (...v) => FieldValue.arrayUnion(...v) }) {
  const caller = await loadCaller(db, callerUid)
  if (!GATEWAY.includes(caller.role) || !caller.tenantId) fail('permission-denied', "Only the hospital's staff can open a case conversation.")
  const requestId = data?.requestId
  if (typeof requestId !== 'string' || !requestId) fail('invalid-argument', 'A request is required.')
  const reqRef = db.doc(`requests/${requestId}`)

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef)
    if (!snap.exists) fail('not-found', 'That request no longer exists.')
    const r = snap.data()
    if (tenantOf(r) !== caller.tenantId) fail('permission-denied', 'That request belongs to another hospital.')
    if (!r.patientId) fail('failed-precondition', 'This request has no patient.')

    const existingRef = r.caseConversationId ? db.doc(`conversations/${r.caseConversationId}`) : null
    const existing = existingRef ? await tx.get(existingRef) : null
    // Join only the thread that really belongs to this case (a pointer can't
    // lead staff into another hospital's conversation).
    if (existing?.exists && existing.data().requestId === reqRef.id && tenantOf(existing.data()) === caller.tenantId) {
      const c = existing.data()
      if ((c.participants ?? []).includes(caller.uid)) return { id: existingRef.id, joined: false, request: r }
      tx.update(existingRef, {
        participants: arrayUnion(caller.uid),
        [`names.${caller.uid}`]: caller.name ?? '',
        [`roles.${caller.uid}`]: caller.role,
        [`unread.${caller.uid}`]: 0,
      })
      return { id: existingRef.id, joined: true, request: r }
    }

    const convRef = db.collection('conversations').doc()
    tx.set(convRef, {
      participants: [caller.uid, r.patientId],
      names: { [caller.uid]: caller.name ?? '', [r.patientId]: r.patientName ?? '' },
      roles: { [caller.uid]: caller.role, [r.patientId]: 'patient' },
      subject: `Re: Request ${r.requestId ?? ''}`.trim(),
      kind: 'case', tenantId: tenantOf(r), requestId: reqRef.id,
      lastMessage: '', lastAt: serverTimestamp(),
      unread: { [caller.uid]: 0, [r.patientId]: 0 },
      startedBy: caller.uid, startedAt: serverTimestamp(),
    })
    tx.update(reqRef, { caseConversationId: convRef.id, updatedAt: serverTimestamp() })
    return { id: convRef.id, joined: false, created: true, request: r }
  })

  if (out.joined) {
    // Shown to the patient in their access log (auditLog read: patientId == uid).
    await writeAudit(db, caller, {
      action: 'case_conversation_opened', targetType: 'conversation', targetId: out.id,
      targetName: out.request.requestId ?? '',
      details: `${caller.name ?? 'A staff member'} of the hospital's social-services office opened your case conversation.`,
      requestId, patientId: out.request.patientId, tenantId: tenantOf(out.request),
    }).catch((err) => logger.warn('[openCaseConversation] audit failed', { err: err?.message }))
  }
  return { conversationId: out.id, joined: !!out.joined, created: !!out.created }
}

async function handleConversationMessage({ db, conversationId, message, increment = (n) => FieldValue.increment(n), serverTimestamp = () => FieldValue.serverTimestamp() }) {
  if (!message?.from) return { skipped: 'no-sender' }
  const ref = db.doc(`conversations/${conversationId}`)
  const snap = await ref.get()
  if (!snap.exists) return { skipped: 'no-conversation' }
  const others = (snap.data().participants ?? []).filter((u) => u !== message.from)
  await ref.update({
    lastMessage: String(message.text ?? '').slice(0, 200),
    lastFrom: message.from,
    lastAt: message.createdAt ?? serverTimestamp(),
    [`unread.${message.from}`]: 0,
    ...Object.fromEntries(others.map((u) => [`unread.${u}`, increment(1)])),
  })
  return { conversationId, notified: others.length }
}

exports.handleOpenCaseConversation = handleOpenCaseConversation
exports.handleConversationMessage = handleConversationMessage

exports.openCaseConversation = onCall({ region: 'asia-southeast1', timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  try {
    await assertStaffMfa(getFirestore(), request.auth)
    return await handleOpenCaseConversation({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error('[openCaseConversation] failed', { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Try again.')
  }
})

exports.onConversationMessage = onDocumentCreated({
  document: 'conversations/{convId}/messages/{msgId}',
  region: 'asia-southeast1', timeoutSeconds: 30, memory: '256MiB',
}, async (event) => {
  try {
    return await handleConversationMessage({ db: getFirestore(), conversationId: event.params.convId, message: event.data?.data() })
  } catch (err) {
    logger.error('[onConversationMessage] failed', { convId: event.params.convId, err: err.message })
    return { failed: err.message }
  }
})
