import { describe, it, expect } from 'vitest'
import { PH_REGIONS } from '../../src/utils/hospitalConfig.js'
import { PROVINCES_BY_REGION, NCR_PROVINCE, NCR_CITIES, citiesFor } from '../../src/data/phProvinces.js'
import { BARMM_PROVINCES } from '../../src/utils/barmm.js'

describe('provinces by region (For Hospitals dropdowns)', () => {
  it('has a province list for exactly the regions the form offers', () => {
    expect(Object.keys(PROVINCES_BY_REGION).sort()).toEqual([...PH_REGIONS].sort())
    for (const r of PH_REGIONS) expect(PROVINCES_BY_REGION[r].length).toBeGreaterThan(0)
  })
  it('lists each province once, nationwide', () => {
    const all = Object.values(PROVINCES_BY_REGION).flat()
    expect(new Set(all).size).toBe(all.length)
  })
  it('BARMM comes from the one BARMM list, without Sulu', () => {
    expect(PROVINCES_BY_REGION.BARMM).toBe(BARMM_PROVINCES)
    expect(Object.values(PROVINCES_BY_REGION).flat()).not.toContain('Sulu')
  })
  it('the Negros Island Region holds the Negros provinces and Siquijor', () => {
    expect(PROVINCES_BY_REGION.NIR).toEqual(['Negros Occidental', 'Negros Oriental', 'Siquijor'])
    expect(PROVINCES_BY_REGION['Region VI']).not.toContain('Negros Occidental')
    expect(PROVINCES_BY_REGION['Region VII']).not.toContain('Negros Oriental')
  })
  it('gives a city list for BARMM provinces and Metro Manila only', () => {
    expect(citiesFor('NCR', NCR_PROVINCE)).toBe(NCR_CITIES)
    expect(NCR_CITIES).toHaveLength(17)
    expect(citiesFor('BARMM', 'Lanao del Sur').length).toBeGreaterThan(10)
    expect(citiesFor('Region XI', 'Davao del Norte')).toBeNull()
    expect(citiesFor('BARMM', 'Sulu')).toBeNull()
  })
})
