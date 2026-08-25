#!/usr/bin/env node
/**
 * migrate-agencies-ra11463.js
 *
 * Reconciles the `agencies` collection with RA 11463 (Malasakit Centers
 * Act of 2019) + JAO No. 2020-0001. See
 * docs/malasakit-center-research-2026-07-23.md for the citation trail.
 *
 * WHY
 *
 * A Malasakit Center is legally a COORDINATION HUB -- a co-located
 * one-stop shop where DOH, DSWD, PCSO and PhilHealth receive and process
 * requests. It has no appropriation for direct patient assistance; its
 * budget line is personnel + facilities only. Every peso a patient
 * receives is legally attributable to a participating agency's own
 * program budget, drawn in the JAO's Order of Charging:
 *
 *   1. PhilHealth NHIF   2. PCSO MAP/Endowment   3. DSWD AICS
 *   4. DOH MAIP          5. Host hospital / LGU
 *
 * MAPA modelled "Malasakit Center" as a funding agency holding the
 * largest budget allocation in the system, which inverts that.
 *
 * WHAT THIS DOES (Option 1 from the research memo)
 *
 *   1. CREATE doh (DOH-MAIP) -- the RA 11463 funder missing entirely.
 *   2. RESTORE dswd (DSWD-AICS) -- defined in
 *      bootstrap-reference-data.js but ABSENT from production, while 2
 *      user accounts and 2 requests already reference it. That is a
 *      pre-existing referential break this migration also repairs.
 *   3. REFRAME malasakit -- disabled so it can no longer receive new
 *      endorsements, with a description stating what it actually is.
 *      The document is deliberately KEPT, not deleted: 2 agency users,
 *      2 requests and the system's only completed application
 *      (status=certificate, GL issued) reference it. Deleting it would
 *      orphan all of them.
 *   4. Leaves pcso and ambag untouched. AMBaG is a BARMM endorsement
 *      programme, not an RA 11463 participating agency -- it is a
 *      legitimate peer funder that sits outside the Malasakit frame, so
 *      Option 1's "replace with the four funders" does not apply to it.
 *
 *   5. CREATE philhealth (PhilHealth NHIF) -- the RA 11463 funder that
 *      is #1 in the Order of Charging. Added per stakeholder decision
 *      (2026-07-24).
 *
 *      STATED CAVEAT (this was a deliberate design call, not an
 *      oversight): operationally NHIF is drawn FIRST and REDUCES THE
 *      BILL rather than issuing a Guarantee Letter for off-system
 *      settlement the way MAPA's other slices do. Modelling PhilHealth as
 *      a slice funder therefore represents a coverage deduction as a
 *      funding commitment. The stakeholders chose to surface PhilHealth
 *      as an agency for completeness and Order-of-Charging visibility;
 *      the thesis should note that its "slice" is a coverage figure, not
 *      a GL. If this proves confusing in the pilot, revert by disabling
 *      the philhealth agency (same mechanism as malasakit).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 *   - Does NOT move any budget. malasakit currently holds the entire
 *     PHP 5,000,000 allocation while pcso and ambag hold 0. Under this
 *     model that money belongs with the real funders, but the split is
 *     an operational/stakeholder call with no basis in the statute --
 *     set it via the agency Allocation screen. The script prints a
 *     reminder.
 *   - Does NOT touch users, applications, requests or certificates. All
 *     existing agencyId references keep resolving.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/migrate-agencies-ra11463.js            # dry-run
 *   node scripts/migrate-agencies-ra11463.js --apply    # write
 *
 * ALWAYS run scripts/export-firestore.js first.
 * Pattern mirrors scripts/migrate-doc-content-to-storage.js.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// DOH-MAIP: the RA 11463 participating agency with no representation in
// MAPA at all. Shape mirrors SEED_AGENCIES in bootstrap-reference-data.js.
const DOH = {
  id:              'doh',
  name:            'DOH MAIP',
  initials:        'DH',
  color:           'bg-emerald-600',
  logoUrl:         null,
  description:     'Medical Assistance for Indigent and Financially-Incapacitated Patients (MAIP), charged to the Department of Health under RA 11463.',
  province:        'Cotabato City',
  city:            'Cotabato City',
  officeName:      'DOH Desk, CRMC Ground Floor',
  location:        'DOH Desk, CRMC Ground Floor, Cotabato City',
  phone:           '064-421-2800',
  slots:           { total: 25, remaining: 25 },
  requirements:    ['Barangay Certificate of Indigency', 'Hospital Billing Statement', 'Valid ID'],
  assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Laboratory Tests'],
  processingTime:  'Same Day',
  enabled:         true,
}

// PhilHealth NHIF: RA 11463 funder, #1 in the Order of Charging. See the
// stated caveat in the header -- its "slice" is a coverage figure, not a
// GL. Added per stakeholder decision 2026-07-24.
const PHILHEALTH = {
  id:              'philhealth',
  name:            'PhilHealth',
  initials:        'PH',
  color:           'bg-teal-600',
  logoUrl:         null,
  description:     'National Health Insurance Fund (NHIF). Under RA 11463 Order of Charging, PhilHealth coverage is applied FIRST to reduce the bill before other agencies fund the balance.',
  province:        'Cotabato City',
  city:            'Cotabato City',
  officeName:      'PhilHealth Desk, CRMC Ground Floor',
  location:        'PhilHealth Desk, CRMC Ground Floor, Cotabato City',
  phone:           '064-421-2900',
  slots:           { total: 25, remaining: 25 },
  requirements:    ['PhilHealth ID', 'Valid ID'],
  assistanceTypes: ['Hospital Bills / Hospitalization'],
  processingTime:  'Same Day',
  enabled:         true,
}

// DSWD-AICS: identical to the definition already in
// bootstrap-reference-data.js. Restored, not invented.
const DSWD = {
  id:              'dswd',
  name:            'DSWD AICS',
  initials:        'DS',
  color:           'bg-blue-600',
  logoUrl:         null,
  description:     'Assistance to Individuals in Crisis Situations (AICS): cash assistance and medicine vouchers through community social workers.',
  province:        'Cotabato City',
  city:            'Cotabato City',
  officeName:      'Social Welfare Office, CRMC',
  location:        'Social Welfare Office, CRMC',
  phone:           '064-421-2700',
  slots:           { total: 25, remaining: 25 },
  requirements:    ['Barangay Certificate of Indigency', 'Valid ID', 'Crisis Documentation'],
  assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Emergency Medical Assistance'],
  processingTime:  'Same Day',
  enabled:         true,
}

const MALASAKIT_REFRAME = {
  description: 'Coordination hub, not a funding source. Under RA 11463 and JAO 2020-0001 the Malasakit Center is a co-located one-stop shop where DOH, DSWD, PCSO and PhilHealth receive and process requests; it holds no appropriation for direct patient assistance. In MAPA this function is performed by the CRMC gateway role itself, so the Center is retained here for historical records only and is not available for new endorsements.',
  enabled: false,
}

const DEFAULT_BUDGET = { allocated: 0, committed: 0, disbursed: 0, period: 'monthly', fundSource: null }

async function main() {
  console.log(`[migrate-agencies-ra11463] ${APPLY ? 'APPLY' : 'DRY-RUN'} mode`)
  console.log('Reference: docs/malasakit-center-research-2026-07-23.md\n')

  const snap = await db.collection('agencies').get()
  const existing = new Map(snap.docs.map(d => [d.id, d.data()]))
  console.log(`Current agencies (${existing.size}): ${[...existing.keys()].join(', ')}\n`)

  const actions = []

  for (const agency of [DOH, DSWD, PHILHEALTH]) {
    if (existing.has(agency.id)) {
      actions.push({ kind: 'skip', id: agency.id, why: 'already exists' })
    } else {
      actions.push({ kind: 'create', id: agency.id, data: agency })
    }
  }

  if (!existing.has('malasakit')) {
    actions.push({ kind: 'skip', id: 'malasakit', why: 'not present, nothing to reframe' })
  } else if (existing.get('malasakit').enabled === false) {
    actions.push({ kind: 'skip', id: 'malasakit', why: 'already disabled' })
  } else {
    actions.push({ kind: 'reframe', id: 'malasakit', data: MALASAKIT_REFRAME })
  }

  for (const a of actions) {
    if (a.kind === 'create')  console.log(`  CREATE   ${a.id.padEnd(10)} ${a.data.name}`)
    if (a.kind === 'reframe') console.log(`  REFRAME  ${a.id.padEnd(10)} -> enabled:false + RA 11463 description`)
    if (a.kind === 'skip')    console.log(`  skip     ${a.id.padEnd(10)} (${a.why})`)
  }

  const writes = actions.filter(a => a.kind !== 'skip')
  if (writes.length === 0) {
    console.log('\nNothing to do. Exiting clean.')
    return
  }

  if (!APPLY) {
    console.log(`\n${writes.length} write(s) planned. Dry-run only -- pass --apply to execute.`)
    console.log('Run scripts/export-firestore.js first if you have not already.')
    return
  }

  for (const a of actions) {
    const ref = db.collection('agencies').doc(a.id)
    if (a.kind === 'create') {
      const { id, ...rest } = a.data
      await ref.set({
        ...rest,
        budget:    { ...DEFAULT_BUDGET },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      console.log(`  created  ${a.id}`)
    }
    if (a.kind === 'reframe') {
      await ref.update({ ...a.data, updatedAt: FieldValue.serverTimestamp() })
      console.log(`  reframed ${a.id}`)
    }
  }

  const mala = existing.get('malasakit')
  const stranded = mala?.budget?.allocated ?? 0
  console.log('\nDone.')
  if (stranded > 0) {
    console.log(`\nREMINDER: malasakit still holds an allocation of ${stranded.toLocaleString()} ` +
                'while the real funders hold 0. This script does not move money -- ' +
                'redistribute via the agency Allocation screen.')
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
