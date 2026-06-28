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

// makeFakeDb now models the two distinct throttle docs that the
// handler writes to: per-uid and per-ip. Each can be pre-seeded
// independently. Throttle docs are keyed by ref path so the tx.get()
// inside the handler returns the right state for each lookup.
function makeFakeDb({
  uidThrottleDoc = null,
  ipThrottleDoc  = null,
  hospitalIdDoc  = null,
  throwOnGet = false,
} = {}) {
  const writes = []
  // Map from ref path -> the doc state.
  const throttleByPath = new Map()
  return {
    _writes: writes,
    _throttleByPath: throttleByPath,
    doc: (path) => {
      if (path.startsWith('_rateLimit/verifyAccessCode_uid_')) {
        const ref = { _path: path, _kind: 'uid' }
        if (uidThrottleDoc !== null && !throttleByPath.has(path)) {
          throttleByPath.set(path, uidThrottleDoc)
        }
        return ref
      }
      if (path.startsWith('_rateLimit/verifyAccessCode_ip_')) {
        const ref = { _path: path, _kind: 'ip' }
        if (ipThrottleDoc !== null && !throttleByPath.has(path)) {
          throttleByPath.set(path, ipThrottleDoc)
        }
        return ref
      }
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
      const tx = {
        get: async (ref) => {
          const existing = throttleByPath.get(ref._path)
          return {
            exists: existing != null,
            data: () => existing,
          }
        },
        set: (ref, data) => {
          writes.push({ ref, data })
          // Persist the write so the second-tier throttle check sees
          // the bumped count from the first tier (matches real
          // Firestore behavior across sequential transactions in
          // the same function invocation).
          throttleByPath.set(ref._path, data)
        },
      }
      return fn(tx)
    },
  }
}

const serverTimestamp = () => 'MOCK_SERVER_TIMESTAMP'
const TEST_IP = '203.0.113.5'  // RFC 5737 documentation IP -- never a real client

// All call-the-handler tests below pass `ip: TEST_IP` because the
// IP-tier throttle requires it. The auth/input-validation paths short-
// circuit before any throttle check fires, so they don't need an IP.

// ── Auth + input validation ────────────────────────────────────────────

describe('verifyAccessCode: auth gate', () => {
  it('throws unauthenticated when uid is missing', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: null, code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp }))
      .rejects.toThrow(/Sign in/)
  })

  it('throws unauthenticated when uid is undefined', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: undefined, code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'unauthenticated' })
  })
})

describe('verifyAccessCode: input validation', () => {
  it('rejects empty code', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: 'u', code: '', ip: TEST_IP, db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects malformed code (wrong prefix)', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: 'u', code: 'WRONG-2026-00001', ip: TEST_IP, db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects malformed code (wrong digit count)', async () => {
    const db = makeFakeDb()
    await expect(handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-001', ip: TEST_IP, db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('normalizes lowercase + whitespace before checking format', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: '  crmc-2026-00001  ', ip: TEST_IP, db, serverTimestamp,
    })
    expect(out).toEqual({ available: true, exists: true })
  })
})

// ── Per-uid throttle ──────────────────────────────────────────────────

describe('verifyAccessCode: per-uid throttle', () => {
  it('lets the first call through and writes count=1 to the uid doc', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    await handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp })
    // First write should be the uid throttle bumped to 1
    const uidWrites = db._writes.filter(w => w.ref._kind === 'uid')
    expect(uidWrites[0].data.count).toBe(1)
  })

  it('lets the 10th uid call through and increments to 10', async () => {
    const db = makeFakeDb({
      uidThrottleDoc: { count: 9, windowStart: Date.now() },
      hospitalIdDoc:  { status: 'available' },
    })
    await handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp })
    const uidWrites = db._writes.filter(w => w.ref._kind === 'uid')
    expect(uidWrites[0].data.count).toBe(10)
  })

  it('REGRESSION GUARD: rejects the 11th uid call as resource-exhausted', async () => {
    const db = makeFakeDb({
      uidThrottleDoc: { count: 10, windowStart: Date.now() },
      hospitalIdDoc:  { status: 'available' },
    })
    await expect(handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp }))
      .rejects.toMatchObject({ code: 'resource-exhausted' })
  })

  it('resets the uid window after 1 hour and lets the next call through', async () => {
    const db = makeFakeDb({
      uidThrottleDoc: { count: 10, windowStart: Date.now() - (61 * 60 * 1000) },
      hospitalIdDoc:  { status: 'available' },
    })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })
    expect(out).toEqual({ available: true, exists: true })
    const uidWrites = db._writes.filter(w => w.ref._kind === 'uid')
    expect(uidWrites[0].data.count).toBe(1)
  })

  it('uid throttle error message mentions the per-account cap + minutes', async () => {
    const db = makeFakeDb({
      uidThrottleDoc: { count: 10, windowStart: Date.now() - (5 * 60 * 1000) },
    })
    try {
      await handleVerifyAccessCode({ uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('resource-exhausted')
      expect(err.message).toMatch(/per-account/)
      expect(err.message).toMatch(/\d+ minutes/)
    }
  })
})

// ── Per-IP throttle (Phase 3.5 hardening: closes the anon-uid-loop bypass) ──

describe('verifyAccessCode: per-IP throttle', () => {
  it('REGRESSION GUARD: blocks bot bypass where attacker rotates uid but keeps IP', async () => {
    // The attack: signInAnonymously() in a loop to defeat the per-uid
    // 10/hour cap. Each call gets a fresh uid (uid throttle resets);
    // but the IP stays the same, so the IP throttle catches it.
    // This test pre-seeds the IP throttle at the 60-attempt cap to
    // confirm the next attempt is rejected.
    const db = makeFakeDb({
      ipThrottleDoc:  { count: 60, windowStart: Date.now() },
      hospitalIdDoc:  { status: 'available' },
    })
    await expect(handleVerifyAccessCode({
      uid: 'fresh-anon-uid', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })).rejects.toMatchObject({ code: 'resource-exhausted' })
  })

  it('IP throttle error message mentions per-network + minutes', async () => {
    const db = makeFakeDb({
      ipThrottleDoc: { count: 60, windowStart: Date.now() - (10 * 60 * 1000) },
    })
    try {
      await handleVerifyAccessCode({
        uid: 'fresh-uid', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.code).toBe('resource-exhausted')
      expect(err.message).toMatch(/per-network/)
    }
  })

  it('IP cap (60) is higher than uid cap (10), so a single user does not hit it normally', async () => {
    // One legitimate user with no prior history makes 10 valid attempts.
    // Each call passes uid (1..10) and ip (1..10). All should succeed.
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    for (let i = 0; i < 10; i++) {
      const out = await handleVerifyAccessCode({
        uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
      })
      expect(out).toEqual({ available: true, exists: true })
    }
    // 11th call should hit the uid cap (not the IP cap, which is at 10/60)
    await expect(handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })).rejects.toMatchObject({ code: 'resource-exhausted' })
  })

  it('hashIp produces deterministic 16-char hex (privacy + key stability)', async () => {
    const { hashIp } = require('../../functions/src/verifyAccessCode')
    const h1 = hashIp('203.0.113.5')
    const h2 = hashIp('203.0.113.5')
    const h3 = hashIp('198.51.100.7')
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
  })

  it('hashIp tolerates missing IP (falls back to "unknown" hash)', async () => {
    const { hashIp } = require('../../functions/src/verifyAccessCode')
    expect(hashIp(undefined)).toMatch(/^[0-9a-f]{16}$/)
    expect(hashIp(null)).toMatch(/^[0-9a-f]{16}$/)
  })
})

// ── Code resolution ───────────────────────────────────────────────────

describe('verifyAccessCode: code resolution', () => {
  it('returns { available: false, exists: false } for a non-existent code', async () => {
    const db = makeFakeDb({ hospitalIdDoc: null })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-99999', ip: TEST_IP, db, serverTimestamp,
    })
    expect(out).toEqual({ available: false, exists: false })
  })

  it('returns { available: true, exists: true } when status is available', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'available' } })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })
    expect(out).toEqual({ available: true, exists: true })
  })

  it('returns { available: false, exists: true } when status is "used"', async () => {
    const db = makeFakeDb({ hospitalIdDoc: { status: 'used' } })
    const out = await handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })
    expect(out).toEqual({ available: false, exists: true })
  })

  it('REGRESSION GUARD: does NOT leak any field besides available + exists', async () => {
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
      uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })
    expect(Object.keys(out).sort()).toEqual(['available', 'exists'])
  })

  it('wraps a Firestore read error as internal', async () => {
    const db = makeFakeDb({ throwOnGet: true })
    await expect(handleVerifyAccessCode({
      uid: 'u', code: 'CRMC-2026-00001', ip: TEST_IP, db, serverTimestamp,
    })).rejects.toMatchObject({ code: 'internal' })
  })
})
