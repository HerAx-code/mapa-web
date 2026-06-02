import { collection, addDoc, updateDoc, doc, serverTimestamp, increment, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'

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

  const ref = await addDoc(collection(db, 'conversations'), {
    participants: [uid1, uid2],
    names,
    roles,
    subject,
    lastMessage: '',
    lastAt:      serverTimestamp(),
    unread:      { [uid1]: 0, [uid2]: 0 },
  })
  return ref.id
}

export const sendMessage = async (conversationId, { from, fromName, text, toUid }) => {
  await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
    from, fromName, text, createdAt: serverTimestamp(),
  })
  await updateDoc(doc(db, 'conversations', conversationId), {
    lastMessage:          text,
    lastFrom:             from,
    lastAt:               serverTimestamp(),
    [`unread.${toUid}`]: increment(1),
    [`unread.${from}`]:  0,
  })
}
