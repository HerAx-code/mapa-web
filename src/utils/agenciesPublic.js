import { doc, setDoc, deleteDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * agenciesPublic — client-side mirror of the public agency projection.
 *
 * WHY THIS EXISTS (and why it duplicates the Cloud Function)
 *
 * The public Landing teaser reads `agenciesPublic/{id}` (name + slots + enabled
 * only) because the rich `agencies` doc is auth-gated — it carries budget /
 * fundSource / contacts (audit SEC-3). The authoritative sync is the
 * `onAgencyWritten` Cloud Function, but Cloud Functions are NOT deployed on the
 * live project (see the client-side daily-reset fallback in admin/Requests.jsx —
 * "until the scheduled Cloud Function is deployable"). With the function dark,
 * nothing kept the mirror current: every admin slot/enabled edit landed on
 * `agencies` but never reached `agenciesPublic`, so the Landing page showed a
 * frozen projection ("Full / 0 of 0", disabled agencies still listed).
 *
 * So every client path that changes an agency's PUBLIC fields now also writes
 * this mirror — belt-and-suspenders, exactly like the slot-reset fallback. If
 * the function is ever deployed it simply becomes the authoritative writer and
 * these client writes are redundant-but-harmless (same projection).
 *
 * Keep projectPublicAgency() byte-identical to the copies in
 * functions/src/onAgencyWritten.js and scripts/backfill-agencies-public.js.
 * Firestore rules (agenciesPublic match) constrain writes to exactly these
 * fields, so this can never leak budget/contacts even from a compromised client.
 */

// The exact public projection. Only non-sensitive fields — never budget /
// fundSource / contacts / signatories. `initials` + `color` drive the Landing
// AgencyAvatar (without them it falls back to a flat gray block), and `location`
// is the public office area shown under the name.
export function projectPublicAgency(data = {}) {
  const slots = data.slots ?? {}
  return {
    name:     data.name ?? '',
    initials: data.initials ?? '',
    color:    data.color ?? '',
    location: data.location ?? '',
    enabled:  data.enabled !== false, // default-enabled unless explicitly false
    slots: {
      total:     Number(slots.total) || 0,
      remaining: Number(slots.remaining) || 0,
    },
  }
}

/**
 * Best-effort mirror write for a single agency. Pass the FULL post-write agency
 * shape ({ name, enabled, slots: { total, remaining } }) so the projection
 * matches the source doc. Never throws — a failed mirror must not break (or roll
 * back) the primary agency write that already succeeded.
 */
export async function syncAgencyPublic(agencyId, agencyData) {
  if (!agencyId) return
  try {
    await setDoc(
      doc(db, 'agenciesPublic', agencyId),
      { ...projectPublicAgency(agencyData), updatedAt: serverTimestamp() },
      { merge: true },
    )
  } catch (err) {
    // Degraded, never broken: the Landing teaser tolerates a briefly-stale
    // mirror. Surfaced to the console for operators, not to the user.
    console.error('[syncAgencyPublic] mirror failed for', agencyId, err)
  }
}

/**
 * Resync the public projection for a list of agency docs ({ id, ...data }).
 * Backs the admin "Resync public programs" action — a one-click repair for the
 * current stale mirror without needing service-account creds / the backfill
 * script. Returns { ok, failed } counts. Never throws.
 */
export async function syncAllAgenciesPublic(agencies = []) {
  let ok = 0
  let failed = 0
  for (const a of agencies) {
    try {
      await setDoc(
        doc(db, 'agenciesPublic', a.id),
        { ...projectPublicAgency(a), updatedAt: serverTimestamp() },
        { merge: true },
      )
      ok++
    } catch (err) {
      console.error('[syncAllAgenciesPublic] failed for', a.id, err)
      failed++
    }
  }
  return { ok, failed }
}

/**
 * Full reconcile of the public projection against the live agency set. Writes a
 * projection for every current agency AND deletes any agenciesPublic doc whose
 * agency no longer exists (an orphan left behind when an agency is deleted — its
 * mirror delete may have been blocked by not-yet-deployed rules, so it keeps
 * showing on the public Landing). Backs the admin "Resync public" action.
 * Returns { ok, pruned, failed }. Never throws.
 */
export async function reconcileAgenciesPublic(agencies = []) {
  const { ok, failed } = await syncAllAgenciesPublic(agencies)
  let pruned = 0
  let pruneFailed = 0
  try {
    const liveIds = new Set(agencies.map(a => a.id))
    const snap = await getDocs(collection(db, 'agenciesPublic'))
    for (const d of snap.docs) {
      if (liveIds.has(d.id)) continue
      try {
        await deleteDoc(doc(db, 'agenciesPublic', d.id))
        pruned++
      } catch (err) {
        console.error('[reconcileAgenciesPublic] prune failed for', d.id, err)
        pruneFailed++
      }
    }
  } catch (err) {
    // Can't read the projection to find orphans — writes still happened.
    console.error('[reconcileAgenciesPublic] orphan scan failed', err)
  }
  return { ok, pruned, failed: failed + pruneFailed }
}
