/**
 * requestDraft degrades gracefully. The real store is IndexedDB (exercised on a
 * device); in node/jsdom there is no `indexedDB`, which is exactly the
 * can't-persist case (private window, denied storage) the util must survive —
 * every op becomes a silent no-op and NEVER throws, so the request wizard works
 * with or without a working store.
 */
import { describe, it, expect } from 'vitest'
import { saveRequestDraft, loadRequestDraft, clearRequestDraft } from '../../src/utils/requestDraft'

describe('requestDraft (no IndexedDB available)', () => {
  it('never throws and returns safe values when the store is unavailable', async () => {
    await expect(saveRequestDraft('uid-1', { form: { totalBill: '100' }, step: 1 })).resolves.toBeUndefined()
    await expect(loadRequestDraft('uid-1')).resolves.toBeNull()
    await expect(clearRequestDraft('uid-1')).resolves.toBeUndefined()
  })

  it('no-ops on a missing uid', async () => {
    await expect(saveRequestDraft('', { form: {} })).resolves.toBeUndefined()
    await expect(loadRequestDraft('')).resolves.toBeNull()
    await expect(clearRequestDraft('')).resolves.toBeUndefined()
  })
})
