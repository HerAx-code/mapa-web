/**
 * onAgencyWritten — pure-handler unit tests.
 *
 * The trigger projects the non-sensitive subset of an agency doc into
 * `agenciesPublic/{id}` so the public Landing page can read a live programs
 * teaser without exposing budget / fundSource / contacts (audit SEC-3). These
 * tests pin: the projection carries ONLY safe fields, an unrelated edit is a
 * no-op, and a deletion removes the mirror.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({
  default: { firestore: () => ({}) },
  firestore: () => ({}),
}))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (opts, fn) => fn }))

let handleAgencyWritten, projectPublicAgency
beforeAll(() => {
  const mod = require('../../functions/src/onAgencyWritten')
  handleAgencyWritten = mod.handleAgencyWritten
  projectPublicAgency = mod.projectPublicAgency
})

const serverTimestamp = () => 'MOCK_TS'

// Minimal Firestore double: agenciesPublic/{id}.set()/delete(), captured.
function makeDb() {
  const calls = { set: [], delete: [] }
  return {
    calls,
    collection() {
      return {
        doc() {
          return {
            set: async (payload, opts) => { calls.set.push({ payload, opts }) },
            delete: async () => { calls.delete.push(true) },
          }
        },
      }
    },
  }
}

const run = (before, after, agencyId = 'ag-1') => {
  const db = makeDb()
  return handleAgencyWritten({ db, agencyId, before, after, serverTimestamp })
    .then(result => ({ result, calls: db.calls }))
}

const RICH_AGENCY = {
  name: 'PCSO', initials: 'PCSO', enabled: true,
  slots: { total: 10, remaining: 4 },
  budget: { allocated: 500000, committed: 120000, disbursed: 30000 },
  fundSource: 'PCSO Board Resolution #2026-15',
  contact: '09171234567', signatory: 'Director Juan Cruz',
}

describe('projectPublicAgency', () => {
  it('copies ONLY name + enabled + slots — never budget/fundSource/contacts', () => {
    const pub = projectPublicAgency(RICH_AGENCY)
    expect(pub).toEqual({ name: 'PCSO', enabled: true, slots: { total: 10, remaining: 4 } })
    expect(pub).not.toHaveProperty('budget')
    expect(pub).not.toHaveProperty('fundSource')
    expect(pub).not.toHaveProperty('contact')
    expect(pub).not.toHaveProperty('signatory')
  })

  it('defaults enabled to true unless explicitly false, and coerces slot numbers', () => {
    expect(projectPublicAgency({ name: 'X' }).enabled).toBe(true)
    expect(projectPublicAgency({ name: 'X', enabled: false }).enabled).toBe(false)
    expect(projectPublicAgency({ name: 'X', slots: {} }).slots).toEqual({ total: 0, remaining: 0 })
  })
})

describe('handleAgencyWritten', () => {
  it('writes the public projection on create (no sensitive fields leak)', async () => {
    const { result, calls } = await run(null, RICH_AGENCY)
    expect(calls.set).toHaveLength(1)
    expect(calls.set[0].payload).toMatchObject({ name: 'PCSO', enabled: true, slots: { total: 10, remaining: 4 } })
    expect(calls.set[0].payload).not.toHaveProperty('budget')
    expect(result.projected).toBeDefined()
  })

  it('updates the projection when a public field (slots.remaining) changes', async () => {
    const after = { ...RICH_AGENCY, slots: { total: 10, remaining: 3 } }
    const { calls } = await run(RICH_AGENCY, after)
    expect(calls.set).toHaveLength(1)
    expect(calls.set[0].payload.slots.remaining).toBe(3)
  })

  it('is a no-op when only a SENSITIVE field changes (budget) — no public churn', async () => {
    const after = { ...RICH_AGENCY, budget: { allocated: 999999, committed: 120000, disbursed: 30000 } }
    const { result, calls } = await run(RICH_AGENCY, after)
    expect(calls.set).toHaveLength(0)
    expect(result.skipped).toBe('projection-unchanged')
  })

  it('deletes the public mirror when the agency is deleted', async () => {
    const { result, calls } = await run(RICH_AGENCY, null)
    expect(calls.delete).toHaveLength(1)
    expect(result.deleted).toBe('ag-1')
  })
})
