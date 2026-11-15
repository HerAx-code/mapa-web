import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import * as web from '../../src/utils/codeIssue.js'
const require = createRequire(import.meta.url)
const server = require('../../functions/src/codeIssue.js')

// Patient-bound codes: the browser (Register / IssueCodeModal), the Cloud
// Function and the Firestore rules must build the SAME proof string.
describe('codeIssue', () => {
  it('last names compare on letters only', () => {
    expect(web.lastNameKey('Dela Cruz')).toBe('DELACRUZ')
    expect(web.lastNameKey('dela-cruz ')).toBe('DELACRUZ')
    expect(web.lastNameKey('Peñaflor')).toBe('PENAFLOR')
  })
  it('the proof matches the rules pattern [A-Z]+[|]<birthdate>', () => {
    expect(web.codeProof('Dela Cruz', '1990-05-01')).toMatch(/^[A-Z]+\|1990-05-01$/)
  })
  it('browser and server copies agree', () => {
    for (const n of ['Dela Cruz', "O'Neil", 'Peñaflor', 'Abdul-Rahman', 'ñ']) {
      expect(server.lastNameKey(n)).toBe(web.lastNameKey(n))
      expect(server.codeProof(n, '2000-01-31')).toBe(web.codeProof(n, '2000-01-31'))
    }
    expect(server.BLANK_CODE_CUTOFF).toBe(web.BLANK_CODE_CUTOFF)
  })
  it('the full name is built the way Register builds it', () => {
    expect(web.fullNameOf({ firstName: 'Ana ', middleName: '', lastName: 'Dela Cruz', suffix: 'Jr.' })).toBe('Ana Dela Cruz Jr.')
  })
  it('blank codes expire at Manila midnight on the cutoff', () => {
    expect(web.blankCodeExpired(new Date('2026-12-14T23:59:00+08:00'))).toBe(false)
    expect(web.blankCodeExpired(new Date('2026-12-15T00:00:00+08:00'))).toBe(true)
  })
  it('birthdates must be YYYY-MM-DD', () => {
    expect(web.isBirthdate('1990-05-01')).toBe(true)
    expect(web.isBirthdate('05/01/1990')).toBe(false)
  })
})
