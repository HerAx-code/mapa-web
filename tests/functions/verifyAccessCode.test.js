/**
 * verifyAccessCode Cloud Function — pure-handler unit tests.
 *
 * Imports the inner `handleVerifyAccessCode(deps)` exported alongside
 * the deployed onCall wrapper. Mocks the Firestore admin SDK + a
 * controllable clock so every branch (auth gate, input validation,
 * throttle window, throttle exceed, code resolution) is exercised
 * without booting the functions emulator.
 *
 * Pairs with tests/rules/ which catches client-rule regressions; this
 * suite catches handler-logic regressions (the throttle window, the
 * minutes-left math, the "not exists" vs "exists but used" branch).
 *
 * Path note: function source is at functions/src/verifyAccessCode.js
 * (CJS, requires firebase-functions + firebase-admin). Mocking those
 * at the import boundary keeps the test isolated from the actual
 * Admin SDK + firebase-functions instances.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

// firebase-functions / firebase-admin are CommonJS; the require() shim
// lets us load them from this ESM test file. Vitest doesn't auto-interop
// CJS in this project (type: module + Vite default).
const require = createRequire(import.meta.url)

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock firebase-functions/v2/https so HttpsError is recognizable
// across module boundaries (instanceof needs both sides to import
// the same constructor).
class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'HttpsError' }
}

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (opts, handler) => handler,  // strip the wrapper for tests
  HttpsError: FakeHttpsError,
}))
vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => ({}),
  },
  firestore: () => ({}),
}))

// Load AFTER mocks. We don't actually use admin.firestore() because the
// inner handler takes db as a dependency.
let handleVerifyAccessCode
beforeAll(() => {
  ;({ handleVerifyAccessCode } = require('../../functions/src/verifyAccessCode'))
})

// ── Fake Firestore ────────────────────────────────────────────────────

function makeFakeDb({ throttleDoc = null, hospitalIdDoc = null, throwOnGet = false } = {}) {
  const writes = []
  const throttleRef = {
    _path: '_rateLimit/verifyAccessCode_test-uid',
  }
  const hospitalIdRef = {
    _path: 'hospitalIds/anything',
  }
  return {
    _writes: writes,
    doc: (path) => {
      if (path.startsWith('_rateLimit/')) return throttleRef
      if (path.startsWith('hospitalIds/')) {
        return {
          _path: path,
          get: async () => {
            if (throwOnGet) throw new Error('Firestore unavailable')
            return {
              exists: hospitalIdDoc !== null,
              data:   () => hospitalIdDoc,
            }
          },
        }
      }
      throw new Error('Unmocked doc path: ' + path)
    },
    runTransaction: async (fn) => {
      // Build a tx object that gives the function the throttle snapshot
      // and captures writes.
      const tx = {
        get: async (ref) => ({
          exists: throttleDoc !== null,
          data: () => throttleDoc,
        }),
        set: (ref, data) => { writes.push({ ref, data }) },
      }
      return fn(tx)
    },
  }
}

const serverTimestamp = () => 'MOCK_SERVER_TIMESTAMP'

// ── Auth + input validation ────────────────────────────────────────────

describe('verifyAccessCode: auth gate', () => {
  it('throws unauthenticated when uid is missing', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: null, code: 'CRMC-2026-00001', db, serverTimestamp }))
      .rejects.toThrow(/Sign in/)
  })

  it('throws unauthenticated when uid is undefined', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: undefined, code: 'CRMC-2026-00001', db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'unauthenticated' })
  })
})

describe('verifyAccessCode: input validation', () => {
  it('rejects empty code', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: 'u', code: '', db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects malformed code (wrong prefix)', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: 'u', code: 'WRONG-2026-00001', db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects malformed code (wrong digit count)', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-001', db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('normalizes lowercase + whitespace before checking format', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    // Lowercase + whitespace should be accepted (it's normalized
    // to uppercase + trimmed inside the handler).
    const out = await handleVerifyAccessCode({
      uid: 'u', code: '  crmc-2026-00001  ', db, serverTimestamp,
    })
    expect(out).toEqual({ available: true, exists: true })
  })
})

// ── Throttle ──────────────────────────────────────────────────────────

describe('verifyAccessCode: throttle', () => {
  it('lets the first call through and writes count=1', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    await handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp })
    expect(db._writes[0].data.count).toBe(1)
  })

  it('lets the 10th call through and increments to 10', async () => {
    const db = makeFakeDb({
      throttleDoc:   { count: 9, windowStart: Date.now() },
      hospitalIdDoc: { status: 'available' },
    })
    await handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp })
    expect(db._writes[0].data.count).toBe(10)
  })

  it('REGRESSION GUARD: rejects the 11th call as resource-exhausted', async () => {
    const db = makeFakeDb({
      throttleDoc:   { count: 10, windowStart: Date.now() },
      hospitalIdDoc: { status: 'available' },
    })
    await expect(handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'resource-exhausted' })
  })

  it('resets the window after 1 hour and lets the next call through', async () => {
    const db = makeFakeDb({
      throttleDoc:   { count: 10, windowStart: Date.now() - (61 * 60 * 1000) },
      hospitalIdDoc: { status: 'available' },
    })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp,
    })
    expect(out).toEqual({ available: true, exists: true })
    // Counter reset to 1 after window roll
    expect(db._writes[0].data.count).toBe(1)
  })

  it('includes a minutes-left number in the throttle error message', async () => {
    const db = makeFakeDb({
      // 5 minutes into a window with count=10 → ~55 minutes left
      throttleDoc: { count: 10, windowStart: Date.now() - (5 * 60 * 1000) },
    })
    try {
      await handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('resource-exhausted')
      // Message should mention minutes
      expect(err.message).toMatch(/\d+ minutes/)
    }
  })
})

// ── Code resolution ───────────────────────────────────────────────────

describe('verifyAccessCode: code resolution', () => {
  it('returns { available: false, exists: false } for a non-existent code', async () => {
    const db = makeFakeDb({ hospitalIdDoc: null })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-99999', db, serverTimestamp,
    })
    expect(out).toEqual({ available: false, exists: false })
  })

  it('returns { available: true, exists: true } when status is available', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp,
    })
    expect(out).toEqual({ available: true, exists: true })
  })

  it('returns { available: false, exists: true } when status is "used"', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'used' } })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp,
    })
    expect(out).toEqual({ available: false, exists: true })
  })

  it('REGRESSION GUARD: does NOT leak any field besides available + exists', async () => {
    // The whole point of this function is to NOT leak usedBy / patId /
    // dates / cooldown info. Test pins the response shape.
    const db = makeFakeDb({
      hospitalIdDoc: {
        status: 'used',
        patId: 'SECRET-UID',
        usedAt: 'SECRET-DATE',
        cooldownUntilAt: 'SECRET',
        lastApprovedAt: 'SECRET',
      },
    })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp,
    })
    expect(Object.keys(out).sort()).toEqual(['available', 'exists'])
  })

  it('wraps a Firestore read error as internal', async () => {
    const db = makeFakeDb({ throwOnGet: true })
    await expect(handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', db, serverTimestamp,
    })).rejects.toMatchObject({ code: 'internal' })
  })
})
