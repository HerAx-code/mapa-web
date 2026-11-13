# Unified Intake Sheet — Field Reference

This document specifies every field captured in MAPA's Intake Sheet, sourced from the paper forms used by CRMC Medical Social Services. The intake sheet is **authored by the social worker** during the application's `reviewing` or `interview` stage and **must be completed before approval**.

## Source forms

- **Malasakit Center** — Client's Information Sheet (CIS) + Social Case Study Report
- **DSWD AICS** — Assistance to Individuals in Crisis Situations Form
- **PCSO MAP** — Medical Assistance Program Endorsement Form
- **AMBaG** — BARMM endorsement; uses CIS-equivalent fields

## Storage

Embedded on the application document at `applications/{id}.intakeSheet`. Single 1:1 object — not a sub-collection. Authored once, may be revised before approval.

## Schema

```
intakeSheet: {
  // Family composition (table of rows)
  familyMembers: [
    { name, relationship, age, occupation, monthlyContribution }
    // relationship: code from RELATIONSHIPS in src/utils/intakeSheet.js
    // ('spouse' | 'partner' | 'child' | 'parent' | 'sibling' | 'grandparent' |
    //  'grandchild' | 'in_law' | 'other_relative' | 'non_relative');
    // older sheets may hold free text, shown as typed.
    // Patient wizard: exactly (householdSize − 1) rows; name, relationship, age required.
  ],
  householdSize: number,             // REQUIRED

  // Income & employment
  monthlyIncome: number,             // REQUIRED — household total, PHP
  employmentType: string,            // 'employed' | 'self-employed' | 'unemployed' | 'retired' | 'other'
  employmentTypeOther: string,       // required when employmentType = 'other'; '' otherwise
  employer: string,                  // optional
  lengthOfEmployment: string,        // optional, free text (e.g., '3 years')
  incomeSource: string,              // optional, free text

  // Monthly expenses (PHP, all optional)
  expenses: {
    food: number,
    utilities: number,
    rent: number,
    education: number,
    medicine: number,
    other: number,
  },

  // Medical
  diagnosis: string,                 // REQUIRED — primary medical condition
  attendingPhysician: string,        // optional
  hospitalCaseNumber: string,        // optional — IHOMIS reference if available
  dateOfAdmission: string,           // optional, ISO date
  estimatedTotalCost: number,        // optional, PHP

  // Social worker assessment
  caseStudyNarrative: string,        // optional, free text
  recommendation: string,            // REQUIRED — social worker's recommendation
  meansTestCategory: string,         // REQUIRED — 'indigent' | 'marginalized' | 'low_income' | 'above_threshold'
  meansTestOverrideReason: string,   // REQUIRED when the category differs from the advisory
                                     // suggestion, or is 'above_threshold' (audit-logged)

  // Audit
  completedBy: string,               // REQUIRED — social worker's name
  completedAt: timestamp,            // REQUIRED — server timestamp
  lastEditedBy: string,              // optional — last person who saved
  lastEditedAt: timestamp,           // optional
}
```

## Required fields (6)

1. `householdSize`
2. `monthlyIncome`
3. `diagnosis`
4. `recommendation`
5. `meansTestCategory`
6. `completedBy` (auto-filled from logged-in user)

All other fields are optional. Empty fields on paper forms are normal, so MAPA mirrors that.

## Means-test categories

| Category | Typical threshold (Philippine poverty line, 2024) | Notes |
|---|---|---|
| `indigent` | Below poverty threshold (~₱13,000 / month for a family of 5) | Eligible for full assistance |
| `marginalized` | Within 1.5× poverty threshold | Eligible for partial assistance |
| `low_income` | Within 2× poverty threshold | Case-by-case |
| `above_threshold` | Above 2× poverty threshold | Generally not eligible — documented for transparency |

Classification is **manual** by the social worker. The sheet shows an **advisory** suggestion (income ÷ household size vs `VITE_POVERTY_LINE_PER_CAPITA`, default ₱2,600) and a **bill vs income** figure (months of household income the amount needed equals; flagged at 12+ months as catastrophic, the "financially incapacitated" case). Choosing a category other than the suggestion, or Above Threshold, requires a written reason, which is saved to the audit log.

**Locking and change tracking (staff-only fields):**
- `factsLocked` / `factsLockedAt` / `factsLockedBy`: set to locked automatically the first time the assessment is complete. While locked, Firestore rejects every patient write to the intake. A social worker can unlock it so the patient can correct an answer, and it does not re-lock by itself. Lock and unlock are audit-logged, and unlocking notifies the patient.
- `reviewedFacts`: a copy of the patient facts as the social worker last reviewed them. The staff sheet compares it with the current facts and lists every patient change ("Monthly income ₱8,000 → ₱3,000") until the worker clicks **Mark as reviewed**, which is also audit-logged. The staff sheet merges a patient's update into an open form instead of overwriting it on the next autosave.

**Verification instead of editing (revision 9):** gateway staff can't change the applicant's answers. They verify each of four sections (Household, Income & work, Expenses, Medical) or mark a section *needs correction* with a note, then **send it back**. That unlocks the answers and notifies the patient, who corrects them in the wizard. Stored as `factsVerification[section] = { status, note, by, byUid, at, facts }`. `facts` is a copy of the section at decision time, so a later patient change reads as "changed — verify again" without any write. When all four are verified, the answers lock. When `verificationRequired` is set (on sheets that weren't already complete when staff first worked them), endorsement needs all four sections verified. Already-assessed cases are grandfathered.
- `encodedOnBehalf = { by, byUid, reason, at }`: staff may enter the answers only for a patient who has never filled the sheet (no `patientFilledAt`), with a reason of at least 10 characters. The firestore.rules check `staffIntakeWriteOk()` enforces it, and it's audit-logged.

**Who writes what (Firestore rules):** a patient may change only the factual keys of their own request's intake (family, income, expenses, medical). The assessment keys (`meansTestCategory`, `meansTestOverrideReason`, `recommendation`, `caseStudyNarrative`, `hospitalCaseNumber`, `completedBy/At`, `lastEditedBy/At`) are gateway-staff only.

## Workflow

1. Application reaches `reviewing` or `interview` stage.
2. Social worker opens the application in Inbox, clicks **Open Intake Sheet**.
3. Fields are filled progressively; partial saves are allowed.
4. When `recommendation` and `meansTestCategory` are filled, the sheet is **Completed** and the Approve action is unlocked.
5. Approval requires `approvedAmount`, `purposeOfAssistance`, `payableTo` — captured at the moment of approval, separate from the intake sheet.

## Privacy

Intake sheet contents include sensitive personal and financial data. Access is restricted by Firestore rules to:
- The owning patient (read-only on their own application)
- The owning agency's coordinators
- Super Admin (for audit and report queries)
- Staff Admin (for operations)

Patients cannot edit their intake sheet — it is the social worker's record.
