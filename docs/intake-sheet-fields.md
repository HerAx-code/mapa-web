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

## Classification (DOH AO 2021-0044, from 2026-11-16)

Household monthly income per person (total ÷ household size; expenses are not deducted) compared with the PSA poverty line of the hospital's region, per person per month. See reports/DOH patient classification and CoE.md.

| Value | Class | Income per person vs poverty line |
|---|---|---|
| `indigent_c3` | Indigent (C3) | below 140% |
| `incapacitated_c2` | Financially incapacitated (C2) | 140% to 180% (exactly 140% is C2) |
| `incapacitated_c1` | Financially incapacitated (C1) | above 180% up to 220% |
| `capable` | Financially capable | above 220% |

- **The poverty line** is set per hospital by its Hospital Admin (Hospital Settings → Means test: amount and PSA year; the region comes from the hospital record). Nothing is built in; without a line there is no suggestion. The line used is stored on the sheet (`classificationBasis`) when the social worker picks a class.
- **Classification is manual**; the suggestion is advisory. A 4Ps member (`is4Ps`, Pantawid ID seen) is suggested C3. A class other than the suggestion, or Financially capable, needs a written reason (audit-logged).
- **Also recorded:** supporting circumstances (`circumstances`, AO VI.A.4–5) and validity (`classificationValidMonths`, 6 or 12).
- **MAIFIP (AO 2026-0031):** the panel flags a bill over 10% of a year's household income ("financially incapacitated" by catastrophic spending).
- **Old scale:** `indigent`, `marginalized`, `low_income`, `above_threshold` (1× / 1.5× / 2× a national ₱2,600 line) remain on records classified before 2026-11-16, shown as "old scale" and never reused.

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
