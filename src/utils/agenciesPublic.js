import { functions, httpsCallable } from '../firebase'

/**
 * agenciesPublic — the public agency listing (Phase 1, N10 — 2026-11-21).
 *
 * `agenciesPublic/{id}` is written ONLY by the onAgencyWritten Cloud Function
 * (functions/src/onAgencyWritten.js projectPublicAgency); the rules refuse
 * browsers. It carries the public profile (name, location, description,
 * procedure, processing time), assistance types, document requirements,
 * partner hospitals and slot counts — never budget, fund source, caps,
 * contacts or slot history.
 *
 * Patients read this listing instead of the full `agencies` record, which the
 * rules no longer let them read. The browser mirror writes that used to live
 * here (syncAgencyPublic and friends) were removed: the function now runs on
 * the live project, and two writers had already drifted apart.
 */

/**
 * A public listing doc in the shape of an `agencies` doc, so the existing
 * helpers (effectiveSlots, agencyPartnersWith, missingAgencyDocs) work on it
 * unchanged. The listing's `slots` is the sum of all daily capacity (for the
 * Landing teaser); the agency-wide counts effectiveSlots() falls back to are in
 * `agencySlots`.
 */
export const agencyFromPublic = (d) => {
  if (!d) return d
  const { agencySlots, ...rest } = d
  return { ...rest, slots: agencySlots ?? d.slots ?? { total: 0, remaining: 0 } }
}

// The Super Admin's "Resync public" — rewrites the whole listing on the server.
export async function resyncAgenciesPublic() {
  const res = await httpsCallable(functions, 'resyncAgenciesPublic')({})
  return res?.data ?? { written: 0, pruned: 0 }
}
