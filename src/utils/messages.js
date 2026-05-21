import { collection, addDoc, updateDoc, doc, serverTimestamp, increment, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'

export const getOrCreateConversation = async (uid1, uid2, { names, roles, subject = '' }) => {
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
