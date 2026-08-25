import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { MdBuildCircle, MdWarning, MdInfo } from 'react-icons/md'
import { db } from '../firebase'

// Visual config per announcement type. Single source of truth used by:
//   - components/AnnouncementBanner (the live banner + form preview)
//   - components/AnnouncementFeedCard (the dashboard card)
//   - pages/admin/Announcements (form pill buttons via pillActive/pillInact)
//   - pages/agency/Announcements (re-exports the form via admin)
//
// Previously colocated with the admin form, which created a circular
// import once Layout's live banner started pulling from the same map
// (Layout -> AnnouncementBanner -> admin/Announcements -> ...). Lifting
// the config out of any page file breaks the cycle.
export const TYPE_CONFIG = {
  maintenance: {
    label:      'Maintenance',
    icon:       MdBuildCircle,
    bg:         'bg-amber-50',
    border:     'border-amber-200',
    badge:      'bg-amber-100 text-amber-700',
    iconColor:  'text-amber-600',
    pillActive: 'bg-amber-500 text-white',
    pillInact:  'bg-white text-amber-700 border border-amber-300',
  },
  warning: {
    label:      'Warning',
    icon:       MdWarning,
    bg:         'bg-red-50',
    border:     'border-red-200',
    badge:      'bg-red-100 text-red-700',
    iconColor:  'text-red-600',
    pillActive: 'bg-red-500 text-white',
    pillInact:  'bg-white text-red-700 border border-red-300',
  },
  info: {
    label:      'Info',
    icon:       MdInfo,
    bg:         'bg-blue-50',
    border:     'border-blue-200',
    badge:      'bg-blue-100 text-blue-700',
    iconColor:  'text-blue-600',
    pillActive: 'bg-blue-500 text-white',
    pillInact:  'bg-white text-blue-700 border border-blue-300',
  },
}

// ── Surface + targetRoles (R38) ───────────────────────────────────────
// Two optional fields on announcement docs control where they render:
//   surface:     'banner' | 'feed' | 'both'   -- top strip vs dashboard card
//   targetRoles: array of role names            -- who sees it (UX filter only)
//
// Existing docs predate these fields, so we resolve defaults at read
// time instead of running a backfill. Migration rule:
//
//   - source === 'agency'  -> surface 'feed', targetRoles ['patient']
//                             (agency promotions never go in the top banner)
//   - otherwise            -> surface 'banner', targetRoles all non-admin
//                             (preserves the pre-R38 CRMC banner behavior;
//                              existing CRMC announcements do NOT suddenly
//                              start appearing on dashboards)
//
// targetRoles is NOT a security boundary. Firestore reads return the doc
// to any signed-in user; the client filters. Sensitive content does not
// go in this collection.
const DEFAULT_NON_ADMIN_ROLES = ['patient', 'agency', 'agency_admin']

export const computeSurface = (ann) => {
  if (ann.surface === 'banner' || ann.surface === 'feed' || ann.surface === 'both') {
    return ann.surface
  }
  return ann.source === 'agency' ? 'feed' : 'banner'
}

export const computeTargetRoles = (ann) => {
  if (Array.isArray(ann.targetRoles) && ann.targetRoles.length > 0) {
    return ann.targetRoles
  }
  return ann.source === 'agency' ? ['patient'] : DEFAULT_NON_ADMIN_ROLES
}

// Type priority for sorting on the feed card. Warnings float to the top
// regardless of recency; within a type, newest first.
const TYPE_PRIORITY = { warning: 0, maintenance: 1, info: 2 }

// localStorage dismissal helpers. Per-user key so different users on the
// same browser have independent dismissal sets. Pruning is opportunistic:
// the hook removes stale IDs (announcements no longer in the live set)
// each time it runs so the set doesn't grow forever.
const dismissKey = (uid) => `mapa.announcements.dismissed.${uid}`

const readDismissed = (uid) => {
  if (!uid) return []
  try {
    const raw = localStorage.getItem(dismissKey(uid))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeDismissed = (uid, ids) => {
  if (!uid) return
  try {
    localStorage.setItem(dismissKey(uid), JSON.stringify(ids))
  } catch { /* private mode / quota — silently no-op */ }
}

export const dismissAnnouncement = (uid, id) => {
  const set = new Set(readDismissed(uid))
  set.add(id)
  writeDismissed(uid, [...set])
}

// ── useFeedAnnouncements ──────────────────────────────────────────────
// Returns the announcements that should render in a dashboard "What's
// new" card for the given role. One Firestore listener on
// `announcements where active == true`; everything else is client-side.
//
// Filters (in order):
//   1. Time window: startAt <= now <= endAt
//   2. Surface: computed surface in {'feed', 'both'}
//   3. Audience:
//        - role in computeTargetRoles(ann), OR
//        - agency/agency_admin viewing their own agency's promotion
//          (so coordinators can verify what patients see)
//   4. Not in the user's localStorage dismissed set
//
// Sort: warning > maintenance > info, then createdAt desc.
//
// On Spark plan this stays cheap: ~5-10 docs in the collection, one
// listener per logged-in dashboard mount.
export const useFeedAnnouncements = ({ role, agencyId, uid }) => {
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!uid || !role) return
    const unsub = onSnapshot(
      query(collection(db, 'announcements'), where('active', '==', true)),
      (snap) => {
        const now = Date.now()
        const allLive = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        const dismissed = new Set(readDismissed(uid))

        // Prune dismissed IDs that no longer correspond to a live doc —
        // keeps the localStorage set from growing unbounded over months.
        const liveIds = new Set(allLive.map(a => a.id))
        const pruned = [...dismissed].filter(id => liveIds.has(id))
        if (pruned.length !== dismissed.size) writeDismissed(uid, pruned)
        const prunedSet = new Set(pruned)

        const filtered = allLive
          .filter(ann => {
            const start = ann.startAt?.toDate?.()?.getTime() ?? 0
            const end   = ann.endAt?.toDate?.()?.getTime()   ?? 0
            if (!(now >= start && now <= end)) return false

            const surface = computeSurface(ann)
            if (surface !== 'feed' && surface !== 'both') return false

            const roles = computeTargetRoles(ann)
            const isOwnPromo = ann.source === 'agency' && ann.agencyId === agencyId
            if (!roles.includes(role) && !isOwnPromo) return false

            if (prunedSet.has(ann.id)) return false
            return true
          })
          .sort((a, b) => {
            const pa = TYPE_PRIORITY[a.type] ?? 99
            const pb = TYPE_PRIORITY[b.type] ?? 99
            if (pa !== pb) return pa - pb
            const ca = a.createdAt?.toDate?.()?.getTime() ?? 0
            const cb = b.createdAt?.toDate?.()?.getTime() ?? 0
            return cb - ca
          })

        setItems(filtered)
      },
      (err) => {
        console.error('[useFeedAnnouncements] snapshot error:', err)
        setItems([])
      },
    )
    return () => unsub()
  }, [uid, role, agencyId])

  return items
}