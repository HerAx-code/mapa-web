/**
 * Address utilities (Phase 3.6).
 *
 * Source-of-truth policy for user / patient addresses:
 *   1. Structured fields (`barangay`, `city`, `province`) are canonical.
 *      They are written by patient/auth/Register on registration and by
 *      components/ProfileModals on edit. The structured form survives
 *      schema changes (e.g. promoting barangay to its own object) and
 *      is what tools like address-validation or postal-code lookup
 *      would consume.
 *   2. The flat `address` field is a DERIVED mirror, kept for display
 *      surfaces that pre-date the structured fields (GL render, intake
 *      sheet print, CSV exports, etc.).
 *
 * `formatUserAddress(user)` prefers the structured fields and falls
 * back to the flat string. New display sites should call this helper
 * so a future migration that drops the flat mirror only has to touch
 * one file.
 *
 * Existing call sites that still read `user.address` directly continue
 * to work because R39 keeps both fields in sync on every save.
 */

import { joinAddress } from '../components/AddressPicker'

export const formatUserAddress = (user) => {
  if (!user) return ''
  // Prefer the structured fields if any of them is set; joinAddress
  // tolerates missing pieces and produces "Bgy. X, City, Province"
  // with the comma layout the GL has always used.
  const structured = joinAddress({
    barangay: user.barangay,
    city:     user.city,
    province: user.province,
  })
  if (structured) return structured
  // Fallback for legacy docs (registered before R39 + never re-edited).
  return user.address ?? ''
}
