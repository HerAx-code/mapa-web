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
  ],
  householdSize: number,             // REQUIRED

  // Income & employment
  monthlyIncome: number,             // REQUIRED — household total, PHP
  employmentType: string,            // 'employed' | 'self-employed' | 'unemployed' | 'retired' | 'other'
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

Classification is **manual** by the social worker in this phase. Automatic calculation (income ÷ household size vs official threshold) is a future enhancement.

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
