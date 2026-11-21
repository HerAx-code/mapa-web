/**
 * When a case counts as FINISHED (decision D4 / P2-B, Phase 2 PR 2.1) and the
 * I3 regression reproduced on 2026-11-21: an expired letter reopened a
 * "fully funded" case and took activeRequestId from the patient's newer
 * request. The definition is shared (src/shared/caseState.js → bundle).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))

const { FieldValue } = createRequire(path.join(process.cwd(), 'functions', 'package.json'))('firebase-admin/firestore')

let syncActiveRequest, handleSync, handlePurge
beforeAll(() => {
  ;({ syncActiveRequest } = require('../../functions/src/onRequestWritten'))
  ;({ handleSyncRequestFinancials: handleSync } = require('../../functions/src/syncRequestFinancials'))
  ;({ handlePurgeSelfieOnClose: handlePurge } = require('../../functions/src/purgeSelfieOnClose'))
})
const serverTimestamp = () => 'TS'

describe('syncRequestFinancials keeps openLetters', () => {
  it('a fully funded case with an issued letter has one open letter', async () => {
    const db = memDb({
      'requests/r1': { status: 'endorsed', amountNeeded: 1000, amountCommitted: 0 },
      'applications/s1': { requestId: 'r1', status: 'approved', glStatus: 'issued', amountApproved: 1000, amountRequested: 1000 },
    })
    await handleSync({ db, requestId: 'r1', serverTimestamp })
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'fully_funded', amountCommitted: 1000, openLetters: 1 })
  })
  it('redeeming the letter brings it to 0 (the case is now finished)', async () => {
    const db = memDb({
      'requests/r1': { status: 'fully_funded', amountNeeded: 1000, amountCommitted: 1000, openLetters: 1 },
      'applications/s1': { requestId: 'r1', status: 'certificate', glStatus: 'redeemed', amountApproved: 1000 },
    })
    await handleSync({ db, requestId: 'r1', serverTimestamp })
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'fully_funded', openLetters: 0 })
  })
})

describe('activeRequestId follows FINISHED, not "fully funded"', () => {
  const sync = (db, before, after, requestId = 'rOLD') => syncActiveRequest({ db, before, after, requestId, FieldValue })

  it('fully funded with an open letter stays active — the patient cannot file again yet', async () => {
    const db = memDb({ 'users/p': { activeRequestId: 'rOLD' } })
    const r = await sync(db, { patientId: 'p', status: 'partially_funded' }, { patientId: 'p', status: 'fully_funded', openLetters: 1 })
    expect(r.active).toBe('already-set')
    expect(db.store.get('users/p').activeRequestId).toBe('rOLD')
  })

  it('once every letter is settled the case is finished and the pointer is cleared', async () => {
    const db = memDb({ 'users/p': { activeRequestId: 'rOLD' } })
    const r = await sync(db, { patientId: 'p', status: 'fully_funded', openLetters: 1 }, { patientId: 'p', status: 'fully_funded', openLetters: 0 })
    expect(r.active).toBe('cleared')
    expect(db.store.get('users/p').activeRequestId).toBeUndefined()
  })

  it('I3: a reopened case never takes the pointer from a newer active request', async () => {
    const db = memDb({
      'users/p': { activeRequestId: 'rNEW' },
      'requests/rNEW': { patientId: 'p', status: 'submitted' },
    })
    const r = await sync(db, { patientId: 'p', status: 'fully_funded', openLetters: 0 }, { patientId: 'p', status: 'under_review' })
    expect(r.active).toBe('kept-other')
    expect(db.store.get('users/p').activeRequestId).toBe('rNEW')
  })

  it('a pointer left on a finished request is replaced', async () => {
    const db = memDb({
      'users/p': { activeRequestId: 'rDONE' },
      'requests/rDONE': { patientId: 'p', status: 'closed' },
    })
    expect((await sync(db, null, { patientId: 'p', status: 'submitted' })).active).toBe('set')
    expect(db.store.get('users/p').activeRequestId).toBe('rOLD')
  })
})

describe('the selfie is purged only when the case is finished', () => {
  const data = () => ({ 'documentContents/d1': { content: 'x' }, 'documents/d1': { name: 'Live selfie' } })
  const req = (x) => ({ attachedDocuments: [{ documentId: 'd1', name: 'Live selfie' }], ...x })

  it('not while a fully funded case still has an open letter', async () => {
    const db = memDb(data())
    const r = await handlePurge({ db, before: req({ status: 'partially_funded' }), after: req({ status: 'fully_funded', openLetters: 1 }), serverTimestamp })
    expect(r.skipped).toBe('no-terminal-transition')
    expect(db.store.has('documentContents/d1')).toBe(true)
  })
  it('when its last letter is settled', async () => {
    const db = memDb(data())
    const r = await handlePurge({ db, before: req({ status: 'fully_funded', openLetters: 1 }), after: req({ status: 'fully_funded', openLetters: 0 }), serverTimestamp })
    expect(r.purged).toBe(1)
    expect(db.store.has('documentContents/d1')).toBe(false)
  })
})
