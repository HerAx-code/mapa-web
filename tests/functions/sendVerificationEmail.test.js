/**
 * sendVerificationEmail — the email-confirmation link, sent through MAPA's own
 * SMTP (hard gate owner decision 2026-11-26). Self-only (the address comes from
 * the token at the call site), a no-op once verified, and rate-limited per uid.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => '' }), defineString: () => ({ value: () => '' }) }))
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code } },
}))

let handleSendVerification, renderVerification
beforeAll(() => {
  ;({ handleSendVerification, renderVerification } = require('../../functions/src/sendVerificationEmail'))
})

const base = (over = {}) => ({
  uid: 'pat1',
  email: 'juan@example.com',
  alreadyVerified: false,
  db: memDb(),
  generateLink: vi.fn(async () => 'https://mapa-crmc.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=abc&apiKey=k&lang=en'),
  sendMail: vi.fn(async () => {}),
  now: () => 1_000_000,
  ...over,
})

describe('handleSendVerification', () => {
  it('sends the link to the caller-token email and reports sent', async () => {
    const args = base()
    const res = await handleSendVerification(args)
    expect(res).toEqual({ sent: true })
    expect(args.generateLink).toHaveBeenCalledWith('juan@example.com')
    expect(args.sendMail).toHaveBeenCalledTimes(1)
    expect(args.sendMail.mock.calls[0][0].to).toBe('juan@example.com')
  })

  it('is a no-op when the email is already verified', async () => {
    const args = base({ alreadyVerified: true })
    const res = await handleSendVerification(args)
    expect(res).toEqual({ sent: false, reason: 'already-verified' })
    expect(args.generateLink).not.toHaveBeenCalled()
    expect(args.sendMail).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated / emailless caller', async () => {
    await expect(handleSendVerification(base({ uid: null }))).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(handleSendVerification(base({ email: '' }))).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rate-limits per uid within the hourly window', async () => {
    const db = memDb()
    const mk = () => base({ db, max: 3 })
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      expect(await handleSendVerification(mk())).toEqual({ sent: true })
    }
    await expect(handleSendVerification(mk())).rejects.toMatchObject({ code: 'resource-exhausted' })
  })

  it('surfaces a link-generation failure as internal, without sending', async () => {
    const args = base({ generateLink: vi.fn(async () => { throw new Error('boom') }) })
    await expect(handleSendVerification(args)).rejects.toMatchObject({ code: 'internal' })
    expect(args.sendMail).not.toHaveBeenCalled()
  })

  it('escapes the link in the HTML body', () => {
    const { html, text, subject } = renderVerification({ link: 'https://x/?a=1&b=2' })
    expect(subject).toContain('Confirm your email')
    expect(html).toContain('a=1&amp;b=2')
    expect(text).toContain('https://x/?a=1&b=2')
  })
})
