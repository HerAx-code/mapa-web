/**
 * lazyWithReload — route-chunk loader that reloads once on a stale-deploy import
 * failure, and renders normally on success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { lazyWithReload } from '../../src/utils/lazyWithReload'

describe('lazyWithReload', () => {
  let reload
  beforeEach(() => {
    reload = vi.fn()
    vi.stubGlobal('location', { reload, href: 'http://localhost/' })
    try { sessionStorage.clear() } catch { /* ignore */ }
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders the module when the import succeeds (no reload)', async () => {
    const Comp = lazyWithReload(() => Promise.resolve({ default: () => <div>loaded ok</div> }))
    render(<Suspense fallback={<div>loading</div>}><Comp /></Suspense>)
    await waitFor(() => expect(screen.getByText('loaded ok')).toBeTruthy())
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once when the chunk import fails (stale deploy)', async () => {
    const Comp = lazyWithReload(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')))
    render(<Suspense fallback={<div>loading</div>}><Comp /></Suspense>)
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('does not reload again within the guard window', async () => {
    try { sessionStorage.setItem('mapa.chunkReloadedAt', String(Date.now())) } catch { /* ignore */ }
    const err = new TypeError('Failed to fetch dynamically imported module')
    const Comp = lazyWithReload(() => Promise.reject(err))
    // The import will re-throw to the nearest boundary; catch it so the test
    // asserts only that no second reload happened.
    class Boundary extends (await import('react')).Component {
      constructor(p) { super(p); this.state = { caught: false } }
      static getDerivedStateFromError() { return { caught: true } }
      render() { return this.state.caught ? <div>caught</div> : this.props.children }
    }
    render(<Boundary><Suspense fallback={<div>loading</div>}><Comp /></Suspense></Boundary>)
    await waitFor(() => expect(screen.getByText('caught')).toBeTruthy())
    expect(reload).not.toHaveBeenCalled()
  })
})
