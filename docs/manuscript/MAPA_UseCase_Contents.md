# MAPA — Use Case Diagram Contents

Derived from the codebase, not from the manuscript. Every use case below is traced
to a route in `src/App.jsx`, a navigation entry in `src/components/Layout.jsx`, and
the action handlers in the page itself, so each line can be checked against the
running system.

Role constants are in `src/utils/constants.js`:
`super_admin`, `staff_admin`, `agency_admin`, `agency`, `patient`.

---

## 1. Patient — role `patient`

Sidebar: Dashboard · Find Programs · Request Assistance · My Application ·
Interviews · Messages · User Guide, plus the **More** menu.

| # | Use case | Where it lives |
|---|---|---|
| 1 | Register using a Patient Access Code | `/register` — code issued in person by the medical center, entered manually or opened from its QR |
| 2 | Install the app on a phone | `/install` — platform-specific PWA install steps |
| 3 | Browse partner agencies and their requirements | `/patient/programs` — "Find Programs"; each agency expands to its required documents and procedure |
| 4 | Upload and manage personal documents | Document library, reached from the request flow |
| 5 | File one assistance request | `/patient/request` — `handleSubmit`; hospital bill, amount needed, consent, live selfie |
| 6 | Complete the household intake wizard | `/patient/request/:id/intake` — `IntakeWizard`; the patient's own facts are editable |
| 7 | Book an assessment interview slot | `/patient/interviews` — `handleBook`; in person or online |
| 8 | Join an online interview | Google Meet card on the interview slip |
| 9 | Review the coverage plan and proceed | `handleProceed`, `handleSliceProceed` — advances every endorsed slice at once |
| 10 | Track the request and each agency slice | `/patient/status` — "My Application" |
| 11 | Withdraw the request | `handleWithdraw` — while still pre-endorsement |
| 12 | Download the signed Guarantee Letter | `handleDownloadCertificate` |
| 13 | Message the medical center and endorsed agencies | `/patient/messages` |
| 14 | View who has accessed their record | `/patient/access-log` |
| 15 | Export personal data | Account settings modal → `src/utils/dataExport.js` (RA 10173) |
| 16 | Switch between Filipino and English | More menu |
| 17 | Report a problem | More menu → report modal |

---

## 2. Agency Coordinator — role `agency`

Sidebar: Dashboard · Application Inbox · Messages · Agency Profile ·
Slot Management · Guarantee Letters · Funds · Impact · Application Logs · User Guide.

| # | Use case | Where it lives |
|---|---|---|
| 1 | View the funding inbox | `/agency/inbox` |
| 2 | Open a slice and start review | `ApplicationDetail` — `handleStartReview` |
| 3 | Review center-verified documents | Read-only |
| 4 | View the Unified Intake Sheet | `/agency/applications/:id/intake` — `canEdit` is `false` for agency roles |
| 5 | View the co-funding picture and case timeline | `ApplicationDetail` |
| 6 | Approve the slice | `handleApprove` — amount, purposes, payable-to provider |
| 7 | Request more information | `handleRequestInfo`, `handleResumeFromAwaiting` |
| 8 | Reject the slice with a reason | `handleReject` |
| 9 | Add a case note | `handleAddNote` |
| 10 | Suggest another agency to the medical center | Writes a referral suggestion |
| 11 | Generate and print the Guarantee Letter | `/agency/generator`, `/agency/applications/:id/gl` |
| 12 | Upload the signed Guarantee Letter | `/agency/certificates` |
| 13 | Manage the Guarantee Letter lifecycle | `handleRedeemGL`, `handleExpireGL`, `handleReverseApproval`, `handleUnmarkRedeemed` |
| 14 | Manage daily slot capacity | `/agency/slots` — `handleAdd`, `handleDeduct`, `handleSaveTotal` |
| 15 | Maintain the agency profile | `/agency/program` — requirements and procedure shown to patients |
| 16 | View funds | `/agency/funds` |
| 17 | View impact statistics | `/agency/impact` |
| 18 | View application logs | `/agency/logs` |
| 19 | Message the patient and the medical center | `handleMessagePatient`, `handleMessageGateway`, `/agency/messages` |

---

## 3. Agency Administrator — role `agency_admin`

**Inherits every Agency Coordinator use case.** In the diagram, draw the hollow
generalization triangle **pointing at Agency Coordinator** — the Coordinator is the
base role. Only the four below are administrator-only
(`adminOnly: true` in `AGENCY_NAV`).

| # | Use case | Where it lives |
|---|---|---|
| 1 | Manage budget allocation and per-applicant cap | `/agency/allocation` — `handleSaveAllocation`, `handleResetPeriod` |
| 2 | Manage the coordinator team | `/agency/team` — add, deactivate, reset password |
| 3 | Publish agency promotions | `/agency/announcements` — labelled "Promotions" |
| 4 | View the agency audit log | `/agency/audit` |

---

## 4. Staff Admin — role `staff_admin`

Sidebar: Dashboard · Agencies · Announcements · Document Types · Assistance Types ·
Requests · Interviews · Analytics · App Logs · Patients · Access Codes · Messages ·
Reports · Export.

| # | Use case | Where it lives |
|---|---|---|
| 1 | Issue, print and revoke Patient Access Codes | `/admin/hospitalids` — "Access Codes" |
| 2 | Verify or reject uploaded documents | `/admin/requests` — `VerifyDocsPanel`; can also un-verify back to pending |
| 3 | Record the PhilHealth coverage applied to the bill | `/admin/requests` — coverage inputs, editable while submitted / under review / assessment |
| 4 | Generate and publish interview slots | `/admin/interviews` — `handleGenerate`, `handlePublish` |
| 5 | Complete the Unified Intake Sheet | `/admin/requests/:id/intake` — editable for the medical center roles |
| 6 | Endorse the residual to partner agencies as slices | `/admin/requests` — `handleEndorse` |
| 7 | Accept or decline an agency's referral suggestion | `handleAcceptSuggestion`, `handleDeclineSuggestion` |
| 8 | Manage patient records | `/admin/patients` — message, place on hold, flag for deletion |
| 9 | Manage agency profiles, slots and status | `/admin/agencies`, `/admin/agencies/:id` — save, reset slots, disable with cascade, re-enable, manage coordinators |
| 10 | Maintain document and assistance type catalogues | `/admin/doctypes`, `/admin/assistance` |
| 11 | Post system-wide announcements | `/admin/announcements` |
| 12 | View the analytics dashboard | `/admin/analytics` |
| 13 | View application logs | `/admin/logs` |
| 14 | Handle submitted problem reports | `/admin/reports` — set status, reopen, delete |
| 15 | Export records as CSV | `/admin/export`, `/admin/export/:type` |
| 16 | Message patients and agencies | `/admin/messages` |

---

## 5. Super Admin — role `super_admin`

**Inherits every Staff Admin use case.** Draw the generalization triangle
**pointing at Staff Admin**. Only these four are super-admin-only.

| # | Use case | Where it lives |
|---|---|---|
| 1 | Add a new partner agency | `/admin/agencies/new` — the only agency route gated to `SUPER_ADMIN` |
| 2 | Manage administrator accounts | `/admin/accounts` |
| 3 | View the platform-wide audit log | `/admin/auditlog` |
| 4 | Permanently erase a patient account and its data | `/admin/patients` — `handleDeleteAccount`, gated on `isSuperAdmin` (RA 10173) |

---

## Relationships to draw

```
Agency Administrator ────▷ Agency Coordinator
Super Admin          ────▷ Staff Admin
```

The hollow triangle sits on the **base** role — the one whose use cases are
inherited. This is backwards in the current Figures 17 and 18.

The inheritance is real in code, not just a modelling convenience:
`isAgencyRole()` treats `agency` and `agency_admin` alike, and `ADMIN_ROLES`
contains both `super_admin` and `staff_admin`, so every route open to the base
role is open to the inheriting role.

---

## Two things to confirm before you draw

**Pre-assessment screening.** The current Patient diagram has "Use pre-assessment
screening". I cannot find it. Searching all of `src/` for `matchScore`,
`preAssess`, `prescreen`, `eligibilityScore`, `qualifyFor`, `autoMatch`,
`suggestAgenc`, `recommendAgenc` and `matchAgenc` returns nothing. The two nearest
things are the landing page's static "Who can apply" list and the Programs page's
expandable requirements — neither takes input or produces a result. It is left out
of the list above. If it exists, tell me the route and I will put it back.

**Attending the interview.** "Attend interview (in person or online)" is in the
current diagram. Attending in person is not a system function, so above it appears
only as "Join an online interview", which is backed by the Google Meet card. Booking
the slot is a separate, real use case.
