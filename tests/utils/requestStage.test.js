import { describe, it, expect } from 'vitest'
import { deriveRequestStage, CRMC_STAGE_KEYS } from '../../src/utils/requestStage.js'

const completeIntake = {
  householdSize: 4, monthlyIncome: 8000, diagnosis: 'Pneumonia',
  recommendation: 'Endorse to DOH', meansTestCategory: 'C3', completedBy: 'MSW Cruz',
}
const verified = [{ status: 'verified' }, { status: 'verified' }]
const partial  = [{ status: 'verified' }, { status: 'pending' }]

const stageStatus = (r, docs) =>
  Object.fromEntries(deriveRequestStage(r, docs).stages.map(s => [s.key, s.status]))

describe('deriveRequestStage', () => {
  it('a fresh submitted request sits at verify, endorse blocked', () => {
    const r = deriveRequestStage({ status: 'submitted' }, partial)
    expect(r.current).toBe('verify')
    expect(r.canEndorse).toBe(false)
    expect(r.docsVerified).toBe(false)
    expect(stageStatus({ status: 'submitted' }, partial)).toMatchObject({ verify: 'current', endorse: 'blocked' })
  })

  it('advances to assess once all docs verified', () => {
    const r = deriveRequestStage({ status: 'under_review' }, verified)
    expect(r.docsVerified).toBe(true)
    expect(r.current).toBe('assess')
    expect(stageStatus({ status: 'under_review' }, verified).verify).toBe('done')
  })

  it('advances to interview once docs + intake are done', () => {
    const r = deriveRequestStage({ status: 'assessment', intakeSheet: completeIntake }, verified)
    expect(r.intakeComplete).toBe(true)
    expect(r.current).toBe('interview')
  })

  it('reaches endorse only when docs + intake + interview outcome are all done', () => {
    const req = { status: 'assessment', intakeSheet: completeIntake, interviewOutcome: 'eligible' }
    const r = deriveRequestStage(req, verified)
    expect(r.canEndorse).toBe(true)
    expect(r.current).toBe('endorse')
    expect(r.blockers).toEqual([])
    expect(stageStatus(req, verified).endorse).toBe('current')
  })

  it('matches the original inline gate exactly (allVerified && interviewOutcome && intakeComplete)', () => {
    // Missing just the interview outcome → still blocked.
    const r = deriveRequestStage({ status: 'assessment', intakeSheet: completeIntake }, verified)
    expect(r.canEndorse).toBe(false)
    expect(r.blockers.map(b => b.key)).toEqual(['interview'])
  })

  it('lists the exact remaining blockers with jump targets', () => {
    const r = deriveRequestStage({ status: 'submitted' }, partial) // nothing done
    expect(r.blockers.map(b => b.key)).toEqual(['verify', 'assess', 'interview'])
    expect(r.blockers[0]).toMatchObject({ key: 'verify', label: 'Verify documents', detail: '1/2 verified' })
  })

  it('reports no active stage for terminal requests', () => {
    for (const status of ['fully_funded', 'closed', 'rejected']) {
      const r = deriveRequestStage({ status, intakeSheet: completeIntake, interviewOutcome: 'x' }, verified)
      expect(r.terminal).toBe(true)
      expect(r.current).toBeNull()
    }
  })

  it('treats a request with no documents as not verified', () => {
    const r = deriveRequestStage({ status: 'submitted' }, [])
    expect(r.docsVerified).toBe(false)
    expect(r.stages.find(s => s.key === 'verify').detail).toBe('No documents')
  })

  it('always returns the four stages in order', () => {
    const r = deriveRequestStage({ status: 'submitted' }, [])
    expect(r.stages.map(s => s.key)).toEqual(CRMC_STAGE_KEYS)
  })
})
