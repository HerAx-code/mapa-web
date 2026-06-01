import { describe, it, expect } from 'vitest'
import { firstGivenName, hasReservedToken } from '../../src/utils/names.js'

// firstGivenName powers the Welcome toast on Login.jsx. The bug it was
// introduced to fix (B.14 / L8) was "Welcome back, Dr.!" -- the previous
// implementation took name.split(' ')[0] and grabbed the honorific.
describe('firstGivenName', () => {
  it('returns the first non-honorific token', () => {
    expect(firstGivenName('Dr. Roberto Velasco')).toBe('Roberto')
    expect(firstGivenName('Atty. Maria Santos')).toBe('Maria')
    expect(firstGivenName('Engr. Juan Dela Cruz Jr.')).toBe('Juan')
  })

  it('passes plain names through unchanged', () => {
    expect(firstGivenName('Juan Dela Cruz')).toBe('Juan')
    expect(firstGivenName('Sibil')).toBe('Sibil')
  })

  it('handles double-honorifics', () => {
    expect(firstGivenName('Dr Dr Roberto')).toBe('Roberto')
    expect(firstGivenName('Hon. Dr. Maria')).toBe('Maria')
  })

  it('strips trailing comma/semicolon punctuation but keeps the period in suffixes', () => {
    expect(firstGivenName('Mrs. Doubtfire')).toBe('Doubtfire')
    expect(firstGivenName('Juan, Dela Cruz')).toBe('Juan')
  })

  it('falls back to the raw input on empty or all-honorific input', () => {
    expect(firstGivenName('')).toBe('')
    expect(firstGivenName(null)).toBe(null)
    expect(firstGivenName(undefined)).toBe(undefined)
  })

  it('is case-insensitive on the honorific match', () => {
    expect(firstGivenName('DR. Roberto')).toBe('Roberto')
    expect(firstGivenName('atty. Maria')).toBe('Maria')
  })
})

// hasReservedToken is the gate in Register.jsx that blocks role-impersonating
// patient names. The threat: a registered patient with name "CRMC Admin"
// shows up in admin/Patients alongside legitimate accounts and can be
// mistaken for an internal user when an admin is scanning the list. See
// the L14 finding in B.14.
describe('hasReservedToken', () => {
  it('rejects whole-token matches of reserved words', () => {
    expect(hasReservedToken('Admin')).toBe(true)
    expect(hasReservedToken('System Diagnostics')).toBe(true)
    expect(hasReservedToken('NUKE')).toBe(true)
    expect(hasReservedToken('CRMC Admin')).toBe(true)
    expect(hasReservedToken('cascade')).toBe(true)
    expect(hasReservedToken('Maria Admin')).toBe(true)
  })

  it('does not match substrings inside legitimate names', () => {
    // Famously: "Admiral" contains "admir", "Testarossa" contains "test".
    // We want whole-token matching, not substring.
    expect(hasReservedToken('Admiral')).toBe(false)
    expect(hasReservedToken('Testarossa')).toBe(false)
    expect(hasReservedToken('Crystal')).toBe(false)
    expect(hasReservedToken('Christopher')).toBe(false)
  })

  it('passes plain Filipino names', () => {
    expect(hasReservedToken('Maria Santos')).toBe(false)
    expect(hasReservedToken('Juan Dela Cruz Jr.')).toBe(false)
    expect(hasReservedToken('Ñoño')).toBe(false)
    expect(hasReservedToken('Sibil Bin Bilsi')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(hasReservedToken('ADMIN')).toBe(true)
    expect(hasReservedToken('admin')).toBe(true)
    expect(hasReservedToken('AdMiN')).toBe(true)
  })

  it('handles empty / null / undefined input without crashing', () => {
    expect(hasReservedToken('')).toBe(false)
    expect(hasReservedToken(null)).toBe(false)
    expect(hasReservedToken(undefined)).toBe(false)
  })

  it('catches reserved words even when not the first token', () => {
    // "Maria Admin" should be caught even though "Admin" is the surname.
    expect(hasReservedToken('Maria Admin')).toBe(true)
    expect(hasReservedToken('Juan System')).toBe(true)
  })
})