/**
 * fitDimensions — the pure sizing math behind the patient image-upload
 * compression. Scales an image so its longest edge is <= maxDim while keeping
 * the aspect ratio, so IDs/bills stay legible for OCR without blowing the
 * Firestore byte cap. (The canvas encode itself is DOM-only and not unit-tested.)
 */
import { describe, it, expect } from 'vitest'
import { fitDimensions, IMAGE_MAX_DIM } from '../../src/utils/image.js'

describe('fitDimensions', () => {
  it('leaves an already-small image unchanged', () => {
    expect(fitDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('scales a wide (landscape) image to the long edge, preserving ratio', () => {
    expect(fitDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales a tall (portrait) image to the long edge, preserving ratio', () => {
    expect(fitDimensions(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('handles a square image', () => {
    expect(fitDimensions(4000, 4000, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('defaults to IMAGE_MAX_DIM (1600) and never up-scales', () => {
    expect(IMAGE_MAX_DIM).toBe(1600)
    expect(fitDimensions(1000, 500)).toEqual({ width: 1000, height: 500 })
  })

  it('is defensive about degenerate input', () => {
    expect(fitDimensions(0, 0, 1600)).toEqual({ width: 0, height: 0 })
    expect(fitDimensions(undefined, undefined, 1600)).toEqual({ width: 0, height: 0 })
  })
})
