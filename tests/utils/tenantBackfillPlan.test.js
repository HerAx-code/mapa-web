import { describe, it, expect } from 'vitest'
import { COLLECTIONS, decide } from '../../scripts/lib/tenant-backfill-plan.mjs'

// Multi-hospital Phase 3 — which existing docs the backfill stamps
// (scripts/backfill-tenant-id.mjs, docs/multi-hospital-network-plan.md).
const roles = { pat: 'patient', sw: 'staff_admin', coord: 'agency', agadm: 'agency_admin' }
const ctx = { roleOf: (uid) => roles[uid] }

describe('decide', () => {
  it('leaves docs that already have a tenantId alone, in every collection', () => {
    for (const c of Object.keys(COLLECTIONS)) {
      expect(decide(c, { tenantId: 'bgh', role: 'agency' }, ctx)).toBe('already')
    }
  })

  it('treats a blank or non-string tenantId as missing', () => {
    expect(decide('requests', { tenantId: '' }, ctx)).toBe('stamp')
    expect(decide('requests', { tenantId: null }, ctx)).toBe('stamp')
  })

  it('stamps patients and gateway staff, not agency users', () => {
    expect(decide('users', { role: 'patient' }, ctx)).toBe('stamp')
    expect(decide('users', { role: 'super_admin' }, ctx)).toBe('stamp')
    expect(decide('users', { role: 'staff_admin' }, ctx)).toBe('stamp')
    expect(decide('users', { role: 'agency' }, ctx)).toBe('skip')
    expect(decide('users', { role: 'agency_admin' }, ctx)).toBe('skip')
    expect(decide('users', {}, ctx)).toBe('skip')
  })

  it.each(['hospitalIds', 'requests', 'applications', 'documents', 'documentContents', 'certificates', 'referralSuggestions'])(
    'stamps every %s doc', (c) => {
      expect(decide(c, {}, ctx)).toBe('stamp')
    })

  it('stamps conversations with a patient or gateway participant only', () => {
    expect(decide('conversations', { participants: ['sw', 'pat'] }, ctx)).toBe('stamp')
    expect(decide('conversations', { participants: ['coord', 'pat'] }, ctx)).toBe('stamp')
    expect(decide('conversations', { participants: ['coord', 'agadm'] }, ctx)).toBe('skip')
    expect(decide('conversations', { participants: ['coord', 'deleted-user'] }, ctx)).toBe('stamp')
    expect(decide('conversations', {}, ctx)).toBe('skip')
  })

  it('stamps issue reports but not agency budget requests', () => {
    expect(decide('reports', { reporterRole: 'patient' }, ctx)).toBe('stamp')
    expect(decide('reports', { reporterRole: 'agency_admin' }, ctx)).toBe('skip')
    expect(decide('reports', { agencyId: 'dswd' }, ctx)).toBe('skip')
  })

  it('stamps gateway announcements but not agency ones', () => {
    expect(decide('announcements', { source: 'admin' }, ctx)).toBe('stamp')
    expect(decide('announcements', {}, ctx)).toBe('stamp')
    expect(decide('announcements', { source: 'agency' }, ctx)).toBe('skip')
  })

  it('stamps audit entries except those by agency actors', () => {
    expect(decide('auditLog', { actorRole: 'staff_admin' }, ctx)).toBe('stamp')
    expect(decide('auditLog', { actorRole: '' }, ctx)).toBe('stamp')   // system
    expect(decide('auditLog', { actorRole: 'agency' }, ctx)).toBe('skip')
  })
})
