#!/usr/bin/env node
// One-off backfill for Phase 3 PR 3.3 (P3-C / D11): tag existing hospital ↔
// patient conversations as their case's conversation, so the hospital's other
// social workers can open them (openCaseConversation joins the caller).
//
// A conversation qualifies when it has exactly one patient and at least one
// gateway staff member (Hospital Admin / Staff Admin) as participants and no
// `kind` yet. Its case is, at the staff member's hospital: the patient's
// active request if it is there, else their most recent request there. The
// request must not already have a case conversation. Anything ambiguous is
// listed and left alone.
//
// Report-only by default; pass --write to apply.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/backfill-case-conversations.mjs            # report
//   node scripts/backfill-case-conversations.mjs --write    # apply
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const write = process.argv.includes('--write')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const GATEWAY = ['super_admin', 'staff_admin']
const millis = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : 0)
const users = new Map()
const userOf = async (uid) => {
  if (!users.has(uid)) {
    const s = await db.doc(`users/${uid}`).get()
    users.set(uid, s.exists ? s.data() : null)
  }
  return users.get(uid)
}

const convs = await db.collection('conversations').get()
const claimed = new Set()     // requests given a conversation in this run
let tagged = 0
let skipped = 0
for (const c of convs.docs) {
  const conv = c.data()
  if (conv.kind) continue
  const people = await Promise.all((conv.participants ?? []).map(async (u) => ({ uid: u, user: await userOf(u) })))
  const patients = people.filter((p) => p.user?.role === 'patient')
  const staff = people.filter((p) => GATEWAY.includes(p.user?.role))
  if (patients.length !== 1 || !staff.length) continue
  const patient = patients[0]
  const tenantId = conv.tenantId || staff[0].user.tenantId
  if (!tenantId) { skipped++; console.log(`  ? ${c.id}: staff member has no hospital — left alone`); continue }

  const reqs = (await db.collection('requests').where('patientId', '==', patient.uid).get()).docs
    .filter((r) => r.data().tenantId === tenantId)
  const active = reqs.find((r) => r.id === patient.user.activeRequestId)
  const latest = [...reqs].sort((a, b) => millis(b.data().submittedAt) - millis(a.data().submittedAt))[0]
  const target = active ?? latest
  if (!target) { skipped++; console.log(`  ? ${c.id}: no request at ${tenantId} for this patient — left alone`); continue }
  if (target.data().caseConversationId || claimed.has(target.id)) {
    skipped++
    console.log(`  ? ${c.id}: ${target.data().requestId ?? target.id} already has a case conversation — left alone`)
    continue
  }
  claimed.add(target.id)
  tagged++
  console.log(`  → ${c.id}: case conversation of ${target.data().requestId ?? target.id} (${tenantId})`)
  if (write) {
    const batch = db.batch()
    batch.update(c.ref, { kind: 'case', tenantId, requestId: target.id })
    batch.update(target.ref, { caseConversationId: c.id })
    await batch.commit()
  }
}

console.log(`\n${convs.size} conversations; ${tagged} become case conversations; ${skipped} left alone.`)
console.log(write ? 'Written.' : 'Report only. Run with --write to apply.')
process.exit(0)
