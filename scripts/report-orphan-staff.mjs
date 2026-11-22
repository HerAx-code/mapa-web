#!/usr/bin/env node
// Phase 5 PR 5.3 (decision P5-C, leftover L2): staff profiles (users/{uid}
// with a staff role) that have no sign-in account behind them — leftovers of
// deleted or demo accounts. They still show in team lists and email lookups.
//
// Report-only by default. With --write it marks each one `active: false,
// orphaned: true` (with the date). It NEVER deletes a profile: audit entries
// and case history name these people, and the profile keeps the name readable.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/report-orphan-staff.mjs            # report
//   node scripts/report-orphan-staff.mjs --write    # mark them
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

const write = process.argv.includes('--write')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const auth = getAuth()

const STAFF = ['platform_admin', 'super_admin', 'staff_admin', 'agency_admin', 'agency']
const millis = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : null)
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—')

const users = await db.collection('users').where('role', 'in', STAFF).get()
const orphans = []
for (const u of users.docs) {
  const d = u.data()
  if (d.orphaned === true) continue
  try {
    await auth.getUser(u.id)
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err
    // Last activity: their most recent audit entry, else the profile's dates.
    const last = await db.collection('auditLog').where('actorId', '==', u.id).get()
    const lastAt = Math.max(0, ...last.docs.map((x) => millis(x.data().createdAt) ?? 0)) || millis(d.updatedAt) || millis(d.createdAt)
    orphans.push({ ref: u.ref, uid: u.id, name: d.name ?? '(no name)', role: d.role, where: d.tenantId ?? d.agencyId ?? '—', active: d.active !== false, lastAt, entries: last.size })
  }
}

for (const o of orphans) {
  console.log(`  ${o.active ? '●' : '○'} ${o.name} · ${o.role} · ${o.where} · last activity ${day(o.lastAt)} · ${o.entries} audit entr${o.entries === 1 ? 'y' : 'ies'} · ${o.uid}`)
  if (write) await o.ref.update({ active: false, orphaned: true, orphanedAt: FieldValue.serverTimestamp() })
}
console.log(`\n${users.size} staff profiles; ${orphans.length} without a sign-in account (● still active).`)
console.log(write ? `Marked ${orphans.length} inactive and orphaned.` : 'Report only. Run with --write to mark them inactive (never deleted).')
process.exit(0)
