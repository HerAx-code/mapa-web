import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

export const notify = (uid, { type, title, body }) =>
  addDoc(collection(db, 'notifications', uid, 'items'), {
    type, title, body, read: false, createdAt: serverTimestamp(),
  })
