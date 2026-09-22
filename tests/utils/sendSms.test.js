import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../../api/send-sms.js'

// normalizePhone guards the paid SMS channel: it must return the local
// 09XXXXXXXXX form for plausible PH mobiles and null for anything else, so a
// malformed number never spends a Semaphore credit.
describe('normalizePhone', () => {
  it('passes through a valid local 09 number', () => {
    expect(normalizePhone('09171234567')).toBe('09171234567')
    expect(normalizePhone('09324324344')).toBe('09324324344') // demo patient
  })

  it('converts +63 / 63 international forms to local 09', () => {
    expect(normalizePhone('+639171234567')).toBe('09171234567')
    expect(normalizePhone('639171234567')).toBe('09171234567')
  })

  it('strips spaces, dashes, parens and other punctuation', () => {
    expect(normalizePhone('0917 123 4567')).toBe('09171234567')
    expect(normalizePhone('0917-123-4567')).toBe('09171234567')
    expect(normalizePhone('(0917) 123-4567')).toBe('09171234567')
    expect(normalizePhone('+63 917 123 4567')).toBe('09171234567')
  })

  it('accepts a numeric (non-string) argument', () => {
    expect(normalizePhone(639171234567)).toBe('09171234567')
  })

  it('rejects empty / nullish input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })

  it('rejects wrong length', () => {
    expect(normalizePhone('0917123456')).toBeNull()    // 10 digits
    expect(normalizePhone('091712345678')).toBeNull()  // 12 digits, starts 09
    expect(normalizePhone('12345')).toBeNull()
  })

  it('rejects non-09 local prefixes', () => {
    expect(normalizePhone('08171234567')).toBeNull()   // 11 digits but not 09
    expect(normalizePhone('02171234567')).toBeNull()   // landline-shaped
  })

  it('rejects a short 63-prefixed string that is not a full international number', () => {
    expect(normalizePhone('63917123456')).toBeNull()   // 11 digits, 63 not stripped -> not 09
  })

  it('rejects letters / garbage', () => {
    expect(normalizePhone('not-a-number')).toBeNull()
    expect(normalizePhone('0917ABCD567')).toBeNull()
  })
})
