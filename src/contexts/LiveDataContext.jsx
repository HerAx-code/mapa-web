import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  collection, query, where, orderBy, limit, onSnapshot, doc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './AuthContext'
import { ROLES } from '../utils/constants'

// LiveDataContext hoists the four onSnapshot subscriptions that Layout
// used to own (notifications, conversations, agency inbox count, agency
// name) above the route components, so navigating from /patient/dashboard
// to /patient/status no longer re-establishes any of them. Each page
// still wraps in <Layout>; Layout now reads counts and feeds from this
// context instead of opening its own listeners.
//
// Closes the L6 finding from docs/revision-list.md §B.13 -- the
// notification badge no longer flickers to 0 for ~100 ms on every
// navigation while a fresh snapshot is awaited.

const NOOP = () => {}

const LiveDataContext = createContext({
  notifications:        [],
  conversations:        [],
  agencyInboxCount:     0,
  liveAgencyName:       null,
  totalUnreadMessages:  0,
  // Phase 3.3: agencyMap is a { id -> agency } cache, populated by a
  // single onSnapshot here so individual pages don't fire N getDoc
  // calls when they need an agency name / color / initials. Killed the
  // N+1 in TrackStatus and unblocks any future page that needs cheap
  // agency lookups.
  agencyMap:            {},
  // Pub-sub for "a notification arrived that wasn't in the previous
  // snapshot." Layout subscribes to this to fire the toast affordance
  // without owning the underlying onSnapshot.
  subscribeToNewNotifications: () => NOOP,
})

export function LiveDataProvider({ children }) {
  const { user } = useAuth()

  const [notifications,    setNotifications]    = useState([])
  const [conversations,    setConversations]    = useState([])
  const [agencyInboxCount, setAgencyInboxCount] = useState(0)
  const [liveAgencyName,   setLiveAgencyName]   = useState(null)
  // Phase 3.3: agencyMap shared across pages. Anyone signed in can
  // read the agencies collection (rule: allow read: if true).
  const [agencyMap,        setAgencyMap]        = useState({})

  // null = initial load not yet completed -- the first onSnapshot
  // payload populates this set silently rather than firing a toast for
  // every existing notification. Persists across navigations because
  // this provider lives above the routes.
  const knownNotifIds = useRef(null)

  // List of callbacks registered by Layout (and conceptually any other
  // consumer) for "new notification arrived after the initial snapshot."
  // Stored in a ref so subscribers can come and go without triggering
  // provider re-renders.
  const newNotifSubscribers = useRef(new Set())

  // ── notifications ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setNotifications([])
      knownNotifIds.current = null
      return
    }
    const q = query(
      collection(db, 'notifications', user.uid, 'items'),
      orderBy('createdAt', 'desc'),
      limit(30),
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setNotifications(items)

      if (knownNotifIds.current === null) {
        knownNotifIds.current = new Set(items.map(i => i.id))
        return
      }
      const newItems = items.filter(i => !knownNotifIds.current.has(i.id))
      knownNotifIds.current = new Set(items.map(i => i.id))
      for (const notif of newItems) {
        for (const sub of newNotifSubscribers.current) {
          try { sub(notif) } catch (e) { console.warn('[LiveData] notif subscriber threw:', e) }
        }
      }
    }, (err) => console.error('[LiveData] notifications snapshot error:', err))
    return unsub
  }, [user?.uid])

  // ── conversations ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setConversations([])
      return
    }
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', user.uid),
    )
    const unsub = onSnapshot(q, snap => {
      setConversations(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.lastAt?.seconds ?? 0) - (a.lastAt?.seconds ?? 0)),
      )
    }, (err) => console.error('[LiveData] conversations snapshot error:', err))
    return unsub
  }, [user?.uid])

  const totalUnreadMessages = conversations.reduce(
    (sum, c) => sum + (c.unread?.[user?.uid] ?? 0),
    0,
  )

  // ── agency-only: inbox count + live agency name ─────────────────────
  useEffect(() => {
    const isAgency = user?.role === ROLES.AGENCY || user?.role === ROLES.AGENCY_ADMIN
    if (!isAgency || !user?.agencyId) {
      setAgencyInboxCount(0)
      setLiveAgencyName(null)
      return
    }
    const inboxQ = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
      where('status', 'in', ['pending', 'reviewing']),
    )
    const u1 = onSnapshot(inboxQ,
      snap => setAgencyInboxCount(snap.size),
      () => setAgencyInboxCount(0))
    const u2 = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => snap.exists() && setLiveAgencyName(snap.data().name),
      () => {})
    return () => { u1(); u2() }
  }, [user?.uid, user?.role, user?.agencyId])

  // ── agencyMap (Phase 3.3) ──────────────────────────────────────────
  // Single live snapshot on the agencies collection populates a
  // { id -> agency } map that any page can lookup synchronously.
  // Kills the N+1 pattern in patient/TrackStatus where each app row
  // fired its own getDoc(agencies/{id}). Agencies are publicly
  // readable per the parent collection rule, so this works for any
  // signed-in role. Bounded set (~10 agencies even at scale).
  useEffect(() => {
    if (!user?.uid) {
      setAgencyMap({})
      return
    }
    const unsub = onSnapshot(
      collection(db, 'agencies'),
      snap => {
        const m = {}
        snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } })
        setAgencyMap(m)
      },
      (err) => console.error('[LiveData] agencies snapshot error:', err),
    )
    return unsub
  }, [user?.uid])

  const subscribeToNewNotifications = (callback) => {
    newNotifSubscribers.current.add(callback)
    return () => { newNotifSubscribers.current.delete(callback) }
  }

  return (
    <LiveDataContext.Provider value={{
      notifications,
      conversations,
      agencyInboxCount,
      liveAgencyName,
      totalUnreadMessages,
      agencyMap,
      subscribeToNewNotifications,
    }}>
      {children}
    </LiveDataContext.Provider>
  )
}

export const useLiveData = () => useContext(LiveDataContext)
