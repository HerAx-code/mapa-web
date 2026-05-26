# MAPA — Thesis Documentation

This document compiles the requirement analysis, architecture, page-by-page documentation, data model, security model, workflows, testing notes, and future work for the **MAPA (Medical Assistance Portal Access)** system, developed as the partner-pilot platform for the Cotabato Regional Medical Center (CRMC) Malasakit Center.

It is structured for direct lift into a thesis manuscript. Sections are self-contained; reuse them under whatever chapter naming your school uses.

---

## 1. Executive Summary

MAPA is a role-based, bilingual (Filipino + English) web platform that digitizes the medical financial assistance application process at CRMC. Patients apply online for assistance from partner government agencies (DSWD, PCSO, Malasakit Center, AMBaG Program), upload supporting documents, attend online interviews via Google Meet, and receive digital Guarantee Letters (GLs) for off-system settlement with healthcare providers. Agencies review, conduct case assessments, and issue GLs. CRMC administrators provide platform oversight, document verification, and reference-data management.

The system is delivered as a Progressive Web Application (PWA), giving patients an installable mobile experience while agency staff and administrators use the same codebase on desktop browsers. The PWA distinction is enforced through display-mode detection — patients see a mobile-optimized bottom-tab UI, while non-patient roles installing the PWA are routed to the web portal on a laptop.

---

## 2. Problem Statement and Objectives

### 2.1 Problem Statement

Patients seeking medical financial assistance at CRMC face fragmented application processes across multiple partner agencies (PCSO, DSWD, Malasakit Center, AMBaG). Each agency historically operated independent paper-based intake forms, in-person interviews, and physical Guarantee Letters. This fragmentation produces:

- Repeated travel and lineups at multiple agency desks
- Inconsistent document requirements
- Paper records vulnerable to loss and difficult to audit
- No unified view of assistance history per patient
- No structured way for social workers to share recommendations
- Inability of agencies to coordinate cooldown periods between approvals

### 2.2 General Objective

To design and implement a centralized web and mobile platform that consolidates medical financial assistance applications across CRMC's partner agencies, replacing paper-based workflows with a structured, auditable, multi-role digital system.

### 2.3 Specific Objectives

1. Provide patients with a single registration, application, and tracking surface accessible from any mobile phone with internet access.
2. Implement role-based workflows for patients, agency coordinators, agency administrators, and CRMC system administrators.
3. Digitize the Unified Intake Sheet and Client Information Sheet as a structured Case Assessment form.
4. Generate Guarantee Letters in a layout matching CRMC's wet-signature paper form, supporting print-and-upload-signed-scan workflows.
5. Enforce cooldown rules (30-day per-patient post-approval) across all agencies via shared Hospital ID tracking.
6. Provide bilingual (Filipino + English) patient-facing UI to match the constituent base.
7. Deliver real-time notifications via in-app and email channels.
8. Maintain a verifiable audit trail of all administrative actions.

### 2.4 Scope and Limitations

The system is scoped to CRMC's Cotabato City pilot. The following are explicitly out of scope, with justification documented in the system constraints (Section 13):

- PhilSys/National ID API integration (manual social-worker verification used instead)
- Real money movement / banking APIs (the system tracks monetary commitments as data only)
- SMS notifications (cost-prohibitive for thesis pilot; email + in-app + future push notifications used instead)
- Embedded video calling (Google Meet links used instead)
- Donor portal
- Fraud detection engine (manual social-worker judgment)
- Multi-hospital network (CRMC pilot only)
- Real-time IHOMIS hospital information system integration (manual case-number references used instead)

---

## 3. Requirement Analysis

### 3.1 Functional Requirements

#### 3.1.1 Patient Functional Requirements

**FR-P-01 Registration.** A patient shall self-register with a Patient Access Code (format `CRMC-YYYY-NNNNN`) previously issued by CRMC Medical Social Services. Registration shall collect full name, contact number, complete address, and account credentials.

**FR-P-02 Document Upload.** A patient shall upload supporting documents (Valid ID, Barangay Certificate of Indigency, Hospital Billing Statement, Medical Abstract, PhilHealth ID, Medical Certificate, Laboratory Results, Crisis Documentation) of types defined by the administrator. Each upload shall be subject to administrative verification.

**FR-P-03 Program Discovery.** A patient shall view all enabled partner agencies and their available programs, including slot counts, processing time, and supported assistance types. A guided screening flow shall allow the patient to filter programs by their medical need.

**FR-P-04 Application Submission.** A patient shall submit an application to a single agency at a time. Submission shall verify document completeness, deduct an agency slot atomically, and notify the agency.

**FR-P-05 Application Tracking.** A patient shall view the current status of their application through the lifecycle: pending → reviewing → interview → approved → certificate (or rejected). Real-time updates shall be received without page refresh.

**FR-P-06 Withdrawal.** A patient shall withdraw their own application while it is in the `pending` status. Withdrawal shall restore the agency slot if same-day.

**FR-P-07 Interview Attendance.** A patient shall receive the agency's Google Meet link, scheduled date, and time. They shall be reminded 24 hours and 1 hour before the meeting.

**FR-P-08 GL Receipt.** A patient shall download their signed Guarantee Letter (image or PDF) once the agency uploads the wet-signed scan. The GL shall be valid for 30 days from issuance.

**FR-P-09 Bilingual Interface.** All patient-facing UI shall be available in both Filipino and English, with a toggle accessible at any time.

**FR-P-10 Messaging.** A patient shall be able to message hospital administrators and their assigned agency. They shall not be able to message other patients.

#### 3.1.2 Agency Coordinator Functional Requirements

**FR-A-01 Application Inbox.** A coordinator shall view all applications submitted to their agency, with filters by status. Pending applications shall be highlighted.

**FR-A-02 Document Verification View.** A coordinator shall view all uploaded documents attached to an application, including the verification status set by the administrator.

**FR-A-03 Interview Scheduling.** A coordinator shall schedule an online interview by entering date, time, a Google Meet URL, and the name of the conducting social worker. The system shall provide a one-click shortcut to `meet.new` for generating a Meet link.

**FR-A-04 Case Assessment.** A coordinator shall complete a structured assessment form (the digital equivalent of the CRMC Unified Intake Sheet) recording family composition, monthly income and expenses, employment, medical details, social case study narrative, recommendation, and means-test classification (Indigent / Marginalized / Low Income / Above Threshold).

**FR-A-05 Approval.** A coordinator shall approve an application by entering the approved amount (in PHP), one or more purposes of assistance, and the provider name (payable-to). Approval shall be transactional: the agency's committed budget shall be incremented and a Guarantee Letter shall be issued.

**FR-A-06 Cooldown Enforcement.** The system shall prevent a coordinator from approving a patient whose Hospital ID was approved by any agency within the past 30 days, or who has an active reversed-approval cooldown.

**FR-A-07 Rejection.** A coordinator shall reject an application with a written reason, drawn from common templates or entered as free text.

**FR-A-08 Slot Management.** A coordinator shall set their agency's daily slot capacity, view the current remaining slots, and manually adjust the count with an audit-logged reason.

**FR-A-09 GL Print and Upload.** A coordinator shall print or save-as-PDF the unsigned Guarantee Letter, wet-sign it physically, and upload the signed scan back to the system. The patient shall then be able to download the signed copy.

**FR-A-10 GL Lifecycle.** A coordinator shall mark a GL as Redeemed (when the provider has billed), Expired (after 30 days without redemption), or reverse the approval to correct mistakes.

#### 3.1.3 Agency Administrator Functional Requirements

**FR-AA-01 Budget Allocation.** An agency administrator shall set the total budget for a fiscal period and start new periods, which resets committed and disbursed counters while preserving the allocation.

**FR-AA-02 Team Management.** An agency administrator shall create, edit, deactivate, and delete coordinator accounts within their agency. They shall promote a coordinator to administrator or demote an administrator back to coordinator, with system-enforced guards preventing demotion of the last remaining administrator.

**FR-AA-03 Agency Audit Log.** An agency administrator shall view a log of all administrative actions within their agency, with action type, actor, timestamp, and target.

**FR-AA-04 Coordinator Functions.** All coordinator functional requirements (FR-A-01 through FR-A-10) shall also be available to agency administrators.

#### 3.1.4 CRMC Administrator Functional Requirements

**FR-CRMC-01 Agency Management.** A CRMC administrator shall create, edit, enable, disable, and delete partner agencies. Disabling shall offer a choice of how to handle in-flight applications (auto-reject without cooldown, or hold pending re-enable).

**FR-CRMC-02 Document Verification.** A CRMC administrator shall review patient-uploaded documents, marking each as verified or rejected with a reason.

**FR-CRMC-03 Document Type Management.** A CRMC administrator shall define the document types accepted by the system, including which are required.

**FR-CRMC-04 Assistance Type Management.** A CRMC administrator shall define the categories of assistance (Hospital Bills, Medicines, Chemotherapy, Laboratory Tests, Surgery, Emergency Medical Assistance, Burial Assistance, etc.).

**FR-CRMC-05 Hospital ID Issuance.** A CRMC administrator shall generate and manage the pool of Patient Access Codes (`CRMC-YYYY-NNNNN`).

**FR-CRMC-06 Patient Records.** A CRMC administrator shall view all registered patients and their application histories. They shall not be able to modify patient personal details.

**FR-CRMC-07 Application Logs.** A CRMC administrator shall view all applications across all agencies, with filters and CSV export.

**FR-CRMC-08 Reports and Export.** A CRMC administrator shall generate aggregate reports (per agency, per status, per period) and export to CSV.

**FR-CRMC-09 Announcements.** A super administrator shall create system-wide announcements (Information, Warning, Maintenance) visible to all authenticated users during defined time windows.

**FR-CRMC-10 Audit Log.** A super administrator shall view the complete platform-wide audit trail of all administrative actions.

**FR-CRMC-11 Admin Account Management.** A super administrator shall create, edit, deactivate, and delete administrator accounts (super and staff levels). Staff administrators cannot manage administrator accounts.

### 3.2 Non-Functional Requirements

**NFR-01 Performance.** Initial patient page load shall be under 4 seconds on a 4G mobile connection. Subsequent navigations shall be instant via client-side routing.

**NFR-02 Scalability.** The system shall support up to 50 concurrent applications per agency per day on the free-tier Firebase plan.

**NFR-03 Availability.** The system shall be hosted on Vercel and Firebase, with public-cloud SLAs of 99.9 % uptime.

**NFR-04 Security.** All client-server communication shall use HTTPS. Data-layer access control shall be enforced through Firestore Security Rules. No client-side authority shall be trusted.

**NFR-05 Bilingual.** All patient-facing strings shall be externalized as locale keys with translations for Filipino and English. The user shall be able to switch language at any time.

**NFR-06 Mobile-First.** All patient-facing UI shall be designed for a 360 px-wide phone screen first. Desktop layouts shall be progressive enhancement.

**NFR-07 Accessibility.** Touch targets shall be ≥ 44 px (Apple Human Interface Guidelines minimum). Icon-only buttons shall carry `aria-label` attributes. Color contrast shall meet WCAG AA.

**NFR-08 Auditability.** Every administrative action shall be logged to an immutable audit collection with actor identity, timestamp, action type, and target.

**NFR-09 Offline Tolerance.** The application shell shall load when the device is offline. Read-only access to already-loaded data shall remain available. Writes shall queue locally and replay on reconnection (Firestore's built-in behavior).

**NFR-10 PWA Standard.** The system shall be installable as a Progressive Web App on Android and iOS via the standard Add-to-Home-Screen flow, with custom install affordances.

### 3.3 System Constraints

- Bandwidth and device assumptions: many users are on entry-level Android phones with slow 4G connections, motivating aggressive bundle size reduction (code splitting, lazy loading).
- Filipino is the operating language for users; English is the secondary fallback.
- All money tracked is *committed* and *disbursed*, not actually transferred — settlement happens off-system between agency and healthcare provider.
- CRMC has zero fund-disbursement authority; each partner agency manages its own budget.

---

## 4. Tools and Technologies

### 4.1 Frontend Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Library | React | 18.x | UI rendering and state |
| Build tool | Vite | 5.x | Module bundling, dev server, code splitting |
| Styling | Tailwind CSS | 3.x | Utility-first styling, no separate CSS files per component |
| Routing | React Router | 6.x | Client-side routing, lazy-loaded route components |
| Internationalization | react-i18next | 14.x | Bilingual EN/FIL string resolution |
| Icons | react-icons (Material Design set) | latest | Consistent iconography across the app |
| Notifications | react-hot-toast | latest | Toast notifications for transient feedback |

### 4.2 Backend and Data

| Service | Provider | Purpose |
|---------|----------|---------|
| Database | Cloud Firestore | NoSQL document store, real-time listeners |
| Authentication | Firebase Auth (email + password) | User identity, password reset emails |
| Security | Firestore Security Rules | Server-enforced authorization, evaluated on every read/write |
| Indexes | Firestore Composite Indexes | 8 deployed indexes for multi-field queries |

### 4.3 Hosting and Deployment

| Component | Service | Notes |
|-----------|---------|-------|
| Web frontend | Vercel | Hobby plan (free); auto-deploys on push to `main` |
| Serverless functions | Vercel | `/api/send-email` for SMTP relay |
| Database | Firebase / Google Cloud | Spark plan (free tier); located in asia-southeast1 |
| Source control | GitHub | Single `main` branch trunk-based workflow |
| Scheduled jobs | GitHub Actions | Weekly cleanup-orphans script |

### 4.4 PWA (Mobile Distribution)

| Component | Technology | Notes |
|-----------|------------|-------|
| Manifest | vite-plugin-pwa | Static manifest.webmanifest at build time |
| Service Worker | Workbox (autoUpdate strategy) | `skipWaiting` + `clientsClaim` for instant activation on deploy |
| Install prompt | Custom React component | Captures `beforeinstallprompt` before React mounts (inline script in index.html) |
| Offline shell | Workbox precaching | App shell precached; Firestore + Auth remain network-only |

### 4.5 Email Delivery

| Component | Choice | Justification |
|-----------|--------|---------------|
| Transport | Gmail SMTP via App Password | Free, no credit card required |
| Relay | Vercel serverless function (nodemailer) | Keeps SMTP credentials server-side, away from the browser |
| Why not Firebase Extension | Cannot install (requires Blaze billing plan with payment verification) | Documented in DEPLOY.md |

### 4.6 Development and Operations

- ESLint and Prettier (code style)
- `.claude/settings.json` configuration files (development assistant context)
- Operational runbook in DEPLOY.md (rules deploy, indexes, smoke test)
- 8 Firestore composite indexes deployed via Firebase Console

---

## 5. System Architecture

### 5.1 Architectural Style

MAPA follows a **serverless, single-page-application (SPA)** architecture with the following properties:

- **Single codebase** for web and mobile (PWA). No native iOS or Android app.
- **Frontend is a static asset bundle** served from Vercel's CDN; there is no application server.
- **All business logic** runs either client-side in the browser, or inside Firestore Security Rules.
- **Real-time data sync** is provided by Firestore's WebSocket listeners (`onSnapshot`).
- **Authentication state** is managed client-side via Firebase Auth; the JWT identity token accompanies every Firestore request.

### 5.2 High-Level Component Diagram (textual)

```
┌──────────────────────────────────────────────────────────────────┐
│                          User's Device                           │
│                                                                  │
│   ┌─────────────┐   ┌─────────────┐   ┌────────────────────┐     │
│   │  Browser    │   │  Installed  │   │  Service Worker    │     │
│   │  (web)      │   │  PWA        │   │  (Workbox)         │     │
│   └──────┬──────┘   └──────┬──────┘   └─────────┬──────────┘     │
└──────────┼─────────────────┼─────────────────────┼───────────────┘
           │                 │                     │
           │   HTTPS         │   HTTPS             │   HTTPS
           ▼                 ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                            Vercel CDN                            │
│   ┌────────────────────────┐    ┌──────────────────────────┐     │
│   │  Static frontend       │    │  Serverless functions    │     │
│   │  (React bundle, code-  │    │  /api/send-email         │     │
│   │   split per role)      │    │  (Nodemailer + Gmail)    │     │
│   └────────────────────────┘    └──────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
           │                                       │
           │   Firestore SDK over WebSocket        │  SMTP TLS
           ▼                                       ▼
┌────────────────────────────────────────────┐ ┌────────────────────┐
│         Firebase / Google Cloud            │ │  Gmail SMTP        │
│                                            │ │  (smtp.gmail.com)  │
│   ┌─────────────────┐                      │ └────────────────────┘
│   │ Firebase Auth   │  (identity tokens)   │
│   └────────┬────────┘                      │
│            │                               │
│            ▼                               │
│   ┌─────────────────┐                      │
│   │ Cloud Firestore │  (data + real-time)  │
│   │ + Security Rules│  (per-doc auth)      │
│   │ + 8 indexes     │                      │
│   └─────────────────┘                      │
└────────────────────────────────────────────┘
```

### 5.3 Code Organization

```
mapa-web/
├── api/                          # Vercel serverless functions
│   └── send-email.js             # SMTP relay
├── src/
│   ├── components/               # Shared UI components
│   │   ├── Layout.jsx            # App shell (topbar, sidebar, bottom tab)
│   │   ├── PrivateRoute.jsx      # Role-gated route wrapper
│   │   ├── ProfileModals.jsx     # Account/Password/Privacy/Help modals
│   │   ├── BottomTabBar.jsx      # Mobile-only patient navigation
│   │   ├── InstallPrompt.jsx     # PWA install affordance
│   │   ├── NotificationModal.jsx # Notification detail
│   │   ├── SignedGLUploadModal.jsx
│   │   ├── DocViewerModal.jsx
│   │   ├── GLDocumentPanel.jsx
│   │   ├── OutcomeModal.jsx      # Interview outcome recording
│   │   ├── agency/               # Agency-specific shared components
│   │   └── ui/                   # Atomic UI elements (Logo, etc.)
│   ├── contexts/
│   │   └── AuthContext.jsx       # Firebase Auth + user profile glue
│   ├── i18n/
│   │   ├── index.js              # i18next configuration
│   │   └── locales/
│   │       ├── en.json
│   │       └── fil.json
│   ├── pages/                    # Page-level route components
│   │   ├── auth/                 # Landing, Login, Register, InstallApp
│   │   ├── patient/              # 9 patient pages
│   │   ├── agency/               # 16 agency pages
│   │   ├── admin/                # 19 admin pages
│   │   └── Notifications.jsx     # Cross-role
│   ├── utils/                    # Helpers (auditLog, messages, etc.)
│   ├── firebase.js               # SDK initialization
│   ├── App.jsx                   # Route registry with lazy() splits
│   └── main.jsx                  # React root + i18n bootstrap
├── firestore.rules               # Security rules (manually published)
├── firestore.indexes.json        # Composite index definitions
├── vite.config.js                # Build + PWA + code-splitting config
└── package.json
```

### 5.4 Code Splitting Strategy

The build is configured to emit one chunk per route. Authentication and the patient dashboard load eagerly (most common entry points). All other routes are `React.lazy()`'d so that:

- A patient downloads ~300 KB gzipped (shell + dashboard) at first visit
- A coordinator downloads ~450 KB gzipped (shell + agency pages)
- An administrator downloads ~600 KB gzipped (shell + admin pages including the 140 KB document viewer)

A `Suspense` boundary at the route root shows a small spinner during chunk fetch (~500 ms on 4G).

### 5.5 Mobile (PWA) Architecture

The same SPA functions as the "mobile app" when installed. The distinction between regular browser visit and installed PWA is based on the `display-mode: standalone` media query:

- When **standalone**: the Landing page redirects directly to the role's dashboard or login. Patient role unlocks the bottom tab bar layout. Non-patient roles are politely bounced to the web portal with a notice ("Installed app is for patients; agency and admin work happens on a laptop browser").
- When **regular browser**: the Landing page renders normally, including the "Download App" call-to-action that points to `/install`.

The install page detects whether the app is already installed and presents either platform-specific instructions or a one-tap install button (via `beforeinstallprompt`).

---

## 6. Data Model (Firestore Collections)

### 6.1 Collections Overview

| Collection | Document Key | Purpose |
|------------|--------------|---------|
| `users` | Firebase Auth UID | User profiles for all roles |
| `applications` | auto-id | Patient applications to specific agencies |
| `documents` | auto-id | Patient-uploaded supporting documents (metadata) |
| `documentContents` | matches `documents.id` | Document file content (base64) |
| `documentTypes` | slug from name | Catalog of document types |
| `assistanceTypes` | slug from name | Catalog of assistance categories |
| `agencies` | slug (e.g. `pcso`, `dswd`) | Partner agency profiles |
| `hospitalIds` | the code itself (e.g. `CRMC-2026-00001`) | Patient Access Code records |
| `certificates` | matches `applications.id` | Signed GL scans (image or PDF, base64) |
| `conversations` | auto-id | Message threads between users |
| `conversations/{id}/messages` | auto-id | Individual messages within a thread |
| `notifications/{uid}/items` | auto-id | Per-user in-app notification feed |
| `notificationErrors` | auto-id | Diagnostic log of failed notification deliveries |
| `reports` | auto-id | Bug reports + agency Budget Requests |
| `announcements` | auto-id | System-wide banner messages |
| `auditLog` | auto-id | Immutable platform action history |
| `docReviewPresence` | matches `documents.id` | Ephemeral "who is reviewing this document" tracking |
| `mail` | auto-id (deprecated) | Stub from earlier Firebase Extension attempt (no longer written) |

### 6.2 Key Document Schemas

**users/{uid}**

```
{
  uid:        string,         // matches Firebase Auth UID
  name:       string,
  email:      string,
  contact:    string | null,  // Philippine mobile number
  role:       'patient' | 'agency' | 'agency_admin' | 'staff_admin' | 'super_admin',
  agencyId:   string | null,  // for agency / agency_admin only
  hospitalId: string | null,  // for patient only; CRMC-YYYY-NNNNN
  patientId:  string | null,  // optional internal CRMC patient ID
  address:    { barangay, city, province } | null,
  active:     boolean,
  rank:       'high' | 'low' | null,
  cooldown:   number,
  deletion:   boolean,
  createdAt:  Timestamp,
  photoURL:   string | null,
}
```

**applications/{appId}**

```
{
  appId:               string,           // human-readable, e.g. APP-2026-AB12CDE
  patientId:           string,           // users.uid
  patientName:         string,           // snapshot at submission
  patientContact:      string,
  patientAddress:      string,
  patientHospitalId:   string | null,    // snapshot for cooldown survival
  agencyId:            string,
  agencyName:          string,
  agencyColor:         string,
  agencyInitials:      string,
  status:              'pending' | 'reviewing' | 'awaiting_info' | 'interview' | 'approved' | 'certificate' | 'rejected',
  attachedDocuments:   Array<{ documentId, name, documentTypeName, status, date }>,
  stages:              Array<{ key, label, done, active, date, note }>,
  submittedAt:         Timestamp,
  updatedAt:           Timestamp,
  // Set during reviewing → interview transition:
  interviewDate:       string,           // 'YYYY-MM-DD'
  interviewTime:       string,           // free-form, e.g. '2:00 PM'
  meetLink:            string,
  conductedBy:         string,
  interviewOutcome:    'completed' | 'no_show' | null,
  reminderSent24h:     boolean,
  reminderSent1h:      boolean,
  // Set during reviewing → approved transition:
  approvedAt:          Timestamp,
  approvedAmount:      number,
  purposeOfAssistance: string[],
  payableTo:           string,
  approvedBy:          string,
  approvedByUid:       string,
  glStatus:            'issued' | 'redeemed' | 'expired' | null,
  glRedeemedAt:        Timestamp | null,
  glExpiredAt:         Timestamp | null,
  // Set if reversed:
  reversedAt:          Timestamp | null,
  reversedBy:          string | null,
  reversedByUid:       string | null,
  reversalReason:      string | null,
  cooldownUntilAt:     Timestamp | null,
  certificateUploaded: boolean,
  // Case Assessment (formerly Intake Sheet):
  intakeSheet:         { ...assessment fields..., completedBy, lastEditedBy },
}
```

**documents/{docId}**

```
{
  patientId:        string,
  patientName:      string,
  name:             string,       // e.g. 'Valid ID'
  documentTypeId:   string,
  documentTypeName: string,
  fileName:         string,
  type:             string,        // MIME type
  size:             string,        // human-readable
  date:             string,        // human-readable
  status:           'pending' | 'verified' | 'rejected',
  idType:           string | null, // for Valid ID
  rejectionReason:  string | null,
  agreedToAttestation: boolean,
  verifiedBy:       string | null,
  verifiedAt:       Timestamp | null,
}
```

**documentContents/{docId}** (matches documents.id)

```
{
  patientId:  string,
  base64:     string,    // data URL of the file content
  fileName:   string,
  mimeType:   string,
}
```

**agencies/{agencyId}**

```
{
  id:               string,
  name:             string,
  initials:         string,
  color:            string,
  description:      string,
  location:         string,
  phone:            string,
  enabled:          boolean,
  processingTime:   string,
  assistanceTypes:  string[],
  requirements:     string[],
  slots:            { total: number, remaining: number },
  budget: {
    allocated: number,
    committed: number,
    disbursed: number,
    period:    'monthly' | 'quarterly' | 'yearly',
    periodStartedAt: Timestamp,
    fundSource:      string | null,
    fundSourceNotes: string | null,
  },
  defaultSignatory: string,
  createdAt:        Timestamp,
  updatedAt:        Timestamp,
}
```

**hospitalIds/{code}** (key is the code itself, e.g. `CRMC-2026-00001`)

```
{
  status:          'available' | 'used',
  usedBy:          string | null,     // users.uid when claimed
  patId:           string | null,     // duplicate of usedBy for rule check
  date:            string,
  time:            string,
  lastApprovedAt:  Timestamp | null,  // stamped by any agency on approve
  cooldownUntilAt: Timestamp | null,  // stamped on reversed approval
}
```

**certificates/{appId}** (key matches applications.id)

```
{
  base64:     string,         // data URL of signed GL (image or PDF)
  fileName:   string,
  appId:      string,
  agencyId:   string,
  patientId:  string,
  uploadedAt: Timestamp,
}
```

**conversations/{convId}**

```
{
  participants:  string[],          // array of user UIDs (always length 2)
  names:         { [uid]: name },
  roles:         { [uid]: role },
  subject:       string,
  lastMessage:   string,
  lastAt:        Timestamp,
  unread:        { [uid]: number }, // unread count per participant
  createdAt:     Timestamp,
}
```

**conversations/{convId}/messages/{msgId}**

```
{
  from:       string,    // sender UID
  fromName:   string,
  toUid:      string,    // recipient UID
  text:       string,
  createdAt:  Timestamp,
  read:       boolean,
}
```

**notifications/{uid}/items/{notifId}**

```
{
  type:           string,    // 'app_submitted', 'doc_verified', etc.
  title:          string,
  body:           string,
  read:           boolean,
  createdAt:      Timestamp,
  conversationId: string | null,  // optional deep link
}
```

**auditLog/{logId}**

```
{
  actor:        string,    // user.name
  actorUid:     string,
  actorRole:    string,
  actorAgencyId:string | null,
  action:       string,    // 'agency_disabled', 'doc_verified', etc.
  targetType:   string,    // 'agency', 'application', 'account', etc.
  targetId:     string,
  targetName:   string,
  details:      string,
  at:           Timestamp,
}
```

**announcements/{annId}**

```
{
  title:    string,
  message:  string,
  type:     'info' | 'warning' | 'maintenance',
  startAt:  Timestamp,
  endAt:    Timestamp,
  active:   boolean,
  reminderSent: boolean,
  createdBy:   string,
  createdAt:   Timestamp,
}
```

### 6.3 Composite Indexes

Eight composite indexes are deployed in Firestore:

1. `applications` — agencyId ASC + status ASC + submittedAt DESC (agency inbox queue with status filter)
2. `applications` — patientId ASC + agencyId ASC (cooldown self-check)
3. `applications` — agencyId ASC + status `IN` + submittedAt DESC (multi-status inbox filter)
4. `documents` — patientId ASC + status ASC (patient document tab filter)
5. `documents` — status ASC + uploadedAt DESC (admin doc review queue)
6. `notifications` (subcollection) — read ASC + createdAt DESC (unread badge count)
7. `auditLog` — actorAgencyId ASC + at DESC (agency admin audit view)
8. `auditLog` — action ASC + at DESC (admin audit filter)

---

## 7. Security Model (Firestore Rules)

### 7.1 Design Philosophy

The system follows a **zero-trust client architecture**: no client-side code is assumed to be trustworthy. Authorization is enforced exclusively by Firestore Security Rules, which run on the database server before any read or write completes.

The rules treat every collection as a separate authorization surface. Helper functions at the top of `firestore.rules` (`isAuth()`, `isPatient()`, `isAgency()`, `isAgencyAdmin()`, `isAdmin()`, `isSuperAdmin()`, `userAgencyId()`) encapsulate the role lookup, which is implemented as a `get()` against the user's profile document. This means a user's role is established once at the data layer and propagates to every rule check.

### 7.2 Rules by Collection

| Collection | Read | Create | Update | Delete |
|------------|------|--------|--------|--------|
| `users` | Self, admin, any agency | Authenticated | Self (limited fields) / admin / agency_admin (own agency, role swap only) | Super admin |
| `applications` | Owner / own agency / admin | Patient | Patient (pending→rejected, awaiting_info→reviewing) / own agency / admin | Admin |
| `documents` | Owner / admin / any agency | Patient | Owner / admin | Owner / admin |
| `documentContents` | Owner / admin / any agency | Patient | Owner / admin | Owner / admin |
| `agencies` | Public | Super admin | Admin / own agency / patient (slot decrement on apply, exactly -1 with constraints) | Super admin |
| `documentTypes` | Authenticated | Super admin | Super admin | Super admin |
| `assistanceTypes` | Authenticated | Super admin | Super admin | Super admin |
| `hospitalIds` | Public single GET (registration) / authenticated list | Super admin | Admin / authenticated (registration claim, fields constrained) / agency (cooldown stamp, fields constrained) | Super admin |
| `notifications/{uid}/items` | Owner | Authenticated | Owner | Owner |
| `conversations` | Participants | Authenticated | Participants | Admin / participant |
| `conversations/{id}/messages` | Participants | Participants | — | Admin |
| `certificates` | Owner / own agency / admin (handles null resource for not-yet-uploaded docs) | Agency / admin | Agency / admin | Admin |
| `docReviewPresence` | Admin | Admin | Admin | Admin |
| `reports` | Admin / own agency admin | Authenticated | Admin / own agency admin | Admin |
| `announcements` | Authenticated | Super admin | Super admin | Super admin |
| `auditLog` | Super admin / agency admin (own agency entries) | Authenticated (append-only) | None | None |
| `notificationErrors` | Admin | Authenticated (append-only) | None | None |

### 7.3 Notable Rule Patterns

**Field-level patient self-update guard.** A patient updating their own user document can change `name`, `contact`, `address`, `photoURL`, etc., but cannot change `role`, `agencyId`, `active`, or `rank`. This prevents privilege escalation through direct document writes.

**Cross-account cooldown through Hospital ID.** Cooldown is tracked on the `hospitalIds` document rather than the `users` document. This means a patient who deletes their account and re-registers with a new email cannot bypass the 30-day post-approval cooldown — the Hospital ID is the durable identifier.

**Patient apply-slot transaction.** A patient submitting an application atomically creates the application document AND decrements `agencies/{id}.slots.remaining` by exactly 1. The agency-update branch of the rule allows this specific patch (`diff().affectedKeys().hasOnly(['slots'])` + `slots.remaining == resource.data.slots.remaining - 1`) without granting general write access to the agency document.

**Application read-scoping by agency.** An agency user can read only applications whose `agencyId` matches their `userAgencyId()`. Cross-agency reads are denied at the query level (the patient-cooldown check in approve was rewritten to include `where('agencyId', '==', user.agencyId)` to satisfy this constraint).

**Immutability of audit-relevant collections.** `auditLog` and `notificationErrors` are append-only — no updates or deletes ever — which guarantees an attacker cannot tamper with the action history.

---

## 8. Use Case Diagrams (textual descriptions)

These descriptions can be used to draw use-case diagrams in draw.io, Lucidchart, or any UML tool.

### 8.1 Patient Use Cases

```
Actor: Patient

Use Cases:
   - Register Account
   - Log In
   - Upload Document
   - Browse Programs (Find Programs)
   - Take Screening Questionnaire
   - Submit Application
   - Track Application Status
   - Withdraw Application
   - Join Online Interview
   - Download Guarantee Letter
   - Message Agency / Admin
   - Read Notifications
   - Read User Guide
   - Change Language
   - Update Profile
   - Change Password

Includes:
   - Register Account «includes» Verify Patient Access Code
   - Submit Application «includes» Confirm Document Completeness
   - Submit Application «includes» Confirm Slot Availability
```

### 8.2 Agency Coordinator Use Cases

```
Actor: Agency Coordinator

Use Cases:
   - Log In
   - View Application Inbox
   - Start Review
   - Schedule Interview
   - Conduct Online Interview (external — Google Meet)
   - Complete Case Assessment
   - Approve Application
   - Reject Application
   - Request More Info
   - Print Guarantee Letter
   - Upload Signed Scan
   - Mark GL Redeemed
   - Mark GL Expired
   - Reverse Approval
   - Message Patient
   - Manage Daily Slots
   - View Application Logs

Includes:
   - Approve Application «includes» Check Cooldown
   - Approve Application «includes» Check Budget Remaining
   - Schedule Interview «includes» Generate Google Meet Link
```

### 8.3 Agency Administrator Use Cases (additive)

```
Actor: Agency Administrator
(inherits all Agency Coordinator use cases)

Additional Use Cases:
   - Set Budget Allocation
   - Start New Fiscal Period
   - Create Coordinator Account
   - Edit Coordinator Account
   - Deactivate / Reactivate Coordinator
   - Promote Coordinator to Admin
   - Demote Admin to Coordinator
   - View Agency Audit Log

Constraints:
   - Cannot demote self
   - Cannot demote the last remaining admin
```

### 8.4 CRMC Administrator Use Cases

```
Actor: CRMC Administrator (Staff or Super)

Common Use Cases:
   - Verify / Reject Document
   - View Application Logs (all agencies)
   - Generate Report
   - Export CSV
   - View Patient Records
   - Issue Patient Access Code
   - Manage Document Types
   - Manage Assistance Types
   - Manage Agencies
   - Disable Agency (with in-flight handling)

Super Admin Only:
   - Manage Admin Accounts
   - View Platform Audit Log
   - Create / Edit Announcements
```

### 8.5 System Actor

```
Actor: System (automated)

Use Cases:
   - Send Interview Reminder (24 h, 1 h before)
   - Reset Daily Slots (at midnight)
   - Send Application Status Email (via Vercel /api/send-email)
   - Send Announcement Reminder (24 h before)
```

---

## 9. Pages Documentation

Each page is described in one paragraph: purpose, key features, and any mobile-versus-desktop differences. URLs are listed for cross-reference.

### 9.1 Public / Pre-Authentication

**Landing — `/`.** The marketing entry page seen by visitors who reach the system URL in a regular browser. It presents the system's mission, a list of partner agencies pulled live from Firestore, a six-step "How to Get Medical Assistance" walkthrough, and call-to-action buttons for registration and download. When the system is opened in installed-PWA mode (`display-mode: standalone`), the page redirects automatically to the role's dashboard or login screen, since installed users have already passed the discovery stage.

**Login — `/login`.** Email-and-password authentication. Includes a forgot-password modal that triggers a Firebase Auth reset email, a development-only quick-login panel showing the demo accounts, and a language toggle. In installed-PWA mode, the "Back to Home" link is hidden because the marketing page is unreachable from the installed app. Error messages are translated to plain language (`"No account found with this email."` instead of Firebase error codes).

**Register — `/register`.** Multi-step patient registration: Personal Info → Account Setup → Patient Access Code. The third step verifies the access code against the `hospitalIds` collection in real time. Successful registration uses a transactional Firestore write that creates the user document and claims the access code atomically. Bilingual throughout.

**Install — `/install`.** Detects the platform (iOS / Android / desktop) and presents context-specific install instructions. On Android Chrome, it triggers the captured `beforeinstallprompt` event. On iOS Safari, it walks through Share → Add to Home Screen. On desktop, it explains that the app is mobile-oriented. Shows an "already installed" confirmation if running standalone.

### 9.2 Patient (9 pages)

**Dashboard — `/patient/dashboard`.** The post-login landing surface. Shows a personalized greeting, a contextual status line ("Get started by uploading your documents.", "Your application is under review.", "Interview scheduled.", etc.), the active application status card (color-coded by stage), a document-summary card, a five-step application-steps progress card, and a welcome card for first-time visitors. Status-card design surfaces the patient's current action — banking-app pattern. The Welcome card is dismissible per-user and auto-collapses once the patient has any progress.

**Find Programs — `/patient/programs`.** Browse all enabled agencies with their live slot counts, processing times, assistance type tags, and Apply Now action. Includes search-by-name/type, a horizontal-scroll category chip row, and an inline application modal (rendered as a bottom sheet on mobile). The mobile card layout is compact (~120 px tall) versus the desktop layout (~280 px tall) to fit four cards per screen.

**Screening — `/patient/screening`.** A guided pre-application questionnaire: the patient picks the categories of assistance they need (Hospital Bills, Medicines, etc.), and the system ranks programs by match score. Each match card shows a Top Pick badge for high-percentage matches, a slot bar, and Apply Now. Mobile compact variant mirrors Find Programs.

**My Application — `/patient/status`.** Real-time application tracking. In Progress tab shows the active application with a stage timeline (Submitted → Document Verification → Under Review → Interview → Approved → GL Issued) and a status banner. Past Applications tab lists withdrawn/rejected/historical applications. For approved applications, the signed-GL panel renders a thumbnail (image) or PDF chip with download.

**My Documents — `/patient/documents`.** Document upload and management. Tab-filtered list (All / Verified / Pending / Rejected) with summary tiles. Upload modal accepts JPG/PNG/PDF (PDF for ID documents, up to 700 KB for PDF or 4 MB image, with client-side image compression). Each document row shows status badge, file metadata, and delete (with verified-document warning).

**Interviews — `/patient/interviews`.** Lists scheduled interviews with countdown chips (Today / Tomorrow / In N days). For upcoming interviews, the Join Google Meet button is the prominent CTA. Past interviews route to Messages with a hint to contact the agency. "What to expect in the interview" expandable panel sets expectations.

**Messages — `/patient/messages`.** Conversations with hospital administrators and the patient's agency only (patient-to-patient is blocked). Empty state with "New Message" CTA; conversation rows show the other party, subject, last message, and timestamps. The compose flow restricts the recipient picker to admins and the patient's own agency.

**More — `/patient/more`.** Mobile-only dedicated page (replaces the slide-in drawer). Profile card at top, then grouped sections: Navigation (Find Programs / Interviews / User Guide), Account (Settings / Change Password), Settings (Language toggle / Privacy Notice / Help & Support / Report Problem), and Logout. On desktop, the same nav is rendered in the sidebar.

**User Guide — `/patient/guide`.** Long-form, collapsible FAQ covering registration, document upload, application, withdrawal, status meanings, interviews, GL download, contact, and password recovery. Bilingual.

### 9.3 Agency (16 pages)

**Dashboard — `/agency/dashboard`.** At-a-glance operational dashboard for the agency: today's slot remaining, this period's budget remaining, pending applications count, and a 6-row quick action list. Cards link to Inbox, Slot Management, Online Interviews, Guarantee Letters, etc. Shows the conducting agency name and color.

**Application Inbox — `/agency/inbox`.** The agency's primary work surface. Lists all applications submitted to this agency with status filters (Pending / Reviewing / Awaiting Info / Interview / Approved / Rejected). Each row shows patient name, app ID, days-waiting (color-coded amber at 3 days, red at 7), intake completion chip, and a Review button.

**Application Detail — `/agency/applications/:id`.** Four-tab modal/page: Overview, Assessment, Documents, Timeline & Notes. The Overview tab includes the action footer (Start Review / Schedule Interview / Approve & Issue GL / Reject / Request More Info / Mark Outcome) gated by current status. Includes the Interview panel with Outcome buttons (Completed / No-Show / Reschedule) and an in-tab queue navigation showing N of M with prev/next arrows.

**Case Assessment — `/agency/applications/:id/intake`.** The structured assessment form, replacing the paper Unified Intake Sheet. Five sections (Family Composition, Income & Employment, Monthly Expenses, Medical Information, Assessment) with a left-side required-fields tracker. Auto-saves to Firestore with debounce. Includes a banner stating the form should be filled during or after the patient interview, not before. Print Form action generates a styled HTML printout matching CRMC's paper layout.

**GL Viewer — `/agency/applications/:id/gl`.** Renders the Guarantee Letter exactly as it will print. Print and Save-as-PDF buttons open the browser print dialog (saving as PDF produces a true vector PDF). Upload Signed Scan modal accepts JPG/PNG/PDF. Read-only banner if the application is rejected.

**Online Interviews — `/agency/interviews`.** Lists all upcoming and past interviews for this agency. Each row shows patient, agency, date, time, and a Join Meet button. Reschedule and Outcome actions inline.

**Messages — `/agency/messages`.** Two-pane layout (conversation list left, message thread right). Compose, Reply, Mark Read, and Delete supported. Patient-initiated and admin-initiated conversations both visible.

**Guarantee Letters — `/agency/generator`.** Lists all approved applications. Each row offers Open GL Viewer + Print + Upload Signed Scan. Status pill shows GL state (Issued / Redeemed / Expired).

**Agency Profile — `/agency/program`.** View and (admin only) edit the agency's public profile: name, description, location, phone, processing time, assistance types, default signatory.

**Slot Management — `/agency/slots`.** Set the daily default slot capacity. View today's remaining and recent slot adjustments. Manual adjustment requires a reason and is audit-logged.

**Application Logs — `/agency/logs`.** Historical view of all the agency's applications with filters and CSV export.

**Funds — `/agency/funds`.** Read-only view of the agency's budget: allocated, committed, disbursed, remaining. Lists each approved GL with amount, payable-to, redemption status.

**Budget Allocation — `/agency/allocation`.** Agency-admin only. Sets the period budget (monthly / quarterly / yearly), starts a new period (resets committed and disbursed), and records the fund source.

**Agency Audit Log — `/agency/audit`.** Agency-admin only. Lists all actions taken within this agency: approvals, rejections, slot adjustments, account changes, GL state transitions.

**Team — `/agency/team`.** Agency-admin only. Manage coordinator accounts: create, edit, deactivate, send password reset, promote to admin, demote to coordinator. Guards: cannot demote self; cannot demote the last admin.

**Agency Guide — `/agency/guide`.** Long-form coordinator handbook covering inbox, intake/assessment, interview, approval, GL print/upload, redemption, expiry, reversal, slot management, budget, messaging, and FAQs.

**Upload Certificates — `/agency/certificates`.** Auxiliary bulk-upload screen for legacy signed-scan migration (rarely used in normal operation).

### 9.4 Admin (19 pages)

**Admin Dashboard — `/admin/dashboard`.** Platform-wide operational overview. Shows totals (registered patients, active applications, agencies enabled, pending document reviews), recent activity, and quick-action navigation to all admin surfaces.

**Patients — `/admin/patients`.** Lists all registered patients with search by name / contact / email / Hospital ID. Detail panel shows their applications, document history, and Hospital ID. Deactivate / Delete account actions logged.

**Hospital IDs (Access Codes) — `/admin/hospitalids`.** Issue and manage `CRMC-YYYY-NNNNN` Patient Access Codes. Bulk-create with a year-and-count picker. Manual reset (Available / Used) for edge cases.

**Agencies — `/admin/agencies`.** Lists all partner agencies with status badges and summary statistics. Search and CSV export. Click a row to open Agency Detail.

**Add Agency — `/admin/agencies/new`.** Super-admin only. Step-by-step creation: profile fields, color, requirements, assistance types, initial coordinator account.

**Agency Detail — `/admin/agencies/:id`.** Full agency profile with edit, enable/disable (with in-flight application handling), team management (formerly /admin/coordinators, now inline here), budget read-only view, application statistics.

**Admin Accounts — `/admin/accounts`.** Super-admin only. Manages CRMC system administrator accounts (super and staff levels). Agency staff are managed under each agency.

**Document Types — `/admin/doctypes`.** Define document types: name, description, required flag, sort order.

**Assistance Types — `/admin/assistance`.** Define assistance categories.

**App Logs — `/admin/logs`.** Cross-agency view of all applications. Status filters, search, CSV export.

**Document Review — `/admin/docreview`.** Queue of pending documents awaiting verification. Concurrent-review presence indicator. Filter by status and document type.

**Document Review Detail — `/admin/docreview/:docId`.** Side-by-side document preview with metadata. Verify / Reject actions with rejection reason. Notifies the patient on outcome.

**Messages — `/admin/messages`.** Same two-pane Messages component as agency, with admin-level conversation visibility.

**Reports — `/admin/reports`.** Aggregate reports: applications per agency, per status, per period. Bug reports submitted via the Report a Problem dialog.

**Export — `/admin/export`.** CSV export hub: pick data type (applications, documents, users, audit log), preview, download.

**Export Preview — `/admin/export/:type`.** Tabular preview of the exported data before download.

**Audit Log — `/admin/auditlog`.** Super-admin only. Platform-wide immutable action history with filters by actor, action type, target, and date range.

**Announcements — `/admin/announcements`.** Super-admin only. Create system-wide banners (Information / Warning / Maintenance) with start and end times. 24-hour-before reminder is auto-sent to all users.

### 9.5 Cross-Role

**Notifications — `/notifications`.** All authenticated roles. Shows the full list of in-app notifications with category filters, mark-all-read, and clear-all. Tap a notification to open its detail modal and navigate to the related page. On patient mobile, tapping the bell in the topbar navigates to this page instead of opening a dropdown.

---

## 10. Workflow Storyboards

These describe the user's perspective frame by frame. Each step is what the user does or sees; system responses are noted.

### 10.1 Patient Application Workflow

1. Patient receives a Patient Access Code at the CRMC Medical Social Services office (offline, manual).
2. Patient opens MAPA in their phone browser → taps "Download App" on Landing → installs the PWA via the Install page → opens the installed app from home screen.
3. Patient taps Register → fills personal info, account credentials, and the Patient Access Code → submits.
4. System verifies the access code, creates the user account and patient profile in one transaction, and signs the patient in.
5. Patient lands on the Dashboard, which prompts "Get started by uploading your documents."
6. Patient opens My Documents → uploads Valid ID, Barangay Certificate, Hospital Billing Statement, etc. Each upload is set to status `pending` and an in-app notification is sent to CRMC admins.
7. (Asynchronously, hours to days) A CRMC administrator opens Document Review, opens each document, marks Verified or Rejected.
8. Patient receives email + in-app notification: "Your Valid ID has been verified."
9. Patient opens Find Programs (or takes the Screening questionnaire) → reviews available agencies → taps Apply Now on a chosen agency.
10. Apply modal appears as a bottom sheet on mobile. Patient confirms document completeness, ticks declaration, taps Submit Application.
11. System runs a transaction: creates the application, atomically decrements the agency's slot, and notifies the agency.
12. Patient sees success screen with their Application ID and "What happens next" steps. They tap View My Application to land on Track Status.
13. (Asynchronously) Agency reviews the application and schedules an interview. Patient receives notification with Date, Time, and Google Meet link.
14. (24 h before) System sends reminder email + in-app notification.
15. (1 h before) System sends second reminder.
16. Patient joins the Google Meet from the My Interviews page (or Dashboard status card) at the scheduled time.
17. (After interview) Coordinator records outcome, completes the Case Assessment, and approves the application. Patient receives "Application Approved" notification with approved amount and purpose.
18. (Same day or next) Coordinator prints the Guarantee Letter, wet-signs it, scans it, uploads the scan. Patient receives "Your signed Guarantee Letter is ready" notification.
19. Patient downloads the signed GL from My Application. They present it (digital or printed) at the provider (e.g., CRMC Billing Department, Mercury Drug Cotabato).
20. (Off-system) Provider bills the agency directly for the guaranteed amount.
21. (Asynchronously) Agency marks GL as Redeemed once the bill clears. Patient may receive a follow-up notification.

### 10.2 Agency Coordinator Workflow (single application)

1. Coordinator signs in on a laptop browser. Lands on Agency Dashboard.
2. Sees "12 pending applications" in inbox card. Taps to open Inbox.
3. Inbox shows applications sorted by submission date. Days-waiting chips highlight 3-day amber and 7-day red rows.
4. Coordinator clicks the oldest pending application. Detail modal opens on Overview tab.
5. Reviews patient name, contact, hospital ID, attached documents. Switches to Documents tab to view each doc.
6. Taps "Start Review" in the action footer. Status moves from `pending` to `reviewing`. Patient is notified.
7. Coordinator taps Schedule Interview. Modal opens. Taps "Generate Meet" (opens meet.new in new tab → Google creates a meeting). Copies the URL, pastes into the Meet Link field. Enters date, time, conducting social worker name. Clicks Schedule Interview.
8. System sets application status to `interview`, stores the meet link and date/time, and notifies the patient.
9. (At the scheduled time) Coordinator joins the Google Meet, talks to the patient, learns family situation, income, expenses, medical history.
10. (After interview) Coordinator returns to the application, opens the Assessment tab, clicks Open Assessment.
11. Case Assessment page opens. Banner reminds: "Fill this during or after the patient interview." Coordinator fills Family Composition rows (add family member, name, relationship, age, occupation, monthly contribution), Income & Employment, Monthly Expenses, Medical Information, and Assessment narrative + recommendation + means-test category.
12. Form auto-saves every 1.5 seconds. Required-fields tracker shows 6 of 6 done.
13. Coordinator returns to the application Overview tab. Taps Mark Outcome on the Interview panel → Completed. Status moves to `reviewing` with outcome recorded.
14. Taps Approve & Issue GL. Modal opens showing budget remaining. Enters approved amount, picks purposes (Hospital Bills, Medicines), enters provider name (e.g., "CRMC Billing Department"). Clicks Approve & Issue GL.
15. System runs a transaction: updates application to `approved`, sets `glStatus: issued`, increments agency `budget.committed`, stamps Hospital ID `lastApprovedAt` (starts cooldown), and notifies the patient.
16. Coordinator opens GL Viewer (Open Guarantee Letter button). Reviews the rendered GL on screen.
17. Taps Print. Browser print dialog opens. Sends to physical printer.
18. Coordinator wet-signs the printed page. Scans or photographs the signed page.
19. Returns to GL Viewer. Taps Upload Signed Scan. Modal opens. Selects the PDF (or image) of the signed scan. Confirms upload.
20. System stores the certificate document and notifies the patient: "Your signed Guarantee Letter is ready to download."
21. (Days to weeks later, off-system) Provider bills the agency directly. Coordinator opens the Inbox → application → Mark GL Redeemed. Budget moves from committed → disbursed.

### 10.3 CRMC Admin — Document Review Workflow

1. Admin signs in on a laptop. Lands on Admin Dashboard.
2. Sees "Pending Documents: 7" tile. Taps to open Document Review queue.
3. Queue lists pending documents oldest-first. Concurrent-review indicator shows "John is reviewing" if another admin is already on a document.
4. Admin clicks a document row. Detail page opens with the document image / PDF embedded.
5. Admin reads the document. Decides Verified or Rejected.
6. If Verified: clicks Verify. System sets status to `verified`, notifies the patient.
7. If Rejected: clicks Reject. Modal prompts for reason (template or free text). Clicks Confirm. System sets status to `rejected` with reason, notifies the patient.
8. Admin returns to the queue. Next document loads automatically (queue navigation).

### 10.4 Agency Disable Workflow

1. Super admin (e.g., agency was terminated by CRMC).
2. Admin opens Agency Detail for the agency in question.
3. Clicks Disable button. Modal appears showing the count of in-flight applications and asking how to handle them: Auto-reject (no cooldown, recommended) or Hold (keep in queue for re-enable).
4. Admin picks an option, confirms.
5. System sets `agency.enabled: false`. If Auto-reject, sweeps each in-flight application, sets status to `rejected` with reason "Agency temporarily unavailable", does NOT stamp Hospital ID cooldown. If Hold, leaves applications in place but the patient sees an "Agency temporarily unavailable" banner.
6. Coordinators of this agency receive in-app + email notification that the agency was disabled.

### 10.5 Patient Withdrawal Workflow

1. Patient regrets applying (chose wrong agency, found other assistance, etc.). Opens My Application.
2. Finds the active application in the In Progress tab. Application is in `pending` status (this is the only status that allows withdrawal).
3. Scrolls to the bottom of the application card. Taps Withdraw Application.
4. Confirmation modal: "Withdraw this application? This cannot be undone." Patient confirms.
5. System sets status to `rejected` with reason "Withdrawn by patient". If submitted today, restores the agency's slot. Notifies the agency.

---

## 11. Testing and Quality Assurance

### 11.1 Testing Approach

The system has been developed and tested with a **manual, scenario-based approach** rather than automated unit/integration testing, given the thesis scope and timeline. Each new feature is verified end-to-end using the deployed staging URL on real devices:

- **Web testing**: Chrome, Firefox, and Edge on Windows; Safari on macOS.
- **Mobile testing**: Chrome on Android (multiple device sizes including 360 px Pixel-class devices); Safari on iOS.
- **PWA install testing**: Add to Home Screen on Android Chrome; Add to Home Screen on iOS Safari.

### 11.2 Test Scenarios Verified

**Authentication and Identity**

- Register with a valid Patient Access Code; confirm account is created.
- Register with an invalid / used Patient Access Code; confirm rejection with helpful message.
- Register with all required fields missing; confirm individual validation errors.
- Log in as each demo role (patient, agency coordinator, agency admin, staff admin, super admin); confirm correct dashboard.
- Forgot password flow; confirm reset email is received.

**Patient End-to-End**

- Register, upload all required documents, apply to an agency, see slot decrement.
- Wait for document verification by admin; confirm in-app + email notification received.
- Confirm bilingual toggle works on every patient page.
- Withdraw a pending application; confirm slot is restored same-day.
- Receive and download a signed Guarantee Letter (image and PDF).

**Agency End-to-End**

- Schedule interview via meet.new shortcut; confirm patient gets the link.
- Complete Case Assessment with all required fields; confirm Approve button unlocks.
- Approve with amount exceeding budget; confirm validation blocks.
- Approve same patient twice within 30 days; confirm cooldown blocks at the second approval.
- Approve, print GL, upload PDF signed scan; confirm patient can download.
- Mark GL Redeemed; confirm budget moves committed → disbursed.
- Reverse approval; confirm cooldown preserved and budget released.

**Admin**

- Verify document; confirm patient is notified.
- Reject document with reason; confirm patient sees the reason.
- Disable agency with in-flight applications; confirm cascade handling.
- Issue Patient Access Codes in bulk; confirm new codes appear in registration verifier.

**Cross-Cutting**

- Service worker auto-update on deploy (close all tabs, reopen, get new version).
- Offline app shell load (turn airplane mode on, open app — shell renders).
- PWA install on Android Chrome (custom prompt fires) and iOS Safari (manual flow).
- Topbar collapses to patient-friendly layout in standalone mode for patients.
- Non-patient roles signing in to installed PWA are bounced with a friendly explanation.

### 11.3 Known Issues and Limitations

| Severity | Item | Status / Plan |
|----------|------|---------------|
| Low | `DocReviewDetail.jsx:477` operator precedence bug shows "NaN" when document status is undefined during initial load race | Cosmetic; fix is a one-line change documented in audit |
| Low | Console.log statements in production code | Vite production config does not strip console output (`drop: ['console']` recommended) |
| Medium | Bundle size ~1.1 MB raw / 306 KB gzipped for the shared chunk | Largely Firebase SDK; acceptable for thesis pilot |
| Medium | Some icon-only buttons missing `aria-label` | Identified during audit; gradual fix |
| Low | Some catch blocks log to console but don't surface the underlying error in toasts | Identified and progressively fixed (apply, approve flows already done) |
| Acknowledged | Email notifications require Vercel env vars (SMTP_USER, SMTP_PASS, SMTP_FROM) to be set in the deployment | One-time setup; documented in DEPLOY.md |
| Acknowledged | Signed GL PDF upload capped at 700 KB raw (Firestore 1 MiB document limit) | Documented; full Firebase Storage migration is the production path |
| Acknowledged | No automated tests | Outside scope; manual testing on every change |

### 11.4 Performance Observations

| Metric | Measured | Target |
|--------|----------|--------|
| Initial bundle (patient, gzipped) | ~315 KB | Under 400 KB |
| Patient Dashboard time-to-interactive (4G) | ~2.5 s | Under 4 s |
| Find Programs time-to-render (after navigation, lazy chunk) | ~600 ms | Under 1 s |
| Firestore read latency (Manila → asia-southeast1) | ~80 ms | Under 200 ms |
| Page transition fade animation | 180 ms | Subtle (under 250 ms) |

---

## 12. Limitations and Future Work

### 12.1 Identified Limitations

1. **Free-tier infrastructure assumptions.** The system runs on Firebase Spark plan (free) and Vercel Hobby plan (free). Both have rate limits that would be hit at large scale (>50,000 reads/day, etc.). For production deployment with CRMC's full patient volume, upgrade to Firebase Blaze and Vercel Pro would be required.

2. **No Firebase Cloud Functions.** Email delivery uses a Vercel serverless route as a workaround. If Blaze plan is acquired, migration to Firebase Cloud Functions (or the official Trigger Email from Firestore extension) would simplify ops.

3. **No automated tests.** Manual testing is sufficient for thesis pilot but should be supplemented by Cypress (E2E) and Vitest (unit) before production.

4. **Single-pilot scope.** The system is hardcoded for one hospital (CRMC). A multi-hospital deployment would require restructuring the `users.hospitalId` namespace and adding a `hospitals` collection.

5. **No SMS notification fallback.** Patients without consistent email access miss notifications. SMS via a service like Twilio would close this gap.

6. **Document storage in Firestore.** Documents and signed GL scans are stored as base64 in Firestore. This is convenient but inefficient at scale. Migration to Firebase Storage (with signed URLs) is the recommended long-term path.

### 12.2 Future Work

- **PhilSys integration.** Once a public API is available, the manual social-worker ID verification could be supplemented by a national-ID check.

- **Push notifications via Firebase Cloud Messaging.** Free, supports both web and native, would deliver real-time updates without email-spam risk.

- **Integration with IHOMIS hospital system.** Real-time billing data exchange would close the loop on GL redemption (currently manually marked).

- **Donor portal.** A public-facing dashboard showing aggregate assistance disbursed could enable corporate/private donor matching.

- **Multi-language expansion.** Adding Maguindanaon and Iranun would cover more of the BARMM constituent base.

- **Offline-first patient applications.** Currently the app shell loads offline but writes require connectivity. Firestore's local persistence layer would allow patients on intermittent 4G to draft applications offline.

- **Cross-hospital network.** Adapting the schema to support multiple partner hospitals (BARMM-wide, eventually nationwide) is the largest architectural change but unlocks the most impact.

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **Application** | A formal request from a patient to a single agency for assistance, with associated documents and lifecycle stages. |
| **Application Lifecycle** | The state machine: pending → reviewing → (awaiting_info ↔ reviewing) → interview → approved → certificate (or rejected at any point). |
| **Assistance Type** | A category of help the system supports (Hospital Bills, Medicines, Chemotherapy, etc.), defined by CRMC admin. |
| **Case Assessment** | The structured form coordinators complete during/after an interview, digitally equivalent to CRMC's paper "Unified Intake Sheet + Social Case Study". |
| **Committed Budget** | The total of approved-but-not-yet-redeemed GL amounts; subtracted from an agency's allocation when computing remaining budget. |
| **Cooldown** | A 30-day window after a successful approval during which a patient cannot be re-approved by any agency. |
| **Disbursed Budget** | The total of GL amounts the agency has finalized (Redeemed). |
| **Guarantee Letter (GL)** | The official document issued to an approved patient, stating the guaranteed amount, purpose, and provider that will be billed. Valid for 30 days. |
| **GL Status** | Issued / Redeemed / Expired. Tracks the lifecycle of an issued GL. |
| **Hospital ID** | CRMC's Patient Access Code, format `CRMC-YYYY-NNNNN`. Issued offline by CRMC Medical Social Services. |
| **In-Flight Application** | An application not yet in a terminal state (i.e., not approved, certificate, or rejected). |
| **Means-Test Category** | The social worker's classification of the patient's financial situation: Indigent / Marginalized / Low Income / Above Threshold. |
| **PWA** | Progressive Web Application — a web app installable to the device home screen with offline shell and app-like UX. |
| **Reviewing Status** | The interim status after Start Review and before the interview is scheduled. The Assessment is filled here. |
| **Slot** | A daily-capped count of new applications an agency can receive per day. Reset to default at midnight. |
| **Stage** | A milestone in an application's lifecycle, rendered as a step in the patient's progress timeline. |

---

## Appendix A — Recommended Sections to Add for Manuscript Polish

Based on common Philippine IT thesis chapter expectations, consider adding (or expanding from this document) the following sections:

1. **Title Page, Acknowledgments, Abstract** — standard front matter.
2. **Chapter 1: Background of the Study** — incorporate Section 2 (Problem Statement) and Section 1 (Executive Summary) here.
3. **Chapter 2: Review of Related Literature** — survey prior art: existing PHIC e-services, GSIS / SSS digital portals, and academic work on government service digitalization. Cite Republic Act 10173 (Data Privacy Act) compliance considerations.
4. **Chapter 3: Methodology** — use Section 5 (System Architecture), Section 6 (Data Model), and Section 7 (Security Model). Add a description of the iterative development cycle (sprint planning, agile-ish thesis-pace iteration).
5. **Chapter 4: System Design and Implementation** — pages documentation (Section 9), workflow storyboards (Section 10), use cases (Section 8).
6. **Chapter 5: Testing and Results** — testing approach (Section 11), measurable outcomes (page-by-page deployment, pilot user count, etc.).
7. **Chapter 6: Conclusion and Recommendations** — limitations (Section 12.1) and future work (Section 12.2). Defense talking points on what would change for production scale.
8. **References** — APA / IEEE format depending on school requirements.
9. **Appendices** — Demo account credentials, deployment runbook (DEPLOY.md content), sample data, screenshots of every page.

---

## Appendix B — Demo Account Reference

For thesis demonstration / panel walkthrough:

| Role | Email | Password |
|------|-------|----------|
| Patient | patient@gmail.com | patient123 |
| Super Admin | admin@crmc.gov.ph | admin123 |
| Staff Admin | staff@crmc.gov.ph | staff123 |
| Malasakit Admin | admin@malasakit.gov.ph | agency123 |
| Malasakit Coordinator | coordinator@malasakit.gov.ph | agency123 |
| AMBaG Admin | admin@ambag.gov.ph | agency123 |
| AMBaG Coordinator | coordinator@ambag.gov.ph | agency123 |
| PCSO Admin | admin@pcso.gov.ph | agency123 |
| PCSO Coordinator | coordinator@pcso.gov.ph | agency123 |
| DSWD Admin | admin@dswd.gov.ph | agency123 |
| DSWD Coordinator | coordinator@dswd.gov.ph | agency123 |

These are seeded by the `/seed` route (requires `VITE_ENABLE_SEED=true` environment variable) and visible in the Login page's development quick-access panel.

---

*End of MAPA thesis documentation. Prepared for the thesis manuscript. Total system scope: ~38 pages across 5 roles, single React + Firebase codebase deployed via Vercel, PWA-installable for patient mobile use.*