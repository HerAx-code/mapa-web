import { describe, it, expect } from 'vitest'
import { normalizeBillNumber, billKeyId } from '../../src/utils/billKeys.js'

// The same bill must produce the same key however staff type its number.
describe('normalizeBillNumber', () => {
  it('compares letters and digits only, ignoring a leading "SOA No."', () => {
    expect(normalizeBillNumber('SOA No. 2026-001 234')).toBe('2026001234')
    expect(normalizeBillNumber('soa-2026001234')).toBe('2026001234')
    expect(normalizeBillNumber(' 2026/001234 ')).toBe('2026001234')
    expect(normalizeBillNumber('IP-77a')).toBe('IP77A')
  })
  it('is empty for blank input', () => {
    expect(normalizeBillNumber('  ')).toBe('')
    expect(normalizeBillNumber(null)).toBe('')
  })
  it('keys are per hospital', () => {
    expect(billKeyId('crmc', 'SOA 12')).toBe('crmc__12')
    expect(billKeyId('crmc', '12')).not.toBe(billKeyId('other', '12'))
  })
})
