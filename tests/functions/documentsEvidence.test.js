/**
 * Phase 3 PR 3.1 — the document owns its status (syncDocumentStatus, gap M4)
 * and unattached uploads are cleaned up (purgeUnattachedDocuments, P3-A).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

let handleSyncDocumentStatus, handlePurgeUnattachedDocuments
beforeAll(() => {
  ;({ handleSyncDocumentStatus } = require('../../functions/src/syncDocumentStatus'))
  ;({ handlePurgeUnattachedDocuments } = require('../../functions/src/purgeUnattachedDocuments'))
})

const deps = { arrayUnion: (...v) => ({ union: v }), serverTimestamp: () => 'TS' }
const sync = (db, docId, before, after) => handleSyncDocumentStatus({ db, docId, before, after, ...deps })
const listOf = (db, id) => db.store.get(`requests/${id}`).attachedDocuments

describe('syncDocumentStatus', () => {
  const base = () => ({
    'requests/r1': { patientId: 'pat', agencyIds: ['dswd'], attachedDocuments: [
      { documentId: 'd1', name: 'Bill', status: 'pending' },
      { documentId: 'd2', name: 'ID', status: 'rejected' },
    ] },
    'requests/r0': { patientId: 'pat', attachedDocuments: [{ documentId: 'd1', name: 'Bill', status: 'pending' }] },
    'requests/other': { patientId: 'someoneElse', attachedDocuments: [{ documentId: 'd1', status: 'pending' }] },
  })

  it("updates the document's entry on every request of the patient that lists it", async () => {
    const db = memDb(base())
    const r = await sync(db, 'd1', { status: 'pending' }, { patientId: 'pat', status: 'verified' })
    expect(r.changed.map((c) => c.requestId).sort()).toEqual(['r0', 'r1'])
    expect(listOf(db, 'r1')[0].status).toBe('verified')
    expect(listOf(db, 'r1')[1].status).toBe('rejected')            // the other entry untouched
    expect(listOf(db, 'other')[0].status).toBe('pending')          // another patient's request untouched
  })

  it('ignores writes that do not change the status', async () => {
    const db = memDb(base())
    expect((await sync(db, 'd1', { status: 'pending', size: 1 }, { patientId: 'pat', status: 'pending', size: 2 })).skipped).toBe('no-status-change')
  })

  it('a verified late upload that supersedes a listed document takes its place; agencies may read it', async () => {
    const db = memDb({ ...base(), 'documents/d3': { patientId: 'pat', status: 'verified', requestId: 'r1', supersedes: 'd2' } })
    await sync(db, 'd3', { status: 'pending' }, { patientId: 'pat', status: 'verified', requestId: 'r1', supersedes: 'd2', name: 'ID', date: '2026-11-22' })
    expect(listOf(db, 'r1').map((a) => a.documentId)).toEqual(['d1', 'd3'])
    expect(db.store.get('requests/r1').replacedDocuments).toEqual({ union: [{ documentId: 'd2', by: 'd3' }] })
    expect(db.store.get('documents/d3').agencyIds).toEqual({ union: ['dswd'] })
  })

  it('a verified late upload with nothing to replace joins the list; a pending one does not', async () => {
    const db = memDb({ ...base(), 'documents/d4': { patientId: 'pat', status: 'pending', requestId: 'r1' } })
    await sync(db, 'd4', null, { patientId: 'pat', status: 'pending', requestId: 'r1' })
    expect(listOf(db, 'r1')).toHaveLength(2)
    await sync(db, 'd4', { status: 'pending' }, { patientId: 'pat', status: 'verified', requestId: 'r1', name: 'Medical Abstract' })
    expect(listOf(db, 'r1').map((a) => a.documentId)).toEqual(['d1', 'd2', 'd4'])
  })
})

describe('purgeUnattachedDocuments', () => {
  const DAY = 86400000
  const NOW = Date.UTC(2026, 11, 1)
  const ts = (ms) => ({ toMillis: () => ms })
  const seed = () => memDb({
    'documents/old': { patientId: 'pat', status: 'pending', createdAt: ts(NOW - 40 * DAY) },
    'documentContents/old': { content: 'x' },
    'documents/young': { patientId: 'pat', status: 'pending', createdAt: ts(NOW - 5 * DAY) },
    'documents/listed': { patientId: 'pat', status: 'pending', createdAt: ts(NOW - 40 * DAY) },
    'documents/late': { patientId: 'pat', status: 'pending', requestId: 'r1', createdAt: ts(NOW - 40 * DAY) },
    'documents/verified': { patientId: 'pat', status: 'verified', createdAt: ts(NOW - 400 * DAY) },
    'requests/r1': { patientId: 'pat', attachedDocuments: [{ documentId: 'listed' }] },
  })

  it('deletes only old, pending, unlisted, never-endorsed documents with their content', async () => {
    const db = seed()
    const r = await handlePurgeUnattachedDocuments({ db, nowMs: NOW })
    expect(r.deleted).toBe(1)
    expect(db.store.has('documents/old')).toBe(false)
    expect(db.store.has('documentContents/old')).toBe(false)
    for (const kept of ['young', 'listed', 'late', 'verified']) expect(db.store.has(`documents/${kept}`)).toBe(true)
  })

  it('report mode deletes nothing', async () => {
    const db = seed()
    expect((await handlePurgeUnattachedDocuments({ db, nowMs: NOW, write: false })).deleted).toBe(1)
    expect(db.store.has('documents/old')).toBe(true)
  })
})
