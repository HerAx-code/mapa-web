import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Revision 7a — a patient may write only the FACTUAL keys of their own
// requests/{id}.intakeSheet; the gateway assessment keys are staff-only.
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-intake',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv?.cleanup())

const facts = {
  shortfallCoverage: ['borrowing'], shortfallCoverageOther: '',
  householdSize: 3, monthlyIncome: 8000, employmentType: 'other', employmentTypeOther: 'Odd jobs',
  familyMembers: [{ name: 'Ana', relationship: 'child', age: 9, occupation: 'Student', monthlyContribution: null }],
  expenses: { food: 4000, utilities: 800, rent: 0, education: 300, medicine: 500, other: 0 },
  diagnosis: 'Pneumonia',
}
const assessment = { meansTestCategory: 'low_income', recommendation: 'Endorse to PCSO', completedBy: 'SW Reyes' }

async function seed(intakeSheet) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'patient-1'), { role: 'patient' })
    await setDoc(doc(db, 'users', 'admin-1'),   { role: 'staff_admin' })
    await setDoc(doc(db, 'requests', 'req-1'), {
      patientId: 'patient-1', status: 'under_review', agencyIds: [],
      tenantId: 'hospital-1',   // post-backfill (multi-hospital Phase 5)
      ...(intakeSheet ? { intakeSheet } : {}),
    })
  })
}

const reqAs = (uid) => doc(testEnv.authenticatedContext(uid).firestore(), 'requests', 'req-1')
const writeIntake = (uid, intakeSheet) => updateDoc(reqAs(uid), { intakeSheet, updatedAt: serverTimestamp() })

beforeEach(async () => testEnv.clearFirestore())

describe('patient intakeSheet writes', () => {
  it('may save the factual fields on a fresh request', async () => {
    await seed(null)
    await assertSucceeds(writeIntake('patient-1', { ...facts, patientFilledAt: serverTimestamp() }))
  })

  it('may edit facts while carrying the stored assessment through unchanged', async () => {
    await seed({ ...facts, ...assessment })
    await assertSucceeds(writeIntake('patient-1', { ...facts, ...assessment, monthlyIncome: 7000 }))
  })

  it.each(Object.entries(assessment))('may NOT set %s on a fresh request', async (key, value) => {
    await seed(null)
    await assertFails(writeIntake('patient-1', { ...facts, [key]: value }))
  })

  it('may NOT change a stored assessment', async () => {
    await seed({ ...facts, ...assessment })
    await assertFails(writeIntake('patient-1', { ...facts, ...assessment, meansTestCategory: 'indigent' }))
  })

  it('may NOT remove a stored assessment', async () => {
    await seed({ ...facts, ...assessment })
    await assertFails(writeIntake('patient-1', { ...facts }))
  })

  it('may NOT write the override reason', async () => {
    await seed(null)
    await assertFails(writeIntake('patient-1', { ...facts, meansTestOverrideReason: 'I am poor' }))
  })

  it('may NOT write intakeSheet as a non-map', async () => {
    await seed(null)
    await assertFails(writeIntake('patient-1', 'indigent'))
  })

  it("may NOT write another patient's request", async () => {
    await seed(null)
    await testEnv.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users', 'patient-2'), { role: 'patient' }))
    await assertFails(writeIntake('patient-2', facts))
  })
})

describe('gateway staff intakeSheet writes', () => {
  it('may write the assessment', async () => {
    await seed({ ...facts })
    await assertSucceeds(writeIntake('admin-1', { ...facts, ...assessment, meansTestOverrideReason: 'Catastrophic bill' }))
  })
})

// Intake improvement A2 — once the social worker locks the answers, the
// patient can't change them; only staff can lock/unlock or record reviews.
describe('locked patient answers', () => {
  it('blocks every patient write while locked', async () => {
    await seed({ ...facts, ...assessment, factsLocked: true })
    await assertFails(writeIntake('patient-1', { ...facts, ...assessment, factsLocked: true, monthlyIncome: 1000 }))
  })

  it('lets the patient edit again after staff unlock', async () => {
    await seed({ ...facts, ...assessment, factsLocked: false })
    await assertSucceeds(writeIntake('patient-1', { ...facts, ...assessment, factsLocked: false, monthlyIncome: 1000 }))
  })

  it('does not let the patient unlock or lock it', async () => {
    await seed({ ...facts, factsLocked: true })
    await assertFails(writeIntake('patient-1', { ...facts, factsLocked: false }))
    await seed({ ...facts })
    await assertFails(writeIntake('patient-1', { ...facts, factsLocked: true }))
  })

  it('does not let the patient rewrite what the worker reviewed', async () => {
    await seed({ ...facts, reviewedFacts: { monthlyIncome: 8000 } })
    await assertFails(writeIntake('patient-1', { ...facts, monthlyIncome: 1000, reviewedFacts: { monthlyIncome: 1000 } }))
  })

  it('lets staff lock and unlock with a field update', async () => {
    await seed({ ...facts, ...assessment })
    await assertSucceeds(updateDoc(reqAs('admin-1'), { 'intakeSheet.factsLocked': true, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(reqAs('admin-1'), { 'intakeSheet.factsLocked': false, updatedAt: serverTimestamp() }))
  })
})

// Revision 9 — gateway staff verify the applicant's answers; they can't edit
// them, except encoding for a patient who never filled the sheet.
describe('staff cannot alter the applicant\'s answers', () => {
  const filled = { ...facts, patientFilledAt: new Date() }

  it('denies a staff change to a patient answer', async () => {
    await seed(filled)
    await assertFails(writeIntake('admin-1', { ...filled, monthlyIncome: 99999 }))
    await assertFails(updateDoc(reqAs('admin-1'), { 'intakeSheet.diagnosis': 'Changed', updatedAt: serverTimestamp() }))
  })

  it('denies a staff deletion of a patient answer', async () => {
    const stored = { ...filled, employer: 'Bangsamoro Trading' }
    await seed(stored)
    const { employer: _dropped, ...withoutEmployer } = stored
    await assertFails(writeIntake('admin-1', withoutEmployer))
  })

  it('allows staff to verify, flag, lock and assess without touching answers', async () => {
    await seed(filled)
    await assertSucceeds(updateDoc(reqAs('admin-1'), {
      'intakeSheet.factsVerification.income': { status: 'needs_correction', note: 'Payslip shows 12k', by: 'SW', byUid: 'admin-1', facts: {} },
      'intakeSheet.verificationRequired': true,
      updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(writeIntake('admin-1', { ...filled, ...assessment }))
  })

  it('allows encoding on behalf when the patient never filled the sheet, with a reason', async () => {
    await seed(null)
    await assertSucceeds(writeIntake('admin-1', {
      ...facts, encodedOnBehalf: { by: 'SW', byUid: 'admin-1', reason: 'Patient is 82 and has no phone', at: new Date() },
    }))
  })

  it('denies encoding without a proper reason, as someone else, or after the patient filled it', async () => {
    await seed(null)
    await assertFails(writeIntake('admin-1', { ...facts, encodedOnBehalf: { by: 'SW', byUid: 'admin-1', reason: 'short' } }))
    await assertFails(writeIntake('admin-1', { ...facts, encodedOnBehalf: { by: 'SW', byUid: 'someone-else', reason: 'Patient is 82 and has no phone' } }))
    await seed(filled)
    await assertFails(writeIntake('admin-1', { ...filled, monthlyIncome: 1, encodedOnBehalf: { by: 'SW', byUid: 'admin-1', reason: 'Patient is 82 and has no phone' } }))
  })
})
