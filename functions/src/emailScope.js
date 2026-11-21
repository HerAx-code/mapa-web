/**
 * Who may cause an email to whom (Phase 1, decision P1-A, 2026-11-21).
 *
 * A notification is always written in-app; this decides only whether
 * sendNotificationEmail also emails it. The patient side is strict: a patient
 * reaches only themselves, and a patient is emailed only by their own
 * hospital's staff or by an agency their case was endorsed to. Staff reach the
 * staff they work with: their own hospital, an agency and the staff of a
 * hospital it partners with, an agency's own team, and the Super Admin.
 *
 * Pure: the caller passes the two profiles and the partner hospitals of any
 * agency involved (agencies/{id}.partnerHospitalIds).
 */
const GATEWAY  = ['super_admin', 'staff_admin']
const AGENCY   = ['agency', 'agency_admin']
const PLATFORM = 'platform_admin'

const isGateway  = (u) => GATEWAY.includes(u?.role)
const isAgency   = (u) => AGENCY.includes(u?.role)
const isPlatform = (u) => u?.role === PLATFORM
const isPatient  = (u) => u?.role === 'patient'

// Every hospital a patient has filed with (marketplace), incl. a legacy single tenantId.
const hospitalsOf = (u) => [...new Set([...(Array.isArray(u?.tenantIds) ? u.tenantIds : []), ...(u?.tenantId ? [u.tenantId] : [])])]

const partnersOf = (partners, agencyId) => (agencyId && Array.isArray(partners?.[agencyId]) ? partners[agencyId] : [])

/**
 * @param sender     users doc of fromUid with `uid`, or null for a server event
 * @param recipient  users doc of the recipient with `uid`
 * @param partners   { [agencyId]: string[] } partner hospital ids
 * @returns { allowed: boolean, reason?: string }
 */
function mayEmail(sender, recipient, partners = {}) {
  if (!recipient) return { allowed: false, reason: 'no-recipient' }
  if (!recipient.email) return { allowed: false, reason: 'no-email' }
  if (recipient.active === false || recipient.deletion === true) return { allowed: false, reason: 'inactive-recipient' }
  if (!sender) return { allowed: true }                           // server event
  if (sender.uid && sender.uid === recipient.uid) return { allowed: true }

  const ok = (b) => (b ? { allowed: true } : { allowed: false, reason: 'out-of-scope' })

  if (isPatient(sender)) return ok(false)                          // only themselves (handled above)

  if (isGateway(sender)) {
    const t = sender.tenantId
    if (!t) return ok(false)
    if (isPatient(recipient))  return ok(hospitalsOf(recipient).includes(t))
    if (isGateway(recipient))  return ok(recipient.tenantId === t)
    if (isAgency(recipient))   return ok(partnersOf(partners, recipient.agencyId).includes(t))
    if (isPlatform(recipient)) return ok(true)
    return ok(false)
  }

  if (isAgency(sender)) {
    const a = sender.agencyId
    if (!a) return ok(false)
    if (isPatient(recipient))  return ok(Array.isArray(recipient.agencyIds) && recipient.agencyIds.includes(a))
    if (isAgency(recipient))   return ok(recipient.agencyId === a)
    if (isGateway(recipient))  return ok(!!recipient.tenantId && partnersOf(partners, a).includes(recipient.tenantId))
    if (isPlatform(recipient)) return ok(true)
    return ok(false)
  }

  if (isPlatform(sender)) {
    return ok(isGateway(recipient) || isAgency(recipient) || isPlatform(recipient))
  }

  return ok(false)
}

// P1-D: emails per sender per hour. Server events are not counted.
const emailLimitFor = (sender) => (isPatient(sender) ? 10 : 120)

module.exports = { mayEmail, emailLimitFor, hospitalsOf, GATEWAY, AGENCY }
