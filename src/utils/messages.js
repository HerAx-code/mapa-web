import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore'
import { db, functions, httpsCallable } from '../firebase'
import { withTenant } from './hospitals'

// R7 (2026-06-03): defaults for `names` and `roles` are required because
// Firestore rejects undefined field values on addDoc. Some call sites pass
// roles, others don't (e.g. the patient compose modal only knows participant
// names, not their roles). Without these defaults the addDoc fails with
// "Unsupported field value: undefined (found in field roles in document
// conversations/...)" and the entire conversation never gets created.
export const getOrCreateConversation = async (uid1, uid2, { names = {}, roles = {}, subject = '' } = {}) => {
  const snap = await getDocs(
    query(collection(db, 'conversations'), where('participants', 'array-contains', uid1))
  )
  const existing = snap.docs.find(d => d.data().participants.includes(uid2))
  if (existing) return existing.id

  // Gateway-started threads carry the gateway's tenant (multi-hospital
  // Phase 2); agency-started ones have none (agencies are network-level).
  const ref = await addDoc(collection(db, 'conversations'), withTenant({
    participants: [uid1, uid2],
    names,
    roles,
    subject,
    lastMessage: '',
    lastAt:      serverTimestamp(),
    unread:      { [uid1]: 0, [uid2]: 0 },
  }))
  return ref.id
}

// Phase 3 PR 3.3 (gap N13): the thread's lastAt, preview and unread counters
// are written on the server from each new message (onConversationMessage), so
// no participant can move lastAt or rewrite the preview. `toUid` is kept in
// the signature for callers; the server counts every other participant.
// eslint-disable-next-line no-unused-vars
export const sendMessage = async (conversationId, { from, fromName, text, toUid }) => {
  await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
    from, fromName, text, createdAt: serverTimestamp(),
  })
}

// Phase 3 PR 3.3 (P3-C / D11): the hospital's conversation with the patient
// about one case belongs to the case. Gateway staff open it here: created on
// first use, or joined (the patient sees who opened it in their access log).
export const openCaseConversation = async (requestId) => {
  const res = await httpsCallable(functions, 'openCaseConversation')({ requestId })
  return res.data.conversationId
}
