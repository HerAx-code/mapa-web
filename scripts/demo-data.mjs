/**
 * Demo data seeder — populates the live app with a coherent set of completed
 * co-funding cases so the Analytics / Impact surfaces and dashboards show a
 * believable program for demonstrations (e.g. a thesis defense). Every doc is
 * tagged `_demo: true`, and used agencies' pre-seed budgets are backed up, so
 * the whole set is fully reversible.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/demo-data.mjs seed
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/demo-data.mjs clean
 *
 * Not for a live patient-serving deployment — demo/sample data only.
 */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync('./service-account.json', 'utf8'))) })
const db = admin.firestore()
const now = () => admin.firestore.FieldValue.serverTimestamp()
const monthsAgo = (m, day = 12) => { const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(day); return admin.firestore.Timestamp.fromDate(d) }
const initials = (name) => name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const mode = process.argv[2]

const AG = {
  doh:   { id: 'doh',   name: 'DOH MAIP' },
  dswd:  { id: 'dswd',  name: 'DSWD AICS' },
  pcso:  { id: 'pcso',  name: 'PCSO MAP' },
  ambag: { id: 'ambag', name: 'AMBaG Program' },
}

// Each case: one request + its approved slices. Amounts in ₱.
const CASES = [
  { pid: '_demo_p1', name: 'Maria Santos',      hid: 'CRMC-2026-90001', type: 'Hospital Bills / Hospitalization', bill: 80000,  ph: 30000, mo: 4, slices: [{ ag: 'doh', amt: 30000, gl: 'issued' }, { ag: 'dswd', amt: 20000, gl: 'issued' }] },
  { pid: '_demo_p2', name: 'Juan dela Cruz',    hid: 'CRMC-2026-90002', type: 'Chemotherapy',                     bill: 120000, ph: 40000, mo: 3, slices: [{ ag: 'pcso', amt: 80000, gl: 'redeemed' }] },
  { pid: '_demo_p3', name: 'Rosa Mendoza',      hid: 'CRMC-2026-90003', type: 'Dialysis',                         bill: 60000,  ph: 20000, mo: 3, slices: [{ ag: 'doh', amt: 40000, gl: 'issued' }] },
  { pid: '_demo_p4', name: 'Pedro Reyes',       hid: 'CRMC-2026-90004', type: 'Medicines',                        bill: 25000,  ph: 5000,  mo: 2, slices: [{ ag: 'dswd', amt: 15000, gl: 'issued' }] }, // partial (need 20k)
  { pid: '_demo_p5', name: 'Ana Villanueva',    hid: 'CRMC-2026-90005', type: 'Surgery / Medical Procedures',     bill: 150000, ph: 50000, mo: 2, slices: [{ ag: 'doh', amt: 40000, gl: 'issued' }, { ag: 'pcso', amt: 60000, gl: 'issued' }] },
  { pid: '_demo_p6', name: 'Carlos Aquino',     hid: 'CRMC-2026-90006', type: 'Emergency Medical Assistance',     bill: 35000,  ph: 0,     mo: 1, slices: [{ ag: 'ambag', amt: 35000, gl: 'redeemed' }] },
  { pid: '_demo_p7', name: 'Lita Flores',       hid: 'CRMC-2026-90007', type: 'Laboratory Tests',                 bill: 18000,  ph: 3000,  mo: 0, slices: [{ ag: 'dswd', amt: 15000, gl: 'issued' }] },
]

if (mode === 'clean') {
  let n = 0
  for (const col of ['applications', 'requests']) {
    const snap = await db.collection(col).where('_demo', '==', true).get()
    await Promise.all(snap.docs.map(d => d.ref.delete())); n += snap.size
  }
  // Restore agency budgets from the backup stamped at seed time.
  for (const id of Object.keys(AG)) {
    const ref = db.collection('agencies').doc(id)
    const doc = await ref.get()
    const b = doc.data()?._demoBudgetBackup
    if (b !== undefined) await ref.update({ budget: b, _demoBudgetBackup: admin.firestore.FieldValue.delete() })
  }
  console.log(`[clean] removed ${n} demo docs and restored agency budgets`)
  process.exit(0)
}

if (mode !== 'seed') { console.error('usage: demo-data.mjs seed|clean'); process.exit(1) }

// Tally per-agency committed / disbursed from the cases.
const tally = {}
for (const c of CASES) for (const s of c.slices) {
  ;(tally[s.ag] ??= { committed: 0, disbursed: 0 })
  tally[s.ag].committed += s.amt
  if (s.gl === 'redeemed') tally[s.ag].disbursed += s.amt
}

// Back up + set each used agency's budget so Funds/BudgetHero stays coherent.
for (const id of Object.keys(tally)) {
  const ref = db.collection('agencies').doc(id)
  const doc = await ref.get()
  const cur = doc.data()?.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
  if (doc.data()?._demoBudgetBackup === undefined) await ref.update({ _demoBudgetBackup: cur })
  const allocated = Math.max(cur.allocated || 0, tally[id].committed + 200000) // headroom above committed
  await ref.update({ budget: { ...cur, allocated, committed: tally[id].committed, disbursed: tally[id].disbursed, periodStart: monthsAgo(4, 1) } })
}

let reqN = 0, sliceN = 0
for (const c of CASES) {
  const need = Math.max(0, c.bill - c.ph)
  const committed = c.slices.reduce((s, x) => s + x.amt, 0)
  const status = committed >= need ? 'fully_funded' : 'partially_funded'
  const reqId = `REQ-2026-DEMO${c.pid.slice(-1)}`
  const reqRef = db.collection('requests').doc()
  await reqRef.set({
    requestId: reqId, patientId: c.pid, patientName: c.name, patientHospitalId: c.hid,
    assistanceType: c.type, totalBill: c.bill, philhealthCovered: c.ph, otherCovered: 0,
    amountNeeded: need, amountCommitted: committed, agencyIds: c.slices.map(s => s.ag),
    status, description: `${c.type} assistance`, filedBy: 'self',
    interviewDate: monthsAgo(c.mo + 0, 8).toDate().toISOString().slice(0, 10), interviewTime: '10:00',
    interviewOutcome: 'eligible', conductedBy: 'CRMC Medical Social Services',
    submittedAt: monthsAgo(c.mo, 5), updatedAt: now(), _demo: true,
  })
  reqN++
  for (const s of c.slices) {
    const ag = AG[s.ag]
    await db.collection('applications').add({
      requestId: reqId, agencyId: ag.id, agencyName: ag.name, agencyInitials: initials(ag.name),
      patientId: c.pid, patientName: c.name, patientHospitalId: c.hid,
      assistanceType: c.type, amountRequested: need, amountApproved: s.amt, approvedAmount: s.amt,
      status: 'approved', glStatus: s.gl, glRedeemedAt: s.gl === 'redeemed' ? monthsAgo(c.mo, 20) : null,
      purposeOfAssistance: c.type, payableTo: 'Cotabato Regional Medical Center',
      approvedBy: 'CRMC-endorsed', endorsedBy: 'CRMC Medical Social Services',
      submittedAt: monthsAgo(c.mo, 5), endorsedAt: monthsAgo(c.mo, 6), approvedAt: monthsAgo(c.mo, 8),
      updatedAt: now(), _demo: true,
    })
    sliceN++
  }
}
console.log(`[seed] created ${reqN} requests + ${sliceN} slices across ${Object.keys(tally).length} agencies`)
console.log(`[seed] total facilitated ≈ ₱${Object.values(tally).reduce((s, t) => s + t.committed, 0).toLocaleString()}, ${CASES.length} patients`)
process.exit(0)
