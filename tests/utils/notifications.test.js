import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const addDoc = vi.fn(async () => ({ id: 'n1' }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => path.join('/'),
  addDoc: (...a) => addDoc(...a),
  serverTimestamp: () => 'TS',
}))
vi.mock('../../src/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'staff-1' } } }))

// Phase 1 (T1, gap I5): notify() writes the in-app notification only. Email is
// sent by the sendNotificationEmail Cloud Function; the browser makes no
// network call of its own (the open /api/send-email and /api/send-sms
// endpoints were removed).
describe('notify()', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { addDoc.mockClear(); globalThis.fetch = vi.fn() })
  afterEach(() => { globalThis.fetch = realFetch })

  it('writes the in-app notification with the sender and makes no network call', async () => {
    const { notify } = await import('../../src/utils/notifications.js')
    await notify('pat-1', { type: 'app_advanced', title: 'Update', body: 'Moved', conversationId: 'c1' })
    expect(addDoc).toHaveBeenCalledTimes(1)
    const [path, data] = addDoc.mock.calls[0]
    expect(path).toBe('notifications/pat-1/items')
    expect(data).toMatchObject({ type: 'app_advanced', title: 'Update', body: 'Moved', read: false, fromUid: 'staff-1', conversationId: 'c1' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('logs a failed write to notificationErrors and still resolves', async () => {
    addDoc.mockImplementationOnce(async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }) })
    const { notify } = await import('../../src/utils/notifications.js')
    await expect(notify('pat-1', { title: 't', body: 'b' })).resolves.toBeNull()
    expect(addDoc.mock.calls[1][0]).toBe('notificationErrors')
    expect(addDoc.mock.calls[1][1]).toMatchObject({ recipientUid: 'pat-1', errorCode: 'permission-denied' })
  })
})
