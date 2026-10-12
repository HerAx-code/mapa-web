import { describe, it, expect } from 'vitest'
import { periodicityRatio, computeRecaptureScore, recaptureVerdict } from '../../src/utils/recaptureCheck'
import { RECAPTURE_HI } from '../../src/utils/constants'

describe('periodicityRatio', () => {
  it('is high for a strong periodic (banding) signal', () => {
    const N = 64
    const sine = Array.from({ length: N }, (_, i) => 128 + 100 * Math.sin((2 * Math.PI * 8 * i) / N))
    expect(periodicityRatio(sine)).toBeGreaterThan(0.3)
  })

  it('is ~0 for a flat signal', () => {
    expect(periodicityRatio(new Array(64).fill(128))).toBe(0)
  })

  it('is low for a smooth gradient (energy sits in the excluded low band)', () => {
    const N = 64
    const ramp = Array.from({ length: N }, (_, i) => (i / N) * 255)
    const sine = Array.from({ length: N }, (_, i) => 128 + 100 * Math.sin((2 * Math.PI * 8 * i) / N))
    expect(periodicityRatio(ramp)).toBeLessThan(periodicityRatio(sine))
  })

  it('handles too-short input', () => {
    expect(periodicityRatio([1, 2, 3])).toBe(0)
    expect(periodicityRatio([])).toBe(0)
  })
})

describe('computeRecaptureScore', () => {
  it('weights moiré 0.7 and specular 0.3', () => {
    expect(computeRecaptureScore({ moireRatio: 1, specularFraction: 0 })).toBeCloseTo(0.7, 5)
    expect(computeRecaptureScore({ moireRatio: 0, specularFraction: 0.15 })).toBeCloseTo(0.3, 5)
    expect(computeRecaptureScore({ moireRatio: 0, specularFraction: 0 })).toBe(0)
  })

  it('clamps to [0,1]', () => {
    expect(computeRecaptureScore({ moireRatio: 5, specularFraction: 5 })).toBe(1)
    expect(computeRecaptureScore({})).toBe(0)
  })
})

describe('recaptureVerdict', () => {
  it('flags at/above RECAPTURE_HI, clears below, null-safe', () => {
    expect(recaptureVerdict(RECAPTURE_HI)).toBe(true)
    expect(recaptureVerdict(RECAPTURE_HI + 0.1)).toBe(true)
    expect(recaptureVerdict(RECAPTURE_HI - 0.1)).toBe(false)
    expect(recaptureVerdict(null)).toBeNull()
    expect(recaptureVerdict(NaN)).toBeNull()
  })
})
