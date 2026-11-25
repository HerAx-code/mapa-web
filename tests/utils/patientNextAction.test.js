// The patient dashboard's "do this now" (review 2026-11-25).
import { describe, it, expect } from 'vitest'
import { patientNextAction, caseDocuments } from '../../src/utils/patientNextAction'

const NOW = Date.UTC(2026, 10, 25, 4)
const DAY = 86_400_000
const req = { id: 'r1', status: 'endorsed', attachedDocuments: [{ documentId: 'd1', status: 'verified' }, { documentId: 'd2', status: 'rejected' }] }

describe('caseDocuments', () => {
  it('keeps only the active case\'s documents', () => {
    const docs = [
      { id: 'd1', status: 'verified' },
      { id: 'old', status: 'rejected', requestId: 'r0' },   // a past case
      { id: 'late', status: 'pending', requestId: 'r1' },   // added after filing
      { id: 'draft', status: 'pending' },                   // never attached
    ]
    expect(caseDocuments(req, docs).map(d => d.id)).toEqual(['d1', 'late'])
  })

  it('drops a document replaced by a corrected upload', () => {
    const docs = [{ id: 'd2', status: 'rejected' }, { id: 'd3', status: 'pending', requestId: 'r1', supersedes: 'd2' }]
    expect(caseDocuments(req, docs).map(d => d.id)).toEqual(['d3'])
  })

  it('is empty with no active request', () => {
    expect(caseDocuments(null, [{ id: 'd1' }])).toEqual([])
  })
})

describe('patientNextAction', () => {
  it('nothing to do for a new patient', () => {
    expect(patientNextAction({})).toBeNull()
  })

  it('asks a new account to confirm its email before anything else', () => {
    expect(patientNextAction({ emailUnconfirmed: true, cooldown: 1 }).kind).toBe('confirmEmail')
  })

  it('explains a holding period', () => {
    expect(patientNextAction({ cooldown: 1 })).toMatchObject({ kind: 'hold', path: '/patient/messages' })
  })

  it('a past case\'s rejected document asks for nothing', () => {
    const docs = [{ id: 'old', status: 'rejected', requestId: 'r0' }]
    expect(patientNextAction({ docs })).toBeNull()
    expect(patientNextAction({ activeRequest: { id: 'r1', attachedDocuments: [] }, docs })).toBeNull()
  })

  it('a rejected document on the active case comes first', () => {
    const docs = [{ id: 'd2', status: 'rejected', documentTypeName: 'Medical certificate' }]
    const slices = [{ requestId: 'r1', status: 'endorsed', agencyName: 'A' }]
    expect(patientNextAction({ activeRequest: req, docs, slices })).toMatchObject({ kind: 'fixDoc', detail: 'Medical certificate' })
  })

  it('no rejected-document prompt once a correction is uploaded', () => {
    const docs = [{ id: 'd2', status: 'rejected' }, { id: 'd3', status: 'pending', requestId: 'r1', supersedes: 'd2' }]
    expect(patientNextAction({ activeRequest: req, docs })).toBeNull()
  })

  it('an agency offer waiting for Proceed is flagged, with the agencies named', () => {
    const slices = [
      { requestId: 'r1', status: 'endorsed', agencyName: 'PCSO' },
      { requestId: 'r1', status: 'endorsed', agencyName: 'DSWD' },
      { requestId: 'r0', status: 'endorsed', agencyName: 'Other case' },
    ]
    expect(patientNextAction({ activeRequest: req, slices })).toMatchObject({ kind: 'proceed', count: 2, detail: 'PCSO, DSWD', path: '/patient/status' })
  })

  it('an agency question comes after offers', () => {
    const slices = [{ requestId: 'r1', status: 'awaiting_info', agencyName: 'PCSO' }]
    expect(patientNextAction({ activeRequest: req, slices })).toMatchObject({ kind: 'respond', detail: 'PCSO' })
  })

  it('an open Guarantee Letter is shown with its days left (soonest first)', () => {
    const slices = [
      { requestId: 'r1', status: 'approved', glStatus: 'issued', agencyName: 'Later', glExpiresAt: new Date(NOW + 8 * DAY) },
      { requestId: 'r1', status: 'certificate', glStatus: 'issued', agencyName: 'Sooner', glExpiresAt: new Date(NOW + 3 * DAY) },
      { requestId: 'r1', status: 'certificate', glStatus: 'redeemed', agencyName: 'Used' },
    ]
    const a = patientNextAction({ activeRequest: req, slices, now: NOW })
    expect(a.kind).toBe('collectGL')
    expect(a.detail).toBe('Sooner')
    expect(a.days).toBeGreaterThanOrEqual(1)
  })

  it('nothing while the hospital or an agency has the case', () => {
    const slices = [{ requestId: 'r1', status: 'reviewing' }]
    expect(patientNextAction({ activeRequest: req, slices, docs: [{ id: 'd1', status: 'verified' }] })).toBeNull()
  })
})
