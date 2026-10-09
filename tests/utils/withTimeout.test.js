import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout, modelTimeoutMs } from '../../src/utils/withTimeout'

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with the value when the promise settles before the timeout', async () => {
    const p = withTimeout(Promise.resolve('ok'), 1000, 'x')
    await expect(p).resolves.toBe('ok')
  })

  it('rejects with timeout:<label> when the promise is too slow', async () => {
    // A promise that never settles on its own.
    const p = withTimeout(new Promise(() => {}), 50, 'slow-op')
    const assertion = expect(p).rejects.toThrow('timeout:slow-op')
    await vi.advanceTimersByTimeAsync(50)
    await assertion
  })

  it('propagates the underlying rejection when it fails before the timeout', async () => {
    const p = withTimeout(Promise.reject(new Error('boom')), 1000, 'x')
    await expect(p).rejects.toThrow('boom')
  })

  it('disables the timeout (returns the promise as-is) when ms <= 0', async () => {
    // With no timeout armed, a slow promise still resolves eventually and never
    // rejects with a timeout error.
    const p = withTimeout(Promise.resolve(42), 0, 'x')
    await expect(p).resolves.toBe(42)
  })

  it('clears the timer so a resolved race leaves no pending timeout', async () => {
    const p = withTimeout(Promise.resolve('done'), 1000, 'x')
    await expect(p).resolves.toBe('done')
    // Advancing past the (now-cleared) timeout must not throw an unhandled rejection.
    await vi.advanceTimersByTimeAsync(2000)
  })
})

describe('modelTimeoutMs', () => {
  it('uses the env value when it is a positive finite number', () => {
    expect(modelTimeoutMs('5000')).toBe(5000)
    expect(modelTimeoutMs(1234)).toBe(1234)
  })

  it('falls back on missing / invalid / non-positive values', () => {
    expect(modelTimeoutMs(undefined)).toBe(20000)
    expect(modelTimeoutMs('')).toBe(20000)
    expect(modelTimeoutMs('abc')).toBe(20000)
    expect(modelTimeoutMs('0')).toBe(20000)
    expect(modelTimeoutMs('-100')).toBe(20000)
  })

  it('honors a custom fallback', () => {
    expect(modelTimeoutMs(undefined, 8000)).toBe(8000)
  })
})
