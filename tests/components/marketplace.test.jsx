/**
 * Patient marketplace (docs/patient-marketplace-plan.md): the "Choose a
 * hospital" page compares hospitals, and the request flow's hospital gate
 * claims the chosen hospital's access code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

const DATA = {
  hospitalsPublic: [
    { id: 'hospital-1', facilityName: 'Cotabato Regional Medical Center', shortName: 'CRMC', accessCodePrefix: 'CRMC', enabled: true,
      gatewayName: 'Medical Social Service', address: 'Sinsuat Ave, Cotabato City', region: 'BARMM', contactEmail: 'mss@crmc.ph' },
    { id: 'bgh', facilityName: 'Bangsamoro General Hospital', shortName: 'BGH', accessCodePrefix: 'BGH', enabled: true },
  ],
  agencies: [
    { id: 'dswd', name: 'DSWD', enabled: true, partnerHospitalIds: ['hospital-1', 'bgh'], assistanceTypes: ['Medical'], slots: { total: 10, remaining: 4 } },
    { id: 'pcso', name: 'PCSO', enabled: true, partnerHospitalIds: ['hospital-1'], assistanceTypes: ['Dialysis'], slots: { total: 5, remaining: 5 } },
  ],
  hospitalsPublicStats: [{ id: 'hospital-1', turnaroundDays: 3.4, basedOn: 12 }, { id: 'bgh', turnaroundDays: null, basedOn: 2 }],
  requests: [],
}
const snap = (name) => ({ docs: (DATA[name] ?? []).map((d) => ({ id: d.id, data: () => d })) })

const user = { uid: 'p1', role: 'patient', name: 'Ana' }
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('../../src/components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  query: (c) => c,
  where: () => ({}),
  getDocs: async (q) => snap(q.name),
  onSnapshot: (q, cb) => { cb(snap(q.name)); return () => {} },
}))
const checkAccessCode = vi.fn()
const claimAccessCode = vi.fn()
vi.mock('../../src/utils/accessCodes', () => ({
  PENDING_CODE_KEY: 'k',
  normalizeCode: (s) => String(s).trim().toUpperCase(),
  checkAccessCode: (...a) => checkAccessCode(...a),
  claimAccessCode: (...a) => claimAccessCode(...a),
}))

const wrap = (ui) => render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>)

beforeEach(async () => {
  checkAccessCode.mockReset(); claimAccessCode.mockReset()
  await i18n.changeLanguage('en')
})

describe('Choose a hospital (marketplace page)', () => {
  it('compares programs & capacity, partners, turnaround and location per hospital', async () => {
    const { default: Hospitals } = await import('../../src/pages/patient/Hospitals')
    wrap(<Hospitals />)
    expect(screen.getByText('Cotabato Regional Medical Center')).toBeTruthy()
    expect(screen.getByText('Bangsamoro General Hospital')).toBeTruthy()
    // CRMC: two partners, 9 of 15 slots, a published turnaround, address + contact
    expect(screen.getByText('2 agencies')).toBeTruthy()
    expect(screen.getByText('9 of 15 slots open')).toBeTruthy()
    expect(await screen.findByText('About 3 days to endorsement (from 12 cases)')).toBeTruthy()
    expect(screen.getByText('Sinsuat Ave, Cotabato City · BARMM')).toBeTruthy()
    expect(screen.getByText('mss@crmc.ph')).toBeTruthy()
    // BGH: too few cases → no turnaround figure
    expect(screen.getByText('Not enough cases yet to tell')).toBeTruthy()
  })

  it('filters by program', async () => {
    const { default: Hospitals } = await import('../../src/pages/patient/Hospitals')
    wrap(<Hospitals />)
    fireEvent.change(screen.getByLabelText('Filter by program'), { target: { value: 'Dialysis' } })
    expect(screen.queryByText('Bangsamoro General Hospital')).toBeNull()
    expect(screen.getByText('Cotabato Regional Medical Center')).toBeTruthy()
  })
})

describe('HospitalGate (request flow)', () => {
  const hospitals = [
    { ...DATA.hospitalsPublic[0], partners: [], programs: [], slots: { total: 0, remaining: 0 } },
    { ...DATA.hospitalsPublic[1], partners: [], programs: [], slots: { total: 0, remaining: 0 } },
  ]

  it("prefills the chosen hospital's prefix and claims the code", async () => {
    const { default: HospitalGate } = await import('../../src/components/patient/HospitalGate')
    const onClaimed = vi.fn()
    checkAccessCode.mockResolvedValue({ ok: true, tenantId: 'bgh', reuse: false })
    claimAccessCode.mockResolvedValue({ tenantId: 'bgh', tenantIds: ['bgh'], hospitalId: 'BGH-2026-00001' })
    wrap(<HospitalGate user={user} hospitals={hospitals} initialId="bgh" onClaimed={onClaimed} />)
    const input = screen.getByLabelText(/Access code from BGH/)
    expect(input.value).toMatch(/^BGH-\d{4}-$/)
    fireEvent.change(input, { target: { value: 'bgh-2026-00001' } })
    fireEvent.click(screen.getByRole('button', { name: /Use this code/ }))
    await waitFor(() => expect(onClaimed).toHaveBeenCalled())
    expect(checkAccessCode).toHaveBeenCalledWith('BGH-2026-00001', { hospitalId: 'bgh', uid: 'p1' })
    expect(claimAccessCode).toHaveBeenCalledWith({ user, code: 'BGH-2026-00001', tenantId: 'bgh' })
  })

  it("offers to switch when the code belongs to another hospital, and claims nothing", async () => {
    const { default: HospitalGate } = await import('../../src/components/patient/HospitalGate')
    checkAccessCode.mockResolvedValue({ ok: false, reason: 'otherHospital', tenantId: 'hospital-1' })
    wrap(<HospitalGate user={user} hospitals={hospitals} initialId="bgh" onClaimed={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Access code from BGH/), { target: { value: 'CRMC-2026-00001' } })
    fireEvent.click(screen.getByRole('button', { name: /Use this code/ }))
    await screen.findByText(/This code is from Cotabato Regional Medical Center/)
    expect(claimAccessCode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose CRMC instead' }))
    expect(screen.getByLabelText(/Access code from CRMC/)).toBeTruthy()
  })
})
