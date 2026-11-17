import { describe, it, expect } from 'vitest'
import { FUNDING_TYPE_VALUES, fundingTypeLabel, fundingTypeShort, fundingSummary } from '../../src/utils/fundingType.js'
import fs from 'node:fs'
import path from 'node:path'

describe('fundingType', () => {
  it('labels each type, and an unset one', () => {
    expect(fundingTypeLabel('private')).toBe('Private / NGO fund')
    expect(fundingTypeShort('regional_program')).toBe('BARMM / regional')
    expect(fundingTypeLabel(undefined)).toBe('Type not set')
    expect(fundingTypeLabel('bogus')).toBe('Type not set')
  })
  it('summarises type and fund source', () => {
    expect(fundingSummary({ fundingType: 'private', budget: { fundSource: 'Alagang Tingog Monthly Fund' } }))
      .toBe('Private / NGO fund · Alagang Tingog Monthly Fund')
    expect(fundingSummary({})).toBe('Type not set')
  })
  it('matches the list the rules accept', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8')
    const m = /fundingType in \[([^\]]+)\]/.exec(rules)
    const inRules = m[1].split(',').map(s => s.trim().replace(/'/g, ''))
    expect(inRules).toEqual(FUNDING_TYPE_VALUES)
  })
})
