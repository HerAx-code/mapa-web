import { describe, it, expect } from 'vitest'
import { sweepThresholds, sampleFromDoc } from '../../src/utils/calibration'

// Well-separated synthetic scores: genuine cluster high (~0.8), impostor low (~0.3).
const genuine  = Array.from({ length: 100 }, (_, i) => ({ score: 0.70 + (i % 20) * 0.01, genuine: true }))   // 0.70..0.89
const impostor = Array.from({ length: 100 }, (_, i) => ({ score: 0.20 + (i % 20) * 0.01, genuine: false }))  // 0.20..0.39
const samples = [...genuine, ...impostor]

describe('sweepThresholds', () => {
  it('counts genuine vs impostor', () => {
    const { counts } = sweepThresholds(samples)
    expect(counts).toEqual({ genuine: 100, impostor: 100 })
  })

  it('FAR is monotonically non-increasing as the threshold rises', () => {
    const { rows } = sweepThresholds(samples)
    const fars = rows.filter(r => r.far != null).map(r => r.far)
    for (let i = 1; i < fars.length; i++) expect(fars[i]).toBeLessThanOrEqual(fars[i - 1])
  })

  it('FRR is monotonically non-decreasing as the threshold rises', () => {
    const { rows } = sweepThresholds(samples)
    const frrs = rows.filter(r => r.frr != null).map(r => r.frr)
    for (let i = 1; i < frrs.length; i++) expect(frrs[i]).toBeGreaterThanOrEqual(frrs[i - 1])
  })

  it('picks an operating point meeting the FAR target, between the clusters', () => {
    const { operatingPoint } = sweepThresholds(samples, { targetFar: 0.0 })
    expect(operatingPoint).not.toBeNull()
    expect(operatingPoint.far).toBeLessThanOrEqual(0.0)
    // With this separation, a 0% FAR is reachable above the impostor cluster (>0.39)
    // and below the genuine cluster (<0.70), so genuine are all still accepted.
    expect(operatingPoint.threshold).toBeGreaterThan(0.39)
    expect(operatingPoint.threshold).toBeLessThanOrEqual(0.70)
    expect(operatingPoint.frr).toBe(0)
  })

  it('EER sits near the separation gap with near-zero error for separable data', () => {
    const { eer } = sweepThresholds(samples)
    expect(eer).not.toBeNull()
    expect(eer.far).toBeLessThanOrEqual(0.05)
    expect(eer.frr).toBeLessThanOrEqual(0.05)
  })

  it('handles empty / single-class input without throwing', () => {
    expect(sweepThresholds([]).operatingPoint).toBeNull()
    const onlyGenuine = sweepThresholds(genuine)
    expect(onlyGenuine.operatingPoint).toBeNull() // no impostors → can't measure FAR
    expect(onlyGenuine.eer).toBeNull()
  })

  it('ignores non-numeric scores', () => {
    const { counts } = sweepThresholds([{ score: 'x', genuine: true }, { score: NaN, genuine: false }, { score: 0.5, genuine: true }])
    expect(counts).toEqual({ genuine: 1, impostor: 0 })
  })
})

describe('sampleFromDoc', () => {
  it('maps verified → genuine, rejected → impostor, pending → null', () => {
    expect(sampleFromDoc({ faceMatchScore: 0.8, status: 'verified' })).toEqual({ score: 0.8, genuine: true })
    expect(sampleFromDoc({ faceMatchScore: 0.3, status: 'rejected' })).toEqual({ score: 0.3, genuine: false })
    expect(sampleFromDoc({ faceMatchScore: 0.5, status: 'pending' })).toBeNull()
  })

  it('skips docs without the requested score key', () => {
    expect(sampleFromDoc({ status: 'verified' }, 'faceMatchScore')).toBeNull()
    expect(sampleFromDoc({ livenessScore: 0.7, status: 'verified' }, 'livenessScore')).toEqual({ score: 0.7, genuine: true })
  })
})
