import { describe, it, expect, vi, beforeEach } from 'vitest'

const setDoc = vi.fn(async () => {})
vi.mock('firebase/firestore', () => ({ doc: (_db, col, id) => `${col}/${id}`, setDoc: (...a) => setDoc(...a), serverTimestamp: () => 'TS' }))
vi.mock('../../src/firebase', () => ({ db: {} }))

// The public hospital list must never include the Training Hospital (onboarding
// practice with sample patients), whatever edits the Super Admin makes later.
describe('syncHospitalPublic', () => {
  beforeEach(() => setDoc.mockClear())

  it('publishes a real hospital', async () => {
    const { syncHospitalPublic } = await import('../../src/utils/hospitalsPublic.js')
    await syncHospitalPublic('crmc', { facilityName: 'CRMC', accessCodePrefix: 'CRMC', enabled: true })
    expect(setDoc).toHaveBeenCalledTimes(1)
    expect(setDoc.mock.calls[0][0]).toBe('hospitalsPublic/crmc')
  })

  it('never publishes the Training Hospital', async () => {
    const { syncHospitalPublic } = await import('../../src/utils/hospitalsPublic.js')
    await syncHospitalPublic('mapa-training-hospital', { facilityName: 'MAPA Training Hospital', enabled: true, onboarding: { stage: 'live', training: true } })
    expect(setDoc).not.toHaveBeenCalled()
  })
})
