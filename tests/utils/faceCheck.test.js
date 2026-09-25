import { describe, it, expect } from 'vitest'
import {
  cosineSimilarity, faceMatchVerdict, livenessVerdict, computeLivenessScore,
} from '../../src/utils/faceCheck.js'
import { FACE_MATCH_HI, LIVENESS_HI } from '../../src/utils/constants.js'

// The heavy face-api paths (detect/embed) need a browser + the model weights,
// so they can't run in node — but the scoring + banding that decides what the
// social worker sees IS pure, and that's what these tests pin. The async
// wrappers are contractually fail-null; that null-safety is exercised here at
// the helper level.

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
  })
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })
  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6)
  })
  it('works on Float32Array descriptors', () => {
    const a = new Float32Array([0.1, 0.2, 0.3, 0.4])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6)
  })
  it('returns null on mismatched length, empty, or non-finite input', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBeNull()
    expect(cosineSimilarity([], [])).toBeNull()
    expect(cosineSimilarity([1, NaN], [1, 2])).toBeNull()
    expect(cosineSimilarity(null, [1])).toBeNull()
    expect(cosineSimilarity([0, 0], [1, 2])).toBeNull() // zero-magnitude vector
  })
})

describe('faceMatchVerdict', () => {
  it('passes at/above the HI threshold', () => {
    expect(faceMatchVerdict(FACE_MATCH_HI)).toBe('pass')
    expect(faceMatchVerdict(FACE_MATCH_HI + 0.1)).toBe('pass')
    expect(faceMatchVerdict(1)).toBe('pass')
  })
  it('is unclear below HI (never a fail/block state)', () => {
    expect(faceMatchVerdict(FACE_MATCH_HI - 0.01)).toBe('unclear')
    expect(faceMatchVerdict(0)).toBe('unclear')
  })
  it('is null when the score is null/NaN (no face / could not run)', () => {
    expect(faceMatchVerdict(null)).toBeNull()
    expect(faceMatchVerdict(undefined)).toBeNull()
    expect(faceMatchVerdict(NaN)).toBeNull()
  })
})

describe('livenessVerdict', () => {
  it('passes at/above the HI threshold, unclear below, null on no score', () => {
    expect(livenessVerdict(LIVENESS_HI)).toBe('pass')
    expect(livenessVerdict(LIVENESS_HI - 0.01)).toBe('unclear')
    expect(livenessVerdict(0)).toBe('unclear')
    expect(livenessVerdict(null)).toBeNull()
    expect(livenessVerdict(NaN)).toBeNull()
  })
})

describe('computeLivenessScore', () => {
  it('returns null only when the check could not run (faceCount null)', () => {
    expect(computeLivenessScore({ faceCount: null })).toBeNull()
    expect(computeLivenessScore()).toBeNull()
  })
  it('scores 0 for no face or multiple faces (drops to unclear, never fail)', () => {
    expect(computeLivenessScore({ faceCount: 0 })).toBe(0)
    expect(computeLivenessScore({ faceCount: 2, faceAreaRatio: 0.3, sharpness: 1 })).toBe(0)
  })
  it('rewards a single, well-framed, sharp face', () => {
    const good = computeLivenessScore({ faceCount: 1, faceAreaRatio: 0.22, sharpness: 1 })
    const poor = computeLivenessScore({ faceCount: 1, faceAreaRatio: 0.03, sharpness: 0 })
    expect(good).toBeGreaterThan(poor)
    expect(good).toBeCloseTo(1, 6)
    expect(poor).toBeCloseTo(0, 6)
  })
  it('keeps the score within [0, 1] for out-of-range metrics', () => {
    const s = computeLivenessScore({ faceCount: 1, faceAreaRatio: 5, sharpness: 5 })
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
  })
  it('a small, blurry single face is well below the pass threshold', () => {
    const s = computeLivenessScore({ faceCount: 1, faceAreaRatio: 0.04, sharpness: 0.1 })
    expect(livenessVerdict(s)).toBe('unclear')
  })
})
