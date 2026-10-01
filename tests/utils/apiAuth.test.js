import { describe, it, expect } from 'vitest'
import { authorizeSend, parseFirestoreFields } from '../../api/_lib/auth.js'
import { buildEmailHtml, escapeHtml } from '../../api/send-email.js'

// C2 regression tests: these pin the server-side authorization that closed the
// email/SMS open relay. authorizeSend is the one decision that says who may send
// to whom on which channel; if it ever loosens, a patient could phish or burn SMS
// credit again. All pure — no network.

const CALLER = 'caller-uid'
const OTHER  = 'other-uid'
const prof = (role, extra = {}) => ({ role, active: true, deletion: false, ...extra })

describe('authorizeSend — channel + role matrix', () => {
  const staffAndAgency = ['super_admin', 'staff_admin', 'agency_admin', 'agency']

  it('allows staff/agency to EMAIL any user', () => {
    for (const role of staffAndAgency) {
      expect(authorizeSend({ callerUid: CALLER, caller: prof(role), targetUid: OTHER, channel: 'email' }).ok).toBe(true)
    }
  })

  it('allows staff/agency to SMS any user', () => {
    for (const role of staffAndAgency) {
      expect(authorizeSend({ callerUid: CALLER, caller: prof(role), targetUid: OTHER, channel: 'sms' }).ok).toBe(true)
    }
  })

  it('lets a patient EMAIL only themselves', () => {
    expect(authorizeSend({ callerUid: CALLER, caller: prof('patient'), targetUid: CALLER, channel: 'email' }).ok).toBe(true)
    const other = authorizeSend({ callerUid: CALLER, caller: prof('patient'), targetUid: OTHER, channel: 'email' })
    expect(other.ok).toBe(false)
    expect(other.status).toBe(403)
  })

  it('never lets a patient send SMS (even to themselves)', () => {
    expect(authorizeSend({ callerUid: CALLER, caller: prof('patient'), targetUid: CALLER, channel: 'sms' }).ok).toBe(false)
    expect(authorizeSend({ callerUid: CALLER, caller: prof('patient'), targetUid: OTHER, channel: 'sms' }).ok).toBe(false)
  })

  it('denies when there is no caller profile', () => {
    const r = authorizeSend({ callerUid: CALLER, caller: null, targetUid: CALLER, channel: 'email' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  it('denies a disabled or deleted caller, whatever the role', () => {
    expect(authorizeSend({ callerUid: CALLER, caller: prof('super_admin', { active: false }), targetUid: OTHER, channel: 'email' }).ok).toBe(false)
    expect(authorizeSend({ callerUid: CALLER, caller: prof('agency', { deletion: true }), targetUid: OTHER, channel: 'sms' }).ok).toBe(false)
    expect(authorizeSend({ callerUid: CALLER, caller: prof('patient', { active: false }), targetUid: CALLER, channel: 'email' }).ok).toBe(false)
  })

  it('denies an unknown channel', () => {
    expect(authorizeSend({ callerUid: CALLER, caller: prof('super_admin'), targetUid: OTHER, channel: 'carrier-pigeon' }).ok).toBe(false)
  })
})

describe('parseFirestoreFields — Firestore REST value parser', () => {
  it('parses the field types a user doc uses', () => {
    const parsed = parseFirestoreFields({
      email:    { stringValue: 'a@b.com' },
      role:     { stringValue: 'patient' },
      active:   { booleanValue: true },
      deletion: { booleanValue: false },
      contact:  { nullValue: null },
      cooldown: { integerValue: '0' },
      score:    { doubleValue: 1.5 },
      tags:     { arrayValue: { values: [{ stringValue: 'x' }, { stringValue: 'y' }] } },
    })
    expect(parsed).toEqual({
      email: 'a@b.com', role: 'patient', active: true, deletion: false,
      contact: null, cooldown: 0, score: 1.5, tags: ['x', 'y'],
    })
  })

  it('returns {} for an empty / missing fields map', () => {
    expect(parseFirestoreFields()).toEqual({})
    expect(parseFirestoreFields({})).toEqual({})
  })
})

describe('server email template escapes HTML', () => {
  it('escapes angle brackets, ampersands and quotes', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;')
  })

  it('never emits an unescaped tag from subject or body', () => {
    const html = buildEmailHtml('<script>evil()</script>', 'click <a href="//evil">here</a> & win')
    expect(html).not.toContain('<script>evil()')
    expect(html).not.toContain('<a href="//evil">')
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;')
    expect(html).toContain('&lt;a href=&quot;//evil&quot;&gt;')
  })
})
