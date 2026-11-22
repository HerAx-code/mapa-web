/**
 * Withdrawal → access code returned — Phase 3 PR 3.4 (P3-E / D1). A patient
 * withdrawal BEFORE any staff action frees the code (clears its requestId) for
 * one new filing; after a review it is used up.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))

const { FieldValue } = createRequire(path.join(process.cwd(), 'functions', 'package.json'))('firebase-admin/firestore')
let returnCodeOnWithdrawal
beforeAll(() => { returnCodeOnWithdrawal = require('../../functions/src/onRequestWritten').returnCodeOnWithdrawal })

const base = (code = {}) => ({
  'hospitalIds/AAA-2026-00001': { tenantId: 'hosp-a', status: 'used', patId: 'ana', requestId: 'r1', ...code },
})
const withdraw = (db, before, after) =>
  returnCodeOnWithdrawal({ db, before, after, requestId: 'r1', FieldValue })

const WITHDRAWN = { status: 'closed', closeReason: 'Withdrawn by the applicant.', attachedDocuments: [] }

describe('returnCodeOnWithdrawal', () => {
  it('frees the code when a submitted request is withdrawn before any staff action', async () => {
    const db = memDb(base())
    const r = await withdraw(db, { status: 'submitted' }, WITHDRAWN)
    expect(r).toMatchObject({ codeReturn: 'returned', code: 'AAA-2026-00001' })
    expect('requestId' in db.store.get('hospitalIds/AAA-2026-00001')).toBe(false) // cleared → reusable
  })

  it('does NOT free the code once the request has moved past submitted', async () => {
    const db = memDb(base())
    const r = await withdraw(db, { status: 'under_review' }, WITHDRAWN)
    expect(r.codeReturn).toBe('past-submitted')
    expect(db.store.get('hospitalIds/AAA-2026-00001').requestId).toBe('r1') // untouched
  })

  it('does NOT free the code when a document has already been reviewed', async () => {
    const db = memDb(base())
    const r = await withdraw(db, { status: 'submitted' }, { ...WITHDRAWN, attachedDocuments: [{ documentId: 'd1', status: 'verified' }] })
    expect(r.codeReturn).toBe('doc-reviewed')
    expect(db.store.get('hospitalIds/AAA-2026-00001').requestId).toBe('r1')
  })

  it('ignores a staff/agency close (only a patient withdrawal frees the code)', async () => {
    const db = memDb(base())
    const r = await withdraw(db, { status: 'endorsed' }, { status: 'closed', closeReason: 'Closed by the hospital.', attachedDocuments: [] })
    expect(r.codeReturn).toBe('not-a-withdrawal')
    expect(db.store.get('hospitalIds/AAA-2026-00001').requestId).toBe('r1')
  })
})
