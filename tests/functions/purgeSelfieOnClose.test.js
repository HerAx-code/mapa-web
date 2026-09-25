/**
 * purgeSelfieOnClose — pure-handler unit tests. When a request goes terminal,
 * the selfie image content is deleted (RA-10173 retention) while the metadata +
 * advisory verdict flags are kept. Pins: only the INTO-terminal transition acts,
 * only selfie docs are purged, the ID doc is left alone, and missing content
 * degrades quietly.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (opts, fn) => fn }))

let handlePurgeSelfieOnClose
beforeAll(() => { handlePurgeSelfieOnClose = require('../../functions/src/purgeSelfieOnClose').handlePurgeSelfieOnClose })

const serverTimestamp = () => 'MOCK_TS'

function makeDb({ missingContent = [] } = {}) {
  const deleted = [], stamped = []
  return {
    deleted, stamped,
    collection(name) {
      if (name === 'documentContents') return {
        doc: (id) => ({
          get: async () => ({ exists: !missingContent.includes(id) }),
          delete: async () => { deleted.push(id) },
        }),
      }
      if (name === 'documents') return {
        doc: (id) => ({ set: async (payload) => { stamped.push({ id, payload }) } }),
      }
      return { doc: () => ({}) }
    },
  }
}

const withSelfie = (status) => ({
  status,
  attachedDocuments: [
    { documentId: 'id-1', documentTypeName: 'Valid ID' },
    { documentId: 'sf-1', documentTypeName: 'Live Selfie' },
  ],
})

describe('handlePurgeSelfieOnClose', () => {
  it('purges the selfie content (not the ID) on the into-terminal transition', async () => {
    const db = makeDb()
    const r = await handlePurgeSelfieOnClose({ db, before: withSelfie('endorsed'), after: withSelfie('closed'), serverTimestamp })
    expect(r.purged).toBe(1)
    expect(db.deleted).toEqual(['sf-1'])          // selfie content gone
    expect(db.deleted).not.toContain('id-1')      // ID document untouched
    expect(db.stamped.map(s => s.id)).toEqual(['sf-1'])
    expect(db.stamped[0].payload.selfieContentPurgedReason).toBe('case_closed')
  })

  it('acts on each terminal status (fully_funded / closed / rejected)', async () => {
    for (const status of ['fully_funded', 'closed', 'rejected']) {
      const db = makeDb()
      const r = await handlePurgeSelfieOnClose({ db, before: withSelfie('under_review'), after: withSelfie(status), serverTimestamp })
      expect(r.purged).toBe(1)
    }
  })

  it('skips a request that was ALREADY terminal (no re-purge)', async () => {
    const db = makeDb()
    const r = await handlePurgeSelfieOnClose({ db, before: withSelfie('closed'), after: withSelfie('closed'), serverTimestamp })
    expect(r.skipped).toBe('no-terminal-transition')
    expect(db.deleted).toEqual([])
  })

  it('skips a non-terminal request', async () => {
    const db = makeDb()
    const r = await handlePurgeSelfieOnClose({ db, before: withSelfie('submitted'), after: withSelfie('endorsed'), serverTimestamp })
    expect(r.skipped).toBe('no-terminal-transition')
    expect(db.deleted).toEqual([])
  })

  it('skips quietly when there is no selfie attached', async () => {
    const db = makeDb()
    const after = { status: 'closed', attachedDocuments: [{ documentId: 'id-1', documentTypeName: 'Valid ID' }] }
    const r = await handlePurgeSelfieOnClose({ db, before: { status: 'endorsed' }, after, serverTimestamp })
    expect(r.skipped).toBe('no-selfie')
    expect(db.deleted).toEqual([])
  })

  it('degrades quietly when the content was already gone', async () => {
    const db = makeDb({ missingContent: ['sf-1'] })
    const r = await handlePurgeSelfieOnClose({ db, before: withSelfie('endorsed'), after: withSelfie('closed'), serverTimestamp })
    expect(r.purged).toBe(0)
    expect(r.skipped).toBe(1)
    expect(db.deleted).toEqual([])                // nothing to delete
    expect(db.stamped.map(s => s.id)).toEqual(['sf-1']) // still audit-stamped
  })
})
