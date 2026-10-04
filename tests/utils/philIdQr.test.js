/**
 * philIdQr — on-device PhilID QR helpers (ID-verification Phase 3).
 * Tests the pure / verifiable core: PCN masking + normalization, the keyed PCN
 * fingerprint (never the raw PCN), Base45 decode (RFC 9285 vector), and the
 * Ed25519 verify LOGIC with a locally-generated test keypair (accept valid,
 * reject tampered, null without a key). The full v1/v3 payload parse needs real
 * PSA sample IDs + the vendored PSA key, so it's exercised on real data, not here.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizePcn, maskPcn, pcnFingerprint, base45Decode, verifyEd25519,
} from '../../src/utils/philIdQr.js'

describe('PCN helpers', () => {
  it('normalizePcn keeps 16 digits, strips separators, rejects others', () => {
    expect(normalizePcn('1234-5678-9012-3456')).toBe('1234567890123456')
    expect(normalizePcn('1234 5678 9012 3456')).toBe('1234567890123456')
    expect(normalizePcn('123')).toBeNull()
    expect(normalizePcn('')).toBeNull()
  })
  it('maskPcn shows only the last 4', () => {
    expect(maskPcn('1234-5678-9012-3456')).toBe('•••• •••• •••• 3456')
    expect(maskPcn('99')).toBeNull()
  })
})

describe('pcnFingerprint', () => {
  it('is deterministic, PCN-dependent, and only for a full 16-digit PCN', async () => {
    const a = await pcnFingerprint('1234-5678-9012-3456')
    const b = await pcnFingerprint('1234567890123456')
    const c = await pcnFingerprint('0000000000000000')
    expect(a).toMatch(/^[0-9a-f]{64}$/)   // HMAC-SHA256 hex
    expect(a).toBe(b)                       // same PCN → same fingerprint
    expect(a).not.toBe(c)                   // different PCN → different
    expect(await pcnFingerprint('123')).toBeNull()
  })
  it('never contains the raw PCN digits verbatim', async () => {
    const pcn = '4242424242424242'
    expect(await pcnFingerprint(pcn)).not.toContain(pcn)
  })
})

describe('base45Decode (RFC 9285)', () => {
  it('decodes the "AB" vector ("BB8" → 0x41 0x42)', () => {
    expect(Array.from(base45Decode('BB8'))).toEqual([0x41, 0x42])
  })
})

describe('verifyEd25519', () => {
  it('accepts a valid signature, rejects a tampered one, null without a key', async () => {
    const ed = await import('@noble/ed25519')
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js')
    const priv = ed.utils.randomSecretKey()
    const pub  = await ed.getPublicKeyAsync(priv)
    const msg  = utf8ToBytes('hello philsys')
    const sig  = await ed.signAsync(msg, priv)

    expect(await verifyEd25519(sig, msg, bytesToHex(pub))).toBe(true)
    expect(await verifyEd25519(sig, utf8ToBytes('tampered'), bytesToHex(pub))).toBe(false)
    expect(await verifyEd25519(sig, msg, null)).toBeNull()   // no key → unverified
  })
})
