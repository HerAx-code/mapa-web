# MAPA — Complete System Map

> A full inventory of the MAPA web system: every layer, screen, modal, Cloud
> Function, and data collection, and how they connect. Generated from the
> codebase (`src/App.jsx` routes, `src/pages`, `src/components`,
> `functions/index.js`, `firestore.rules`). Intended as a reference for the
> capstone manuscript (architecture, screen inventory, data model, process flow).

**Scale at a glance:** ~60 routes · 57 page screens · 72 components (13 modals) ·
39 Cloud Functions · 39 Firestore collections · 61 utility modules · 4 shared
(web+server) modules · 2 React contexts · 14 hooks.

---

## 1. Architecture — the three layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND  (React 18 + Vite + Tailwind)  — the only code the user runs │
│  Pages (src/pages) ─ Components/Modals (src/components) ─ Contexts ─   │
│  Hooks ─ Utils (src/utils) ─ Shared pure logic (src/shared)           │
│       │  Firebase JS SDK (Auth, Firestore, Storage, Functions client) │
└───────┼──────────────────────────────────────────────────────────────┘
        │  reads/writes (gated by firestore.rules) + httpsCallable()
┌───────▼──────────────────────────────────────────────────────────────┐
│  BACKEND  (Firebase Cloud Functions, Node 22, asia-southeast1)         │
│  Callables (money/codes/accounts/intake) + Triggers (sync/notify/purge)│
│  require('./generated/shared.cjs')  ← esbuild bundle of src/shared     │
└───────┼──────────────────────────────────────────────────────────────┘
        │  Admin SDK (rules-bypassing, authoritative writes)
┌───────▼──────────────────────────────────────────────────────────────┐
│  DATA  (Cloud Firestore + Storage)                                     │
│  39 collections · firestore.rules (tenant-scoped) · storage.rules      │
└───────────────────────────────────────────────────────────────────────┘
```

- **Security boundary:** anything about money, access codes, accounts, audit,
  assessment amendments and case lifecycle is written **only by the server**
  (Cloud Functions, Admin SDK). The browser does feedback-only checks; the rules
  refuse the forgeable writes. Patients are tenant-isolated by `tenantId`.
- **Shared source of truth:** case money/lifecycle predicates live once in
  `src/shared/caseState.js` + `caseTimers.js`; the web imports them and the
  functions load the esbuild bundle `functions/src/generated/shared.cjs`.

---

## 2. Roles & navigation gates

| Role id | Display name | Route prefix | Guard (`src/App.jsx`) |
|---|---|---|---|
| `patient` | Patient | `/patient/*` | `PATIENT_ROLES` |
| `agency` | Agency Coordinator | `/agency/*` | `AGENCY_ROLES` |
| `agency_admin` | Agency Admin | `/agency/*` (+ allocation/team/audit/announcements) | `AGENCY_ROLES` / `[AGENCY_ADMIN]` |
| `staff_admin` | Staff Admin | `/admin/*` | `ADMIN_ROLES` |
| `super_admin` | Hospital Admin | `/admin/*` (+ accounts/auditlog/settings) | `ADMIN_ROLES` / `[SUPER_ADMIN]` |
| `platform_admin` | Super Admin (network) | `/platform/*` | `PLATFORM_ROLES` |

`PrivateRoute` enforces the role; `Layout` + `BottomTabBar` render the shell;
`MfaGate` forces staff two-factor enrolment; `TermsGate` forces terms
acceptance; `SessionTimeoutProvider` handles idle sign-out.

---

## 3. Screen map — every page, by area

### Public / auth (`src/pages/auth` + root)
| Route | Page | Purpose |
|---|---|---|
| `/` | `Landing` | Marketing + example access code |
| `/login` | `Login` | Email+password sign-in, MFA step, demo-account panel (dev) |
| `/register` | `Register` | Patient sign-up (code optional); claims on the server |
| `/install` | `InstallApp` | PWA install guidance |
| `/for-hospitals` | `ForHospitals` | Hospital onboarding expression of interest |
| `/notifications` | `Notifications` | In-app notification feed |
| `/seed` | `Seed` | Dev-only reference-data seeding (flag-gated) |
| `*` | `NotFound` | 404 |

### Patient (`src/pages/patient`)
| Route | Page | Purpose |
|---|---|---|
| `/patient/dashboard` | `Dashboard` | Journey/status home (StatusHero, JourneyStrip) |
| `/patient/programs` | `MedicalPrograms` | Browse assistance programs |
| `/patient/hospitals` | `Hospitals` | Marketplace: compare hospitals, claim a code |
| `/patient/request` | `RequestAssistance` | File a request: docs, live selfie, declaration |
| `/patient/request/:id/intake` | `IntakeWizard` | Patient-side intake answers (household/income) |
| `/patient/status` | `TrackStatus` | Per-case stage, coverage, letters, countdown |
| `/patient/messages` | `Messages` (AdminMessages) | Case conversations (reply-only) |
| `/patient/guide` `/help` `/privacy` `/more` `/account` `/access-log` | Guide, Help, PrivacyNotice, More, AccountSecurity, AccessLog | Support, privacy, profile & security, RA 10173 access log |

### Agency (`src/pages/agency`)
| Route | Page | Purpose |
|---|---|---|
| `/agency/dashboard` | `Dashboard` | Funder home (BudgetHero, capacity) |
| `/agency/inbox` | `Inbox` | Endorsed slices queue |
| `/agency/applications/:id` | `ApplicationDetail` | One slice: decide, notes, case timeline |
| `/agency/applications/:id/intake` | `IntakeSheet` | Read the gateway's intake (read-only) |
| `/agency/applications/:id/gl` | `GLViewer` | Guarantee Letter view/settle |
| `/agency/slots` | `SlotManagement` | Per-hospital daily slots |
| `/agency/allocation` | `Allocation` | Budget allocation, repeat limit, max per approval (admin) |
| `/agency/funds` | `Funds` | Budget committed/disbursed ledger |
| `/agency/impact` | `Impact` | Outcomes analytics |
| `/agency/program` | `Program` | Public agency profile text, requirements |
| `/agency/certificates` `/generator` | UploadCertificates, CertificateGenerator | GL scan upload |
| `/agency/team` `/audit` `/announcements` `/logs` `/guide` `/messages` | Team, AuditLog, Announcements, Logs, Guide, Messages | Admin team mgmt, agency audit, announcements |

### Hospital gateway (`src/pages/admin`)
| Route | Page | Purpose |
|---|---|---|
| `/admin/dashboard` | `Dashboard` | Gateway home |
| `/admin/analytics` | `Analytics` | Turnaround/pipeline metrics |
| `/admin/requests` | `Requests` | The case queue: verify → assess → endorse |
| `/admin/requests/:id/intake` | `IntakeSheet` | Unified Intake Sheet (assessment) |
| `/admin/patients` | `Patients` | Patient list, holding period |
| `/admin/hospitalids` | `HospitalIDs` | Issue / manage access codes |
| `/admin/agencies` `/agencies/:id` | Agencies, AgencyDetail | Partner agencies (read/endorse) |
| `/admin/accounts` | `Accounts` | Staff accounts (super admin) |
| `/admin/export` `/export/:type` | Export, ExportPreview | DOH report, GL ledger, data export |
| `/admin/reports` `/logs` `/messages` `/auditlog` `/announcements` `/settings` | Reports, AppLogs, Messages, AuditLog, Announcements, HospitalSettings | Reports, logs, messaging, audit, branding/policy |

### Network operator (`src/pages/platform`)
| Route | Page | Purpose |
|---|---|---|
| `/platform/hospitals` | `Hospitals` | Onboard/manage hospitals, prefixes, sign-ups |
| `/platform/onboarding` `/onboarding/:id` | OnboardingRequests, OnboardingWorkspace | Onboarding queue + stages (Interest→Live) |
| `/platform/agencies` `/agencies/new` `/agencies/:id` | Agencies, AddAgency, AgencyDetail | Network agencies, partnerships, fund type |

---

## 4. Modals — the 13 dialogs and where they open

| Modal | Opens from | What it does |
|---|---|---|
| `IssueCodeModal` | admin/HospitalIDs | Issue a patient-bound access code (→ `issueAccessCode`) |
| `SelfieCaptureModal` + `CompareFacesModal` | patient/RequestAssistance (IdentityStep) | Live selfie capture + on-device face compare |
| `ApplicationModals` (Approve/RequestInfo/Reject) | agency/ApplicationDetail | Agency decisions (→ `decideSlice`); shows max-per-approval, repeat-limit |
| `SuggestEndorsementModal` | admin/Requests | Suggest agencies to endorse to |
| `SignedGLUploadModal` | agency GLViewer / Certificates | Upload wet-signed GL/CoE scan (base64 + SHA-256) |
| `DocViewerModal` | admin/Requests, agency | View an uploaded document |
| `ProfileModals` | shared (profile edits, help FAQ) | Profile/manager/help dialogs |
| `MfaEnrollModal` | MfaGate / AccountSecurity | TOTP enrolment |
| `ReauthModal` | sensitive actions (`useStepUpAuth`) | Step-up re-authentication |
| `TermsModal` | TermsGate / Register | Terms of Use acceptance |
| `ConfirmModal` | app-wide | Generic confirm dialog |
| `NotificationModal` | notification feed | One notification detail |

---

## 5. Backend — the 39 Cloud Functions, by concern

| Concern | Callables (browser-invoked) | Triggers / scheduled |
|---|---|---|
| **Access codes** | `issueAccessCode`, `claimAccessCode`, `verifyAccessCode` | — |
| **Money / cases** | `endorseRequest`, `closeRequest`, `decideSlice`, `settleLetter`, `amendAssessment` | `onRequestWritten`, `onSliceProceeded`, `syncRequestFinancials`, `glExpirySweep`, `countAgencyOpenSlices`, `caseTimers`, `resetAgencySlots` |
| **Documents** | — | `syncDocumentStatus`, `onDocumentCountChanged`, `purgeUnattachedDocuments`, `purgeSelfieOnClose` |
| **Accounts / security** | `eraseAccount`, `disableAccount`, `resetStaffMfa`, `clearIdentityFlag` | `assignPatientId`, `onPatientIdentityWritten`, `onIdDocumentIdentityWritten` |
| **Conversations / notify** | `openCaseConversation` | `onConversationMessage`, `sendNotificationEmail`, `onAnnouncementCreated`, `announcementReminders`, `onAuditLogCreated` |
| **Network / public projections** | — | `onAgencyWritten`, `resyncAgenciesPublic`, `onHospitalWritten`, `refreshNetworkStats`, `onOnboardingRequestCreated`, `purgeDeclinedOnboarding` |

---

## 6. Data — the 39 Firestore collections, by concern

- **Cases & money:** `requests`, `applications` (slices), `approvalMarks`,
  `certificates`, `eligibilityCertificates`, `eligibilityCounters`.
- **Documents:** `documents`, `documentContents`, `documentTypes`,
  `assistanceTypes`, `docReviewPresence`.
- **People & access:** `users`, `hospitalIds` (+ `privateInfo` subdoc),
  `accessCodePrefixes`, `accessCodeCounters`.
- **Tenancy & network:** `hospitals`, `hospitalsPublic`, `hospitalsPublicStats`,
  `hospitalSettings`, `agencies`, `agenciesPublic`, `networkStats`,
  `onboardingRequests`, `referralSuggestions`.
- **Input verification:** `billKeys`, `identityIndex`, `identityIndexByUser`,
  `identityFlags`.
- **Communication & audit:** `conversations`, `messages`,
  `notifications/{uid}/items`, `notificationErrors`, `announcements`,
  `auditLog`, `reports`.

---

## 7. Supporting layers

- **Contexts:** `AuthContext` (session, role, hospital branding),
  `LiveDataContext` (shared live subscriptions).
- **Hooks (14):** `useMarketplace`, `useHospitals`, `usePublicHospitals`,
  `useOnboardingRequests`, `useOrg`, `useVerification`, `useStepUpAuth`,
  `useModal`, `useEscapeKey`, `useFocusTrap`, `useDropdownPlacement`,
  `useVisualViewport`, …
- **Shared pure logic (`src/shared`, web + functions):** `caseState.js`
  (active/finished, committed/disbursed, funding, slots), `caseTimers.js`,
  `hospitalPublic.js`, `server.js` (bundle entry).
- **Utils (61)** — by theme: codes (`accessCodes`, `codeIssue`), money
  (`requests`, `sliceActions`, `approvalCooldown`, `glLedger`, `fundingType`),
  intake/eligibility (`intakeSheet`, `eligibility`, `eligibilityCert`,
  `verificationPolicy`, `classificationReuse`), documents (`docChecks`,
  `documentReuse`, `uploadDocument`, `outpatient`), identity (`idOcr`,
  `faceCheck`, `imageQuality`, `recaptureCheck`, `philIdQr`), reporting
  (`dohReport`, `dataExport`, `export`, `analytics`, `hospitalBreakdown`),
  tenancy (`hospitals`, `hospitalsPublic`, `hospitalConfig`, `onboarding`),
  geography (`barmm`, `barmm-barangays`, `address`), and platform plumbing
  (`mfa`, `notifications`, `auditLog`, `queueBuckets`, `requestStage`, `journey`).

---

## 8. End-to-end flows — screen → modal → function → collection

**A. Access code → claim → file**
`HospitalIDs` + `IssueCodeModal` → `issueAccessCode` → `hospitalIds`/`accessCodeCounters`
→ patient `HospitalGate` → `claimAccessCode` → `users`/`hospitalIds`
→ `RequestAssistance` (+ `SelfieCaptureModal`/`CompareFacesModal`, `DocChecklist`) → `requests`/`documents`.

**B. Verify → assess → endorse**
admin `Requests` (+ `VerifyDocsPanel`, `DocViewerModal`) → `documents` (status via `syncDocumentStatus`)
→ `IntakeSheet` (assessment, classification) → `requests.intakeSheet`
→ `SuggestEndorsementModal` → `endorseRequest` → `applications` (slices) + slot take on `agencies`.

**C. Fund → letter → settle**
patient `TrackStatus` Proceed → `onSliceProceeded`
→ agency `Inbox`/`ApplicationDetail` + `ApplicationModals` → `decideSlice` → GL issued, `approvalMarks`
→ `GLViewer`/`SignedGLUploadModal` → `settleLetter` → `budget.committed`→`disbursed`; `glExpirySweep` sweeps.

**D. Close / finish**
staff/auto `closeRequest` or full funding + settled letters → `syncRequestFinancials` marks finished (D4) →
`purgeSelfieOnClose`; patient free to file again (`activeRequestId`).

**E. Certificate of Eligibility**
admin request page: classification → `eligibilityCert.js` generate → `eligibilityCertificates` (frozen) →
print, wet-sign, `SignedGLUploadModal` upload scan.

**F. Onboarding (network)**
`/for-hospitals` → `onboardingRequests` → `onHospitalWritten`/`onOnboardingRequestCreated`
→ platform `OnboardingWorkspace` stages (Interest→Verification→Agreement→Setup→Live) → go-live flips `enabled`.

**G. Cross-cutting:** every admin action → `auditLog` (writer-pinned, PR 3.5);
notifications → `notify()` + `sendNotificationEmail`; identity signals →
`identityIndex`/`identityFlags`; bill reuse → `billKeys`.

---

*Source of truth: `src/App.jsx`, `src/pages/**`, `src/components/**`,
`functions/index.js`, `firestore.rules`. Regenerate the counts with the enumeration
commands in the repo history if the codebase changes.*
