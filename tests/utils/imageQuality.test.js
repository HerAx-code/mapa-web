/**
 * exposureStats / exposureVerdict — the pure math behind the advisory ID-photo
 * exposure nudge (glare / too dark). Deterministic pixel statistics, so it's
 * unit-testable without a DOM/canvas. Thresholds are conservative — a normal
 * photo must resolve to null (no nudge).
 */
import { describe, it, expect } from 'vitest'
import { exposureStats, exposureVerdict } from '../../src/utils/imageQuality.js'

// Build an RGBA buffer of `n` pixels all at luminance `v` (gray).
const gray = (v, n = 100) => {
  const d = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n * 4; i += 4) { d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 }
  return d
}
// Mix: `brightN` blown-out pixels + rest mid-gray.
const mix = (brightN, restV, total = 100) => {
  const d = new Uint8ClampedArray(total * 4)
  for (let i = 0; i < total; i++) {
    const v = i < brightN ? 255 : restV
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255
  }
  return d
}

describe('exposureStats', () => {
  it('computes mean luminance for a flat gray image', () => {
    expect(Math.round(exposureStats(gray(128)).meanLum)).toBe(128)
  })
  it('counts blown-out and crushed fractions', () => {
    const s = exposureStats(mix(50, 128))
    expect(s.brightFrac).toBeCloseTo(0.5, 2)
    expect(s.darkFrac).toBe(0)
  })
  it('handles empty input', () => {
    expect(exposureStats(new Uint8ClampedArray(0))).toEqual({ meanLum: 0, brightFrac: 0, darkFrac: 0 })
  })
})

describe('exposureVerdict', () => {
  it('a normal mid-exposed photo → no nudge (null)', () => {
    expect(exposureVerdict(exposureStats(gray(140)))).toBeNull()
  })
  it('heavy glare (>35% blown out) → glare', () => {
    expect(exposureVerdict(exposureStats(mix(40, 150)))).toBe('glare')
  })
  it('very dark (mean < 45) → dark', () => {
    expect(exposureVerdict(exposureStats(gray(30)))).toBe('dark')
  })
  it('borderline bright but under threshold → null (conservative, no false alarm)', () => {
    expect(exposureVerdict(exposureStats(mix(20, 150)))).toBeNull() // 20% blown out < 35%
  })
  it('null stats → null', () => {
    expect(exposureVerdict(null)).toBeNull()
  })
})
