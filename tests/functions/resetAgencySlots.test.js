/**
 * resetAgencySlots — pure-handler unit tests.
 *
 * Not currently deployed (Spark plan); client-side fallback in
 * agency/Dashboard.jsx handles the reset. These tests ready the
 * function for Blaze deployment by pinning the resetting + skip
 * semantics so a future deploy doesn't surprise anyone.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Mock firebase-admin so the require chain succeeds.
vi.mock('firebase-admin', () => ({
  default: { firestore: () => ({}) },
  firestore: () => ({}),
}))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, fn) => fn }))

let handleResetAgencySlots
beforeAll(() => {
  ;({ handleResetAgencySlots } = require('../../functions/src/resetAgencySlots'))
})

function makeDb(agencies) {
  // Records every batch.update call so tests can assert on them.
  const batchOps = []
  const docs = agencies.map((a, i) => ({
    id:   a.id ?? `a-${i}`,
    ref:  { _path: `agencies/${a.id ?? `a-${i}`}` },
    data: () => a,
  }))
  return {
    _batchOps: batchOps,
    collection: () => ({
      where: () => ({
        get: async () => ({
          docs,
          size: docs.length,
        }),
      }),
    }),
    batch: () => ({
      update: (ref, data) => batchOps.push({ ref, data }),
      commit: async () => undefined,
    }),
  }
}

describe('handleResetAgencySlots', () => {
  it('resets every enabled agency whose lastResetDate is not today', async () => {
    const db = makeDb([
      { id: 'mal',  enabled: true, slots: { total: 5, remaining: 0 }, lastResetDate: '2026-06-27' },
      { id: 'pcso', enabled: true, slots: { total: 3, remaining: 1 }, lastResetDate: '2026-06-27' },
    ])
    const result = await handleResetAgencySlots({ db, today: '2026-06-28' })
    expect(result.reset).toBe(2)
    expect(db._batchOps).toHaveLength(2)
    expect(db._batchOps[0].data).toEqual({
      'slots.remaining': 5,
      lastResetDate: '2026-06-28',
    })
  })

  it('skips agencies with slots.total <= 0 (slot system disabled)', async () => {
    const db = makeDb([
      { id: 'mal', enabled: true, slots: { total: 0, remaining: 0 }, lastResetDate: '2026-06-27' },
    ])
    const result = await handleResetAgencySlots({ db, today: '2026-06-28' })
    expect(result.reset).toBe(0)
    expect(result.skippedNoTotal).toBe(1)
    expect(db._batchOps).toHaveLength(0)
  })

  it('REGRESSION GUARD: skips agencies whose lastResetDate is already today', async () => {
    // If the client fallback reset at 00:00:03 and the scheduler fires
    // at 00:00:05, the scheduler must NOT re-reset (undoing any
    // endorsement that happened in those 2 seconds).
    const db = makeDb([
      { id: 'mal', enabled: true, slots: { total: 5, remaining: 4 }, lastResetDate: '2026-06-28' },
    ])
    const result = await handleResetAgencySlots({ db, today: '2026-06-28' })
    expect(result.reset).toBe(0)
    expect(result.skippedAlreadyDone).toBe(1)
    expect(db._batchOps).toHaveLength(0)
  })

  it('handles missing slots field (legacy / fresh agency)', async () => {
    const db = makeDb([
      { id: 'new', enabled: true /* no slots field at all */ },
    ])
    const result = await handleResetAgencySlots({ db, today: '2026-06-28' })
    expect(result.reset).toBe(0)
    expect(result.skippedNoTotal).toBe(1)
  })

  it('reports totalAgencies = snap.size for log line context', async () => {
    const db = makeDb([
      { id: 'a', enabled: true, slots: { total: 5, remaining: 0 } },
      { id: 'b', enabled: true, slots: { total: 0, remaining: 0 } },
      { id: 'c', enabled: true, slots: { total: 3, remaining: 0 }, lastResetDate: '2026-06-28' },
    ])
    const result = await handleResetAgencySlots({ db, today: '2026-06-28' })
    expect(result.totalAgencies).toBe(3)
    expect(result.reset).toBe(1)
    expect(result.skippedNoTotal).toBe(1)
    expect(result.skippedAlreadyDone).toBe(1)
  })
})
