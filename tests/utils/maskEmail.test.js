import { describe, it, expect } from 'vitest'
import { maskEmail, isMaskedEmail, displayEmail } from '../../src/utils/maskEmail.js'

// The network address in these tests is a made-up one; the real one comes
// from VITE_ORG_CONTACT_EMAIL and is never written into the repo.
const NET = 'network.owner@gmail.com'

describe('maskEmail', () => {
  it('keeps the first and last letter of the name, and the domain', () => {
    expect(maskEmail('network.owner@gmail.com')).toBe('n•••••••••••r@gmail.com')
    expect(maskEmail('abc@x.org')).toBe('a•••c@x.org')
  })
  it('still hides very short names', () => {
    expect(maskEmail('ab@x.org')).toBe('a•••@x.org')
    expect(maskEmail('a@x.org')).toBe('a•••@x.org')
  })
  it('leaves non-addresses alone', () => {
    expect(maskEmail('')).toBe('')
    expect(maskEmail('no-at-sign')).toBe('no-at-sign')
  })
})

describe('displayEmail', () => {
  it('masks only the network address, whatever its case or spaces', () => {
    expect(displayEmail(NET, NET, true)).toBe(maskEmail(NET))
    expect(displayEmail(' Network.Owner@Gmail.com ', NET, true)).not.toMatch(/owner/i)
    expect(isMaskedEmail(NET, NET, true)).toBe(true)
  })
  it("shows a hospital's own office address in full", () => {
    expect(displayEmail('mss@hospital.example', NET, true)).toBe('mss@hospital.example')
  })
  it('can be switched off, and does nothing when no network address is set', () => {
    expect(displayEmail(NET, NET, false)).toBe(NET)
    expect(displayEmail(NET, '', true)).toBe(NET)
  })
})
