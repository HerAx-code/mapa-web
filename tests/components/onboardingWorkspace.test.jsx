/**
 * The Super Admin's hospital onboarding workspace renders each stage and keeps
 * "Complete" disabled until the stage's checklist is done.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const REQUEST = {
  hospitalName: 'Datu Odin Sinsuat District Hospital', hospitalType: 'BARMM MOH', region: 'BARMM',
  contactName: 'Ana', contactPosition: 'MSW head', email: 'mss@dosdh.example', officialPhone: '064-000',
  status: 'contacted', stage: 'verification', createdAt: { toDate: () => new Date('2026-11-10') },
  documents: { loi: { name: 'loi.pdf', path: 'onboarding/r1/loi.pdf', uploadedAt: '2026-11-11T00:00:00Z', by: 'Super' } },
}

vi.mock('../../src/components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'plat', name: 'Super', role: 'platform_admin' } }) }))
vi.mock('../../src/firebase', () => ({ db: {}, storage: {} }))
vi.mock('../../src/utils/auditLog', () => ({ logAudit: vi.fn() }))
vi.mock('../../src/utils/hospitalsPublic', () => ({ syncHospitalPublic: vi.fn() }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ col, id }),
  collection: vi.fn(), query: vi.fn(), where: vi.fn(),
  getDocs: async () => ({ docs: [] }),
  onSnapshot: (ref, cb) => { cb({ exists: () => ref.col === 'onboardingRequests', id: ref.id, data: () => REQUEST }); return () => {} },
  updateDoc: vi.fn(), serverTimestamp: () => 'TS', arrayUnion: (...a) => a, writeBatch: vi.fn(),
}))

const renderAt = async () => {
  const { default: OnboardingWorkspace } = await import('../../src/pages/platform/OnboardingWorkspace')
  render(
    <MemoryRouter initialEntries={['/platform/onboarding/r1']}>
      <Routes><Route path="/platform/onboarding/:id" element={<OnboardingWorkspace />} /></Routes>
    </MemoryRouter>,
  )
}

describe('OnboardingWorkspace', () => {
  it('opens on the current stage with its checklist and contacts', async () => {
    await renderAt()
    expect(screen.getByRole('heading', { name: 'Datu Odin Sinsuat District Hospital' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Verification' })).toBeTruthy()
    expect(screen.getByText(/NHFR facility code checked against the DOH registry/)).toBeTruthy()
    expect(screen.getByText('mss@dosdh.example')).toBeTruthy()
    // checklist not done → can't complete the stage
    expect(screen.getByRole('button', { name: /Complete Verification/ }).disabled).toBe(true)
  })

  it('shows who signs for this hospital type on the Agreement stage', async () => {
    await renderAt()
    screen.getByRole('button', { name: 'Agreement' }).click()
    expect(await screen.findByText(/Minister of Health or delegated Chief of Hospital/)).toBeTruthy()
    expect(screen.getByText(/Data processing agreement \(DPA IRR Sec. 44\)/)).toBeTruthy()
  })

  it('the go-live review lists the gate and keeps go-live disabled', async () => {
    await renderAt()
    screen.getByRole('button', { name: 'Live' }).click()
    const btn = await screen.findByRole('button', { name: /Approve go-live and open registration/ })
    expect(btn.disabled).toBe(true)
  })
})
