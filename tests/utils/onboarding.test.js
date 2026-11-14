import { describe, it, expect } from 'vitest'
import {
  stageOf, stageChecklist, stageComplete, goLiveGate, canGoLive, complianceReminders, needsAttention, ownershipOf,
} from '../../src/utils/onboarding.js'

// Hospital onboarding (reports/Hospital onboarding requirements.md, revalidated).
const doc = (key) => ({ path: `onboarding/r/${key}.pdf`, name: `${key}.pdf` })
const ready = {
  documents: { loi: doc('loi'), authority: doc('authority'), moa: doc('moa'), dpa: doc('dpa'), dpo: doc('dpo'), pia: doc('pia'), golive: doc('golive') },
  verification: { nhfrCode: 'X1', nhfrChecked: true, ltoNumber: 'LTO-1', ltoExpiry: '2027-12-31', philhealthNo: 'P-1', ownershipType: 'DOH-retained', callbackAt: '2026-11-15T01:00:00Z' },
  agreement: { moaSignedAt: '2026-11-20', moaTermEnd: '2027-11-20', noProcureClause: true, dpoName: 'D', dpoEmail: 'd@h.ph', planTier: 'pilot' },
  training: { trainedCount: 4, uatPassedAt: '2026-12-01' },
  hospitalId: 'h1',
}
const ctx = { adminCount: 2, partnerCount: 1 }

describe('stageOf', () => {
  it('maps old statuses onto stages', () => {
    expect(stageOf({ status: 'new' })).toBe('interest')
    expect(stageOf({ status: 'contacted' })).toBe('verification')
    expect(stageOf({ status: 'onboarded' })).toBe('setup')
    expect(stageOf({ status: 'declined' })).toBe('declined')
    expect(stageOf({ status: 'onboarded', stage: 'live' })).toBe('live')
  })
})

describe('stage checklists', () => {
  it('interest needs the letter of intent', () => {
    expect(stageComplete('interest', {})).toBe(false)
    expect(stageComplete('interest', { documents: { loi: doc('loi') } })).toBe(true)
  })

  it('verification needs the registry check, license, PhilHealth, ownership and a call-back', () => {
    expect(stageComplete('verification', ready)).toBe(true)
    expect(stageComplete('verification', { ...ready, verification: { ...ready.verification, callbackAt: null } })).toBe(false)
    // not accredited is a valid answer
    expect(stageComplete('verification', { ...ready, verification: { ...ready.verification, philhealthNo: '', philhealthNone: true } })).toBe(true)
  })

  it('agreement needs the MOA with its term + no-purchase clause, DPA, DPO and PIA — not a DSA', () => {
    expect(stageComplete('agreement', ready)).toBe(true)
    expect(stageComplete('agreement', { ...ready, agreement: { ...ready.agreement, noProcureClause: false } })).toBe(false)
    expect(stageComplete('agreement', { ...ready, documents: { ...ready.documents, pia: undefined } })).toBe(false)
  })

  it('setup needs a backup admin and a partner funder', () => {
    expect(stageComplete('setup', ready, ctx)).toBe(true)
    expect(stageComplete('setup', ready, { adminCount: 1, partnerCount: 1 })).toBe(false)
    expect(stageComplete('setup', ready, { adminCount: 2, partnerCount: 0 })).toBe(false)
  })
})

describe('go-live gate', () => {
  it('opens only when every earlier stage is complete', () => {
    expect(canGoLive(ready, ctx)).toBe(true)
    expect(canGoLive({ ...ready, documents: { ...ready.documents, golive: undefined } }, ctx)).toBe(false)
    expect(goLiveGate({}, ctx).every(i => !i.done || ['admins', 'partners'].includes(i.key))).toBe(true)
  })
})

describe('compliance reminders after go-live', () => {
  const now = new Date('2026-12-20T00:00:00Z')
  it('NPC registration is due 20 days after go-live', () => {
    const live = { ...ready, liveAt: '2026-11-25T00:00:00Z' }
    const npc = complianceReminders(live, now).find(x => x.key === 'npc')
    expect(npc.state).toBe('overdue')
    expect(needsAttention(live, now)).toBe(true)
    const done = { ...live, agreement: { ...live.agreement, npcRegisteredAt: '2026-12-01' } }
    expect(complianceReminders(done, now).find(x => x.key === 'npc').done).toBe(true)
  })

  it('flags expiries within 30 days', () => {
    const soon = { ...ready, verification: { ...ready.verification, ltoExpiry: '2027-01-05' } }
    expect(complianceReminders(soon, now).find(x => x.key === 'lto').state).toBe('soon')
  })
})

describe('ownershipOf', () => {
  it('names who signs per hospital type', () => {
    expect(ownershipOf('LGU').signer).toMatch(/Governor or Mayor/)
    expect(ownershipOf('unknown').value).toBe('Other')
  })
})
