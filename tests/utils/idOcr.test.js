import { describe, it, expect } from 'vitest'
import { detectIdType, isIdType, nameMatches } from '../../src/utils/idOcr.js'

// The OCR pipeline itself (tesseract) needs a browser/wasm worker, but the
// text-side helpers — the advisory ID-type guess and the name match — are pure
// and are what the social worker actually sees. Those are pinned here.

describe('detectIdType', () => {
  it('reads common Philippine ID types from noisy OCR text', () => {
    expect(detectIdType('REPUBLIKA NG PILIPINAS\nDRIVERS LICENSE\nDELA CRUZ, JUAN')).toBe("Driver's License")
    expect(detectIdType('Unified Multi-Purpose ID  UMID  SSS GSIS')).toBe('UMID')
    expect(detectIdType('PHILIPPINE IDENTIFICATION\nPhilSys PSN 1234')).toBe('PhilSys / National ID')
    expect(detectIdType('PhilHealth Identification Number')).toBe('PhilHealth ID')
    expect(detectIdType('Republic of the Philippines PASSPORT')).toBe('Passport')
    expect(detectIdType('Senior Citizen OSCA ID')).toBe('Senior Citizen ID')
    expect(detectIdType('PWD person with disability')).toBe('PWD ID')
    expect(detectIdType('Barangay Certification / Barangay ID')).toBe('Barangay ID')
  })
  it('prefers the more specific match (UMID over a bare national id)', () => {
    expect(detectIdType('Unified Multi-Purpose ID national id')).toBe('UMID')
  })
  it('returns null for empty, whitespace, or unrecognized text', () => {
    expect(detectIdType('')).toBeNull()
    expect(detectIdType('   \n ')).toBeNull()
    expect(detectIdType('some random receipt text')).toBeNull()
    expect(detectIdType(null)).toBeNull()
    expect(detectIdType(undefined)).toBeNull()
  })
})

describe('isIdType', () => {
  it('matches document-type names that read as an ID', () => {
    expect(isIdType('Valid ID')).toBe(true)
    expect(isIdType('Government Identification')).toBe(true)
    expect(isIdType('Billing Statement')).toBe(false)
    expect(isIdType('')).toBe(false)
  })
})

describe('nameMatches', () => {
  it('is true when enough significant name tokens appear in the text', () => {
    expect(nameMatches('DELA CRUZ, JUAN MIGUEL', 'Juan Miguel Dela Cruz')).toBe(true)
  })
  it('is false when the name is absent', () => {
    expect(nameMatches('SOME OTHER PERSON', 'Juan Miguel Dela Cruz')).toBe(false)
  })
  it('is null when it cannot tell (empty text or no significant tokens)', () => {
    expect(nameMatches('', 'Juan Dela Cruz')).toBeNull()
    expect(nameMatches('anything', 'Al Bo')).toBeNull() // tokens < 3 chars
  })
})
