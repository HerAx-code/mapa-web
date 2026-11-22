#!/usr/bin/env node
// Two-factor stage 2 readiness (Phase 5 PR 5.4, decision P5-D). Read-only.
//
// Lists every ACTIVE staff profile with a sign-in account, per hospital and
// agency, and whether it has a second factor enrolled. Stage 2 (the rules and
// functions refusing staff sessions without one) is turned on only when this
// shows nobody missing — and not before 2026-12-06. Share the "still to enrol"
// list with each hospital and agency so they can chase their own staff.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/report-staff-mfa.mjs
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const auth = getAuth()

const STAFF = ['platform_admin', 'super_admin', 'staff_admin', 'agency_admin', 'agency']
const [users, hospitals, agencies] = await Promise.all([
  db.collection('users').where('role', 'in', STAFF).get(),
  db.collection('hospitals').get(),
  db.collection('agencies').get(),
])
const placeName = new Map([
  ...hospitals.docs.map((h) => [h.id, h.data().shortName || h.data().facilityName || h.id]),
  ...agencies.docs.map((a) => [a.id, a.data().name || a.id]),
])

const groups = new Map() // place → { enrolled: [], missing: [] }
let enrolled = 0, missing = 0, skipped = 0
for (const u of users.docs) {
  const d = u.data()
  if (d.active === false) { skipped++; continue }
  let account
  try { account = await auth.getUser(u.id) } catch { skipped++; continue }
  if (account.disabled) { skipped++; continue }
  const place = d.role === 'platform_admin' ? 'MAPA network (Super Admin)' : placeName.get(d.tenantId ?? d.agencyId) ?? (d.tenantId ?? d.agencyId ?? '—')
  if (!groups.has(place)) groups.set(place, { enrolled: [], missing: [] })
  const ok = (account.multiFactor?.enrolledFactors ?? []).length > 0
  groups.get(place)[ok ? 'enrolled' : 'missing'].push(`${d.name ?? '(no name)'} (${d.role}${account.email ? `, ${account.email}` : ''})`)
  ok ? enrolled++ : missing++
}

for (const [place, g] of [...groups.entries()].sort()) {
  console.log(`\n${place}: ${g.enrolled.length} enrolled, ${g.missing.length} still to enrol`)
  for (const m of g.missing) console.log(`  ✗ ${m}`)
}
console.log(`\n${enrolled + missing} active staff sign-ins: ${enrolled} enrolled, ${missing} still to enrol (${skipped} inactive, disabled or without a sign-in, not counted).`)
console.log(missing === 0
  ? 'Everyone is enrolled. Stage 2 may be turned on (not before 2026-12-06).'
  : 'Stage 2 must stay off until everyone above is enrolled.')
process.exit(0)
