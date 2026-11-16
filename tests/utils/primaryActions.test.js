import { describe, it, expect } from 'vitest'
import { getPrimaryActions } from '../../src/pages/agency/applicationDetail/primaryActions.js'

// 2026-11-16: the letter (glStatus) exists from approval, so the agency can
// record its use or release it before clicking Mark as Issued.
const h = {
  handlePrintGL: () => {}, handleReverseApproval: () => {}, handleRedeemGL: () => {}, handleExpireGL: () => {},
  setShowUpload: () => {},
}
const labels = (ctx) => getPrimaryActions({ handlers: h, expired: false, expiringSoon: false, signedScan: null, ...ctx }).actions.map(a => a.label)

describe('getPrimaryActions — letters before Mark as Issued', () => {
  it('offers Print, and Mark GL Redeemed once the signed letter is uploaded', () => {
    expect(labels({ app: { status: 'approved', glStatus: 'issued' } })).toEqual(['Print Guarantee Letter', 'Reverse Approval'])
    expect(labels({ app: { status: 'approved', glStatus: 'issued' }, signedScan: { id: 'x' } }))
      .toEqual(['Print Guarantee Letter', 'Mark GL Redeemed', 'Reverse Approval'])
  })

  it('offers Mark GL Expired for an overdue letter still at approved', () => {
    expect(labels({ app: { status: 'approved', glStatus: 'issued' }, expired: true })).toEqual(['Mark GL Expired', 'Reverse Approval'])
  })

  it('treats a used or expired letter as final at approved', () => {
    expect(getPrimaryActions({ app: { status: 'approved', glStatus: 'redeemed' }, handlers: h }).hint).toMatch(/Case complete/)
    expect(getPrimaryActions({ app: { status: 'approved', glStatus: 'expired' }, handlers: h }).hint).toMatch(/GL expired/)
  })
})
