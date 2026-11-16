/**
 * purgeDeclinedOnboarding — pure-handler tests: only Declined requests whose
 * last action is over a year old are deleted, with their files and an audit
 * entry that carries no personal data.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, fn) => fn }))

let handlePurgeDeclinedOnboarding
beforeAll(() => {
  ;({ handlePurgeDeclinedOnboarding } = require('../../functions/src/purgeDeclinedOnboarding'))
})

const NOW = Date.UTC(2027, 11, 1)
const DAY = 86400000
const ts = (ms) => ({ toMillis: () => ms })

function makeDb(rows) {
  const deletedIds = []
  const audits = []
  const docs = rows.map(r => ({ id: r.id, data: () => r, ref: { delete: async () => { deletedIds.push(r.id) } } }))
  return {
    deletedIds, audits,
    collection: (name) => name === 'auditLog'
      ? { add: async (a) => { audits.push(a) } }
      : { get: async () => ({ docs }) },
  }
}

describe('handlePurgeDeclinedOnboarding', () => {
  it('deletes only declined/withdrawn requests idle for over a year, with their files', async () => {
    const db = makeDb([
      { id: 'old-declined',   stage: 'declined', closedAs: 'declined',  hospitalName: 'A Hospital', updatedAt: ts(NOW - 400 * DAY), contactName: 'Juan' },
      { id: 'old-withdrawn',  stage: 'declined', closedAs: 'withdrawn', hospitalName: 'B Hospital', updatedAt: ts(NOW - 366 * DAY) },
      { id: 'legacy-declined', status: 'declined', hospitalName: 'C Hospital', statusUpdatedAt: ts(NOW - 500 * DAY) },
      { id: 'recent-declined', stage: 'declined', hospitalName: 'D Hospital', updatedAt: ts(NOW - 100 * DAY) },
      { id: 'old-live',       stage: 'live', hospitalName: 'E Hospital', updatedAt: ts(NOW - 900 * DAY) },
    ])
    const prefixes = []
    const bucket = { deleteFiles: async ({ prefix }) => { prefixes.push(prefix) } }
    const r = await handlePurgeDeclinedOnboarding({ db, bucket, nowMs: NOW, serverTimestamp: () => 'TS' })
    expect(db.deletedIds.sort()).toEqual(['legacy-declined', 'old-declined', 'old-withdrawn'])
    expect(prefixes).toContain('onboarding/old-declined/')
    expect(r).toEqual({ deleted: 3, keptUnderOneYear: 1, failed: 0 })
    expect(db.audits.find(a => a.targetId === 'old-withdrawn').details).toMatch(/^Withdrawn/)
    expect(JSON.stringify(db.audits)).not.toContain('Juan')
  })
})
