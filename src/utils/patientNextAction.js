// The patient dashboard's "do this now" (review 2026-11-25). Pure, so it can be
// tested without Firebase: the Dashboard passes in what it has loaded.
//
// One action at a time, the most pressing first:
//   confirmEmail → hold → fixDoc → proceed → respond → collectGL
// The first two apply only when there is no active request (they block filing
// one); the rest only to the active request's own documents and slices, so a
// past case never asks for anything.
import { letterState, glDaysRemaining } from '../shared/caseState'

// The active request's documents: the ones attached to it, plus uploads made
// for it after filing. A document replaced by a corrected upload (`supersedes`)
// is left out; the correction stands in for it.
export function caseDocuments(request, docs = []) {
  if (!request) return []
  const attached = new Set(
    (request.attachedDocuments ?? []).map((a) => a?.documentId ?? a?.id).filter(Boolean),
  )
  const superseded = new Set((docs ?? []).map((d) => d?.supersedes).filter(Boolean))
  return (docs ?? []).filter((d) =>
    d && !superseded.has(d.id) && (attached.has(d.id) || d.requestId === request.id))
}

const agencyNames = (slices) =>
  [...new Set(slices.map((s) => s.agencyName).filter(Boolean))].join(', ')

export function patientNextAction({
  activeRequest = null, slices = [], docs = [], cooldown = 0, emailUnconfirmed = false, now = Date.now(),
} = {}) {
  if (!activeRequest) {
    if (emailUnconfirmed) return { kind: 'confirmEmail', path: '/patient/request' }
    if (Number(cooldown) > 0) return { kind: 'hold', path: '/patient/messages' }
    return null
  }

  const rejected = caseDocuments(activeRequest, docs).find((d) => d.status === 'rejected')
  if (rejected) {
    return { kind: 'fixDoc', path: '/patient/request', detail: rejected.documentTypeName ?? rejected.name ?? '' }
  }

  const own = (slices ?? []).filter((s) => s?.requestId === activeRequest.id)

  const offers = own.filter((s) => s.status === 'endorsed')
  if (offers.length) return { kind: 'proceed', path: '/patient/status', detail: agencyNames(offers), count: offers.length }

  const asking = own.find((s) => s.status === 'awaiting_info')
  if (asking) return { kind: 'respond', path: '/patient/status', detail: asking.agencyName ?? '' }

  const letters = own
    .filter((s) => ['valid', 'expiring'].includes(letterState(s, now)))
    .sort((a, b) => (glDaysRemaining(a, now) ?? 0) - (glDaysRemaining(b, now) ?? 0))
  if (letters.length) {
    return {
      kind: 'collectGL', path: '/patient/status',
      detail: letters[0].agencyName ?? '', days: glDaysRemaining(letters[0], now),
    }
  }
  return null
}
