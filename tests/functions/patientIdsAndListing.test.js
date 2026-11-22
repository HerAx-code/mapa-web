/**
 * Phase 5 PR 5.2: patient display IDs from a server counter (P5-A, N3) and
 * the public hospital listing written by one trigger (P5-B, R10).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (o, fn) => fn, onDocumentWritten: (o, fn) => fn }))

let handleAssignPatientId, handleHospitalWritten
beforeAll(() => {
  ;({ handleAssignPatientId } = require('../../functions/src/patientIds'))
  ;({ handleHospitalWritten } = require('../../functions/src/onHospitalWritten'))
})

describe('assignPatientId', () => {
  it('seeds above the highest existing ID, then counts on', async () => {
    const db = memDb({
      'users/old1': { role: 'patient', patientId: 'PAT-384211' },
      'users/old2': { role: 'patient', patientId: 'PAT-000007' },
      'users/new1': { role: 'patient' },
      'users/new2': { role: 'patient' },
      'users/staff': { role: 'staff_admin' },
    })
    expect(await handleAssignPatientId({ db, uid: 'new1', user: { role: 'patient' } })).toEqual({ patientId: 'PAT-384212' })
    expect(await handleAssignPatientId({ db, uid: 'new2', user: { role: 'patient' } })).toEqual({ patientId: 'PAT-384213' })
    expect(db.store.get('counters/patientIds').next).toBe(384214)
  })

  it('never renumbers an account that has an ID, and skips staff', async () => {
    const db = memDb({ 'users/p': { role: 'patient', patientId: 'PAT-000001' }, 'users/s': { role: 'staff_admin' } })
    expect((await handleAssignPatientId({ db, uid: 'p', user: { role: 'patient' } })).skipped).toBe('has-id')
    expect((await handleAssignPatientId({ db, uid: 's', user: { role: 'staff_admin' } })).skipped).toBe('not-patient')
    expect(db.store.has('counters/patientIds')).toBe(false)
  })
})

describe('onHospitalWritten', () => {
  const H = { facilityName: 'Cotabato Regional', shortName: 'CRMC', accessCodePrefix: 'CRMC', enabled: true, gatewayName: 'MSS', address: 'Cotabato', region: 'BARMM', contactEmail: 'mss@example.org', logoUrl: 'x' }
  const ts = () => 'TS'
  it('publishes only the public fields', async () => {
    const db = memDb()
    await handleHospitalWritten({ db, hospitalId: 'h1', before: null, after: H, serverTimestamp: ts })
    const { logoUrl, ...pub } = H
    expect(db.store.get('hospitalsPublic/h1')).toEqual({ ...pub, updatedAt: 'TS' })
    expect(db.store.get('hospitalsPublic/h1')).not.toHaveProperty('logoUrl')
  })
  it('re-projects a change, and keeps a paused hospital listed as paused', async () => {
    const db = memDb({ 'hospitalsPublic/h1': { ...H } })
    await handleHospitalWritten({ db, hospitalId: 'h1', before: H, after: { ...H, enabled: false }, serverTimestamp: ts })
    expect(db.store.get('hospitalsPublic/h1').enabled).toBe(false)
  })
  it('never publishes the training hospital, and removes a deleted hospital', async () => {
    const db = memDb({ 'hospitalsPublic/train': { facilityName: 'Training' }, 'hospitalsPublic/gone': { facilityName: 'Gone' } })
    await handleHospitalWritten({ db, hospitalId: 'train', before: null, after: { ...H, onboarding: { training: true } }, serverTimestamp: ts })
    await handleHospitalWritten({ db, hospitalId: 'gone', before: H, after: null, serverTimestamp: ts })
    expect(db.store.has('hospitalsPublic/train')).toBe(false)
    expect(db.store.has('hospitalsPublic/gone')).toBe(false)
  })
})
