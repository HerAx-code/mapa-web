# MAPA — Thesis Documentation

> ## ⚠ Current-state banner — 2026-08-25
> The body below predates several batches of work. All of the following is
> **live in production** and supersedes older statements in the text:
> - **Blaze plan** (not Spark). Cloud Functions deployed: `verifyAccessCode`
>   + `syncRequestFinancials` (Firestore trigger for server-derived request
>   funding integrity). Storage available; `documentContents` still base64
>   until the written migration runs. Any "Spark / no Cloud Functions /
>   Storage blocked" text is historical.
> - **Automated tests: 286** (utils 35 / components 64 / functions 49 /
>   rules 138) + GitHub Actions CI + pre-commit hook. Any "no automated
>   tests / no CI" statement is obsolete.
> - **Four GL-issuing funders** — DOH-MAIP, PCSO MAP, DSWD AICS, AMBaG — plus
>   **Malasakit as a disabled coordination hub** (RA 11463 reconciliation,
>   applied to the production DB). "Four agencies (Malasakit, AMBaG, PCSO,
>   DSWD) / 11 demo accounts" is superseded.
> - **PhilHealth-first (2026-08-27):** PhilHealth is **NOT** modelled as a
>   funder/agency — it is the **first-charge coverage that reduces the bill**
>   (Order of Charging, JAO 2020-0001), captured as `philhealthCovered` on the
>   request. CRMC applies it at assessment; only the **residual**
>   (`amountNeeded`) is endorsed to the four funders. The `philhealth` agency +
>   its two logins are disabled. Anywhere the body calls PhilHealth a funding
>   partner or lists "five funders", that is superseded — see
>   `docs/philhealth-first-plan.md`.
> - **Security §7** — a 2026-07-24 hardening sweep closed a further set of
>   permissive create/update rules; the "four acknowledged broad-write
>   tradeoffs" are now ALL addressed — the last, `applications.update`, got
>   an identity/endorsement-field lock 2026-08-25 (agencies can't reassign a
>   slice or inflate the endorsed cap).
> - **RA 10173 §16(e) erasure — residual CLOSED (2026-08-25).** Patient
>   deletion now also removes the Firebase Auth account via the deployed
>   `deleteAuthUser` Cloud Function. Where the body describes the Auth
>   account as an unremovable residual, that is historical.
> - **Public UI redesign (2026-08-25)** — two-column landing hero;
>   app-wide emoji → Material Design line icons (no new deps); a subtle
>   CSS animated "aurora" background on the landing hero + Login + Register
>   (reduced-motion-safe); elevated auth cards; PWA CTA relabelled
>   "Install App." See `docs/mobile-app-apk.md`.

**Last updated:** 2026-06-07 (reflects the CRMC-gateway redesign, the post-redesign read-pass review series, the operator-throughput follow-up batch, the first-visit guided tour batch, the full-system 46-page audit, the post-pilot live-session audit round 2 (R13–R29), the demo-account maintenance trio + Spark write-quota investigation, the post-quota recovery push: reference-data seeder, agency logo support, full-database backup, defense-demo scenario, sidebar gap fix R31, BARMM location dropdowns R32, and **the Inter-Agency Coordination Plan Phase 1 (R33 Case Timeline + R34 Watcher Subscriptions + R35 Live Over-Commitment Guard)** — see `docs/revision-list.md` for the change log)

This document compiles the requirement analysis, architecture, page-by-page documentation, data model, security model, workflows, testing notes, and future work for the **MAPA (Medical Assistance Portal Access)** system, developed as the partner-pilot platform for the Cotabato Regional Medical Center (CRMC) Malasakit Center.

It is structured for direct lift into a thesis manuscript. Sections are self-contained; reuse them under whatever chapter naming your school uses.

---

## 1. Executive Summary

MAPA is a role-based, bilingual (Filipino + English) web platform that digitizes the medical financial assistance application process at CRMC. It implements a **CRMC-gateway co-funding model**: the patient files **one request** stating the bill and amount needed, CRMC verifies the documents and conducts the single assessment interview, then CRMC endorses the request to one or more partner government agencies (Malasakit Center, AMBaG, PCSO, DSWD) as funding "slices" toward zero balance. Each agency makes its own funding decision and issues a digital Guarantee Letter (GL) for off-system settlement with healthcare providers.

This single-intake gateway replaces the previous "apply to each agency separately" model. The patient uploads documents once, attends one Google Meet interview, and sees a unified coverage plan instead of running parallel applications. Agencies receive pre-verified, pre-assessed cases and focus on their funding decision (amount, purpose, payable-to provider) without re-doing intake work.

The system is delivered as a Progressive Web Application (PWA), giving patients an installable mobile experience while agency staff and CRMC administrators use the same codebase on desktop browsers. The PWA distinction is enforced through display-mode detection — patients see a mobile-optimized bottom-tab UI, while non-patient roles installing the PWA are routed to the web portal on a laptop.

Five roles are supported: **patient** (self-registers with a CRMC-issued Patient Access Code, files the single request), **agency coordinator** (funding decisions on slices endorsed to their agency), **agency_admin** (per-agency budget allocation, team management, plus all coordinator capabilities), **staff_admin** (CRMC operations: intake, verification, endorsement, announcements), and **super_admin** (full system administration including admin accounts and platform audit).

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

1. Provide patients with a single registration and **single-intake** surface accessible from any mobile phone with internet access — one request, one document upload, one assessment interview, regardless of how many agencies ultimately co-fund the bill.
2. Implement role-based workflows for patients, agency coordinators, agency administrators (with budget allocation authority), CRMC staff administrators (intake + endorsement), and CRMC super administrators (platform oversight).
3. Digitize the Unified Intake Sheet and Client Information Sheet as a structured Case Assessment form filled jointly by the patient (factual portion via a guided wizard) and the CRMC social worker (assessment portion during the interview).
4. Generate Guarantee Letters in a layout matching CRMC's wet-signature paper form, supporting print-and-upload-signed-scan workflows. Each endorsed agency issues its own GL for its committed slice.
5. Enforce cooldown rules (30-day per-patient post-approval) across all agencies via shared Hospital ID tracking, with co-funding-aware exceptions for sibling slices of the same request.
6. Provide bilingual (Filipino + English) patient-facing UI to match the constituent base.
7. Deliver real-time notifications via in-app and email channels, including time-sensitive interview reminders (24h + 1h before).
8. Maintain a verifiable audit trail of all administrative actions, including endorsement decisions, document verification, budget allocation changes, and approval reversals.
9. Provide CRMC with a cross-slice coordination view so the agency the request was routed to has accountability, and CRMC can re-endorse to another agency if a slice is rejected or stalls.

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

**FR-P-01 Registration.** A patient shall self-register with a Patient Access Code (format `CRMC-YYYY-NNNNN`) previously issued by CRMC Medical Social Services. Registration shall collect full name, contact number, complete address (via cascading BARMM-region location dropdowns), and account credentials.

**FR-P-02 Request Submission.** A patient shall submit **one assistance request at a time** stating the assistance type, the bill amount needed, an optional description, and uploading the required documents (Valid ID, Barangay Certificate of Indigency, Hospital Billing Statement, Medical Abstract, PhilHealth ID, Medical Certificate, Laboratory Results, etc.). Submission is a 4-step guided wizard. Documents uploaded with the request are scoped per-request and reusable verified documents (e.g., Valid ID) carry over without re-upload.

**FR-P-03 On-device ID OCR.** For ID-type documents, an on-device OCR pass shall extract the name and surface an advisory cross-check ("ID name matches account" / "name not auto-matched"). This is an advisory only; the CRMC social worker remains the verifier.

**FR-P-04 Live Selfie Capture.** A live selfie shall be captured via the device camera (no upload from gallery) for the CRMC social worker to visually match against the uploaded ID.

**FR-P-05 Representative Filing.** A patient unable to file directly shall be permitted to designate a representative (relative). The representative provides their own ID, live selfie, name, and relationship; the patient remains the primary account holder.

**FR-P-06 Household Intake Wizard.** A patient shall complete the factual portion of the Unified Intake Sheet via a guided bilingual 5-step wizard (household, income, expenses, medical, review). Auto-save runs on a 2s debounce and on every step navigation. The wizard scrolls to and highlights any missing required field on validation.

**FR-P-07 Coverage Plan Review.** Once CRMC endorses the request to one or more agencies, the patient shall see a coverage plan listing each endorsed agency, the agency's procedure/requirements, and the funding amount (request total per slice). The patient shall confirm via a single Proceed action that advances every endorsed slice into the agency's funding-review queue atomically.

**FR-P-08 Per-Slice Compliance.** For each endorsed slice, the patient shall see the agency's specific requirements with a checklist of compliant vs missing items, and a direct upload affordance to satisfy any missing requirement.

**FR-P-09 Request Tracking.** A patient shall view the request lifecycle (Submitted → Under Review → Assessment → Endorsed → Partially Funded / Fully Funded) on a unified tracker, and a per-slice lifecycle (Endorsed → For Funding → Approved → GL Issued) for each endorsed agency. Real-time updates shall be received without page refresh.

**FR-P-10 Withdrawal.** A patient shall withdraw their own request while it is in a pre-endorsement state (`submitted` / `under_review` / `assessment`) and no slices exist yet. Withdrawal marks the request `closed` with reason "Withdrawn by applicant" and notifies CRMC.

**FR-P-11 Interview Attendance.** A patient shall receive CRMC's Google Meet link, scheduled date, and time. They shall be reminded 24 hours and 1 hour before the meeting (per-device localStorage dedup). Interview reminders cover both the new-model CRMC assessment interview (on the parent request) and any legacy direct-to-agency interviews.

**FR-P-12 GL Receipt.** A patient shall download their signed Guarantee Letter (image or PDF) once an agency uploads the wet-signed scan. Each GL is valid for 30 days from issuance; expiry is surfaced as a banner on the patient TrackStatus view.

**FR-P-13 Bilingual Interface.** All patient-facing UI shall be available in both Filipino and English, with a toggle accessible at any time.

**FR-P-14 Messaging.** A patient shall be able to message CRMC administrators and any agency endorsed on their request. They shall not be able to message other patients.

**FR-P-15 Touch Target Floor.** All patient-facing interactive elements shall be at minimum 44 px in tappable height, in line with Apple Human Interface Guidelines for finger-tap targets on mobile.

#### 3.1.2 Agency Coordinator Functional Requirements

**FR-A-01 Funding Inbox.** A coordinator shall view all slices endorsed to their agency, with filters by status (For Funding / Needs Info / Approved / Rejected). Slices in the patient-pre-Proceed `endorsed` state are excluded from the inbox; they enter the queue only after the patient confirms via Proceed.

**FR-A-02 Document Review (read-only).** A coordinator shall view all CRMC-verified documents attached to the parent request. The coordinator does **not** re-verify documents; CRMC owns document verification as the single intake gateway. The coordinator may surface OCR advisory notes and request additional information via the Awaiting Info path if needed.

**FR-A-03 Case Assessment View (read-only).** A coordinator shall view the Unified Intake Sheet completed jointly by the patient and CRMC, plus the CRMC interview outcome and notes. The coordinator does not edit the assessment; their role is the funding decision.

**FR-A-04 Co-funding Picture.** A coordinator shall see the full co-funding breakdown for the request: total bill, committed amount across all sibling slices, in-review amount, still-open balance, and per-agency status. This informs whether to approve in full, approve partial, or request more info.

**FR-A-05 Approval.** A coordinator shall approve a slice by entering the approved amount (in PHP), one or more purposes of assistance, and the provider name (payable-to). Approval is transactional: the agency's committed budget is incremented; the parent request's `amountCommitted` is advanced; and the request status moves to `partially_funded` or `fully_funded` as the math allows. A Guarantee Letter is issued at the moment of approval. The approved amount is hard-capped by the agency's `maxPerApplicant` (if set) and by remaining budget.

**FR-A-06 Cooldown Enforcement.** The system shall prevent a coordinator from approving a patient whose Hospital ID was approved by any agency within the past 30 days, with an explicit exception for sibling slices of the same co-funding request (those are intentionally meant to layer). The check runs both at the application level (same-agency cooldown) and at the Hospital ID level (cross-agency cooldown that survives account churn).

**FR-A-07 Request More Info.** A coordinator shall request additional information from the patient by writing a message that is delivered via in-app notification and email. The slice moves to `awaiting_info` status and is removed from the urgent queue until the patient responds.

**FR-A-08 Rejection.** A coordinator shall reject a slice with a written reason, drawn from common templates or entered as free text. The patient is notified and CRMC may re-endorse to another agency.

**FR-A-09 Daily Slot Management.** A coordinator shall set their agency's daily slot capacity. Slots are decremented at CRMC endorsement time (not at patient submission) and reset daily via either a scheduled Cloud Function (Blaze-ready) or a lazy reset on the CRMC Requests page (belt-and-suspenders).

**FR-A-10 GL Print and Upload.** A coordinator shall print or save-as-PDF the unsigned Guarantee Letter, wet-sign it physically, and upload the signed scan back to the system. The patient shall then be able to download the signed copy.

**FR-A-11 GL Lifecycle.** A coordinator shall mark a GL as Redeemed (when the provider has billed), Expired (after 30 days without redemption), or reverse the approval to correct mistakes. Reversal preserves the patient's 30-day cooldown (the patient was actually helped at one point) but releases the agency's committed budget.

**FR-A-12 Coordination Messaging.** A coordinator shall message both the patient and the CRMC social worker who endorsed the slice, via shortcut buttons that open or create the right conversation thread.

#### 3.1.3 Agency Administrator Functional Requirements

**FR-AA-01 Budget Allocation.** An agency administrator shall set the total budget for a fiscal period (monthly / quarterly / yearly), record the fund source (e.g., "PCSO Resolution #2026-15") for COA-style audit defense, and start new periods. Starting a new period resets `committed` and `disbursed` counters while preserving the allocation. The allocation save uses dotted-field updates so concurrent coordinator approvals cannot lose committed dollars through a write race.

**FR-AA-02 Per-Applicant Cap.** An agency administrator shall configure an optional per-applicant policy ceiling (e.g., PCSO ₱25K, DSWD tier limits). CRMC sees a soft warning at endorsement; the agency's Approve modal hard-blocks any approval above this cap.

**FR-AA-03 Team Management.** An agency administrator shall create, edit, deactivate, and delete coordinator accounts within their agency. They shall promote a coordinator to administrator or demote an administrator back to coordinator, with system-enforced guards preventing demotion of the last remaining administrator and self-demotion. Account creation rolls back the Firebase Auth user on Firestore setDoc failure to avoid orphan auth accounts.

**FR-AA-04 Agency Audit Log.** An agency administrator shall view a log of all administrative actions within their agency, with action type, actor, timestamp, and target. The Funds page links directly to the audit log for agency administrators.

**FR-AA-05 Top-Up Request Visibility.** An agency administrator shall see open budget top-up requests submitted by coordinators on their team, surfaced inline on the Allocation page.

**FR-AA-06 Coordinator Functions.** All coordinator functional requirements (FR-A-01 through FR-A-12) shall also be available to agency administrators.

#### 3.1.4 CRMC Administrator Functional Requirements

**FR-CRMC-01 Requests Workspace.** A CRMC administrator (both staff_admin and super_admin) shall view all submitted patient requests, with filters (Needs Action / In Progress / Completed) and search. The detail view is a guided stepper: verify documents → conduct interview + complete intake → endorse to one or more agencies. Cross-slice coverage warnings ("rejected — re-endorse", "X awaiting patient acceptance N days") surface on the list to highlight CRMC action items.

**FR-CRMC-02 Document Verification.** A CRMC administrator shall review patient-uploaded documents, marking each as verified, rejected (with reason that flows to the patient notification and persists on the document), or reset to pending (accident-recovery path). Document review state is shown inline ("Verified by X · Mar 5"). The OCR advisory result is surfaced for ID-type documents.

**FR-CRMC-03 Case Assessment (Unified Intake Sheet).** A CRMC administrator shall conduct the single assessment interview via Google Meet (link generated via the meet.new shortcut) and complete the structured Unified Intake Sheet covering family composition, monthly income and expenses, employment, medical details, social case study narrative, recommendation, and means-test classification (Indigent / Marginalized / Low Income / Above Threshold).

**FR-CRMC-04 Endorsement (Pure-Selection).** A CRMC administrator shall endorse a verified, assessed request to one or more partner agencies. Endorsement is a pure-selection model: CRMC nominates which agencies should look at the case based on assistance-type match, slot availability, and per-applicant cap visibility; the funding amount is decided by the agency, not by CRMC. CRMC may attach an optional note that appears in each agency's Approve modal. Endorsement is transactional: it creates child application "slices" (one per selected agency), decrements each agency's daily slot atomically, stamps `documents.agencyIds[]` for read-scoped access, and notifies the patient.

**FR-CRMC-05 Document Type Management.** A CRMC administrator shall define the document types accepted by the system, including which are required and which are reusable across requests.

**FR-CRMC-06 Assistance Type Management.** A CRMC administrator shall define the categories of assistance (Hospital Bills, Medicines, Chemotherapy, Laboratory Tests, Surgery, Emergency Medical Assistance, Burial Assistance, etc.).

**FR-CRMC-07 Hospital ID Issuance.** A CRMC administrator shall generate and manage the pool of Patient Access Codes (`CRMC-YYYY-NNNNN`). Bulk creation is supported with sequential numbering and collision prevention. Revoke and delete operations are atomic via `writeBatch` so the user profile and the code doc cannot drift into orphan state.

**FR-CRMC-08 Patient Records.** A CRMC administrator shall view all registered patients and their request and application histories. They shall not be able to modify patient personal details.

**FR-CRMC-09 Application Logs.** A CRMC administrator shall view all applications across all agencies, with filters and CSV export. Co-funding statuses (For Funding / Needs Info / Approved / Rejected / Guarantee Letter Issued) are surfaced consistently with the agency portal.

**FR-CRMC-10 Agency Management.** A CRMC administrator shall create, edit, enable, disable, and delete partner agencies. Disabling shall offer a choice of how to handle in-flight applications (auto-reject without cooldown — recommended for indefinite closures, or hold pending re-enable — for short outages).

**FR-CRMC-11 Reports and Export.** A CRMC administrator shall generate aggregate reports (per agency, per status, per period) and export to CSV via the Export Preview hub.

**FR-CRMC-12 Messaging Coordination.** A CRMC administrator shall message any patient or agency endorsed on a request, including a top-of-detail Message Patient shortcut on the request workspace.

**FR-CRMC-13 Announcements.** A super_admin or staff_admin shall create system-wide announcements (Information, Warning, Maintenance) visible to all authenticated users during defined time windows. A 24-hour-before reminder is auto-sent to all users.

**FR-CRMC-14 Audit Log.** A super administrator shall view the complete platform-wide audit trail of all administrative actions (endorsements, document verifications, agency disables, role changes, budget changes, GL state transitions, etc.).

**FR-CRMC-15 Admin Account Management.** A super administrator shall create, edit, deactivate, and delete administrator accounts (super and staff levels). Staff administrators cannot manage administrator accounts. Account creation rolls back the Firebase Auth user on Firestore setDoc failure to avoid orphan auth accounts.

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
│   │   ├── Tour.jsx              # First-visit guided tour (DIY portal, spotlight + tooltip)
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
│   │   ├── patient/              # 8 patient pages
│   │   ├── agency/               # 16 agency pages
│   │   ├── admin/                # 17 admin pages
│   │   └── Notifications.jsx     # Cross-role
│   ├── utils/                    # Helpers (auditLog, messages, etc.)
│   │   ├── constants.js          # ROLES, status configs, GL helpers (isGLExpired, isGLExpiringSoon, glDaysRemaining)
│   │   ├── dates.js              # Shared tsToDate (defensive Firestore Timestamp converter)
│   │   ├── notifications.js      # notify() — Firestore + email
│   │   ├── auditLog.js           # logAudit() — append-only audit writes
│   │   ├── intakeSheet.js        # Unified Intake Sheet field validation
│   │   ├── messages.js           # getOrCreateConversation()
│   │   ├── idOcr.js              # On-device tesseract OCR (lazy-loaded, shared worker)
│   │   ├── requests.js           # computeFunding() — slice-derived funding picture
│   │   └── tours.js              # First-visit guided tour step definitions + resetTourFlag()
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
| `requests` | auto-id | **Parent of the co-funding model** — the single patient request CRMC verifies and endorses to one or more agencies |
| `applications` | auto-id | Per-agency funding "slices" of a request; each agency gets one slice when CRMC endorses |
| `documents` | auto-id | Patient-uploaded supporting documents (metadata + per-request scoping via `agencyIds[]`) |
| `documentContents` | matches `documents.id` | Document file content (base64) |
| `documentTypes` | slug from name | Catalog of document types |
| `assistanceTypes` | slug from name | Catalog of assistance categories |
| `agencies` | slug (e.g. `pcso`, `dswd`) | Partner agency profiles + per-applicant cap + budget |
| `hospitalIds` | the code itself (e.g. `CRMC-2026-00001`) | Patient Access Code records + cross-account cooldown anchor |
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

**requests/{requestId}** (the co-funding parent — new under the redesign)

```
{
  requestId:         string,            // human-readable, e.g. REQ-2026-AB12CDE
  patientId:         string,            // users.uid
  patientName:       string,            // snapshot at submission
  patientContact:    string,
  patientAddress:    string,
  patientHospitalId: string | null,     // snapshot for cooldown survival
  assistanceType:    string,            // e.g. 'Hospital Bills'
  description:       string,
  // PhilHealth-first bill model (Order of Charging, JAO 2020-0001):
  totalBill:         number,            // full Statement-of-Account total (patient-declared)
  philhealthCovered: number,            // NHIF first charge — reduces the bill (CRMC-filled at assessment)
  otherCovered:      number,            // any other prior coverage
  amountNeeded:      number,            // DERIVED residual = totalBill − philhealthCovered − otherCovered
  amountCommitted:   number,            // sum of approved slice amounts
  agencyIds:         string[],          // agencies CRMC endorsed to
  status:            'submitted' | 'under_review' | 'assessment'
                    | 'endorsed' | 'partially_funded' | 'fully_funded'
                    | 'closed' | 'rejected',
  attachedDocuments: Array<{ documentId, name, documentTypeName, status, date }>,
  filedBy:           { name, relationship, repIdDocId, repSelfieDocId } | null,
  // Set when CRMC schedules the single assessment interview:
  interviewDate:     string,            // 'YYYY-MM-DD'
  interviewTime:     string,
  meetLink:          string,
  conductedBy:       string,            // CRMC social worker name
  interviewOutcome:  'completed' | 'no_show' | null,
  interviewNotes:    string,
  // Intake sheet (factual portion by patient via wizard, assessment portion by CRMC):
  intakeSheet:       { ...household, income, expenses, medical, assessment fields...,
                       completedBy, patientFilledAt, lastEditedBy },
  // Withdraw / close metadata:
  closeReason:       string | null,
  submittedAt:       Timestamp,
  updatedAt:         Timestamp,
}
```

**applications/{appId}** (per-agency funding slice — child of a request, or a legacy direct-to-agency app)

```
{
  appId:               string,           // human-readable, e.g. APP-2026-AB12CDE
  // Co-funding slice link (new model). Absent on legacy direct-to-agency apps.
  requestId:           string | null,    // parent request id; null for legacy
  amountRequested:     number,           // full request total at endorsement
  amountApproved:      number,           // agency's actual approval (≤ amountRequested)
  endorsedAt:          Timestamp | null,
  endorsedBy:          string | null,    // CRMC social worker who endorsed
  endorsedById:        string | null,    // CRMC user uid for messaging
  crmcNotes:           string | null,    // optional CRMC context for the agency

  patientId:           string,           // users.uid
  patientName:         string,           // snapshot at submission/endorse
  patientContact:      string,
  patientAddress:      string,
  patientHospitalId:   string | null,    // snapshot for cooldown survival
  agencyId:            string,
  agencyName:          string,
  agencyColor:         string,
  agencyInitials:      string,
  assistanceType:      string,
  status:              'pending' | 'endorsed' | 'reviewing' | 'awaiting_info'
                      | 'interview' | 'approved' | 'certificate' | 'rejected',
  attachedDocuments:   Array<{ documentId, name, documentTypeName, status, date }>,
  // 'stages' field deprecated -- the Timeline view derives from `status` directly.

  submittedAt:         Timestamp,
  updatedAt:           Timestamp,

  // Awaiting-info dialog:
  awaitingInfoMessage:     string | null,
  awaitingInfoRequestedAt: Timestamp | null,
  awaitingInfoRequestedBy: string | null,
  awaitingInfoResumedAt:   Timestamp | null,

  // Legacy direct-to-agency interview (CRMC interview lives on the request now):
  interviewDate:       string,
  interviewTime:       string,
  meetLink:            string,
  conductedBy:         string,
  interviewOutcome:    'completed' | 'no_show' | null,

  // Approval + GL lifecycle:
  approvedAt:          Timestamp,
  approvedAmount:      number,
  purposeOfAssistance: string[],
  payableTo:           string,
  approvedBy:          string,
  approvedByUid:       string,
  glStatus:            'issued' | 'redeemed' | 'expired' | null,
  glRedeemedAt:        Timestamp | null,
  glExpiredAt:         Timestamp | null,

  // Reversal preserves the cooldown clock so reverse-and-reapproved-elsewhere can't bypass:
  reversedAt:          Timestamp | null,
  reversedBy:          string | null,
  reversedByUid:       string | null,
  reversalReason:      string | null,
  cooldownUntilAt:     Timestamp | null,
  certificateUploaded: boolean,

  // Rejection:
  rejectionReason:     string | null,
  rejectionType:       string | null,   // e.g. 'agency_disabled' for cascade rejections
}
```

**documents/{docId}**

```
{
  patientId:        string,
  patientName:      string,
  name:             string,           // e.g. 'Valid ID'
  documentTypeId:   string,
  documentTypeName: string,
  fileName:         string,
  type:             string,            // MIME type
  size:             string,            // human-readable
  date:             string,            // human-readable
  status:           'pending' | 'verified' | 'rejected',
  idType:           string | null,     // for Valid ID
  rejectionReason:  string | null,
  agreedToAttestation: boolean,

  // Reviewer trail (rendered inline on the CRMC Requests doc panel):
  reviewedBy:       string | null,
  reviewedAt:       Timestamp | null,

  // OCR advisory (ID-type docs only):
  ocrMatch:         boolean | null,
  ocrText:          string | null,

  // Co-funding scoping: agencies can read a document only if their id is
  // in this list. CRMC stamps it at endorsement time for every doc on the
  // parent request. The legacy /seed-page backfill populated this for
  // pre-redesign documents.
  agencyIds:        string[],
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
  procedure:        string,             // free-form patient-facing instructions
  location:         string,
  phone:            string,
  enabled:          boolean,
  processingTime:   string,
  assistanceTypes:  string[],
  requirements:     string[],
  maxPerApplicant:  number | null,      // per-applicant policy cap (PCSO ₱25K, etc.)
                                        // null = no cap; soft-warn at endorse, hard-block at approve
  slots:            { total: number, remaining: number },
  lastResetDate:    string,             // YYYY-MM-DD anchor for the daily slot reset
  budget: {
    allocated:            number,
    committed:            number,
    disbursed:            number,
    period:               'monthly' | 'quarterly' | 'yearly',
    periodStart:          Timestamp,
    fundSource:           string | null,
    fundSourceNotes:      string | null,
    lowBalanceNotifiedAt: Timestamp | null,
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
  action:        string,           // 'agency_disabled', 'doc_verified', etc.
  actorId:       string,           // user.uid; 'system' for automated entries
  actorName:     string,           // user.name; 'System' for automated entries
  actorRole:     string,           // 'super_admin', 'agency_admin', etc.
  actorAgencyId: string | null,    // null for CRMC admin entries
  targetType:    string,           // 'agency', 'application', 'account', etc.
  targetId:      string,
  targetName:    string,
  details:       string,
  createdAt:     Timestamp,
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
| `requests` | Owner / admin / agency holding a slice (via `agencyIds[]` membership) | Patient | Admin / patient (submitted → closed for withdraw, or intakeSheet update only) / agency (own slice: `amountCommitted` + `status` + `updatedAt` only) | Admin |
| `applications` | Owner / own agency / agency holding a sibling slice (via the parent request's `agencyIds[]`) / admin | Patient (legacy direct apps) or admin (slice creation at endorsement) | Patient (status transitions only: pending→rejected, awaiting_info→reviewing, endorsed→reviewing) / own agency / admin | Admin |
| `documents` | Owner / admin / agency in `agencyIds[]` (scoped to docs of requests they hold a slice for) | Patient | Admin (verification) / patient (re-upload own) | Admin / patient (own) |
| `documentContents` | Owner / admin / any agency | Patient | Owner / admin | Owner / admin |
| `agencies` | Public | Super admin | Admin / own agency (any agency role on own agency — field-level constraints, e.g. budget/cap vs slots vs operational fields, are enforced in the client UI) | Super admin |
| `documentTypes` | Authenticated | Super admin | Super admin | Super admin |
| `assistanceTypes` | Authenticated | Super admin | Super admin | Super admin |
| `hospitalIds` | Public single GET (registration) / authenticated list | Super admin | Admin / authenticated (registration claim, fields constrained) / agency (cooldown stamp, fields constrained) | Super admin |
| `notifications/{uid}/items` | Owner | Authenticated | Owner | Owner |
| `conversations` | Participants | Authenticated | Participants | Admin / participant |
| `conversations/{id}/messages` | Participants | Participants | — | Admin |
| `certificates` | Owner / own agency / admin (handles null resource for not-yet-uploaded docs) | Agency / admin | Agency / admin | Admin |
| `docReviewPresence` | Admin | Admin | Admin | Admin |
| `reports` | Admin / own agency admin | Authenticated | Admin / own agency admin | Admin |
| `announcements` | Authenticated | Admin / own agency_admin (when `source == 'agency'` and `agencyId` matches) | Admin / own agency_admin (when `source == 'agency'` and `agencyId` matches) | Admin / own agency_admin (when `source == 'agency'` and `agencyId` matches) |
| `auditLog` | Super admin / agency admin (own agency entries) | Authenticated (append-only) | None | None |
| `notificationErrors` | Admin | Authenticated (append-only) | None | None |

### 7.3 Notable Rule Patterns

**Field-level patient self-update guard.** A patient updating their own user document can change `name`, `contact`, `address`, `photoURL`, etc., but cannot change `role`, `agencyId`, `active`, or `rank`. This prevents privilege escalation through direct document writes.

**Cross-account cooldown through Hospital ID.** Cooldown is tracked on the `hospitalIds` document rather than the `users` document. This means a patient who deletes their account and re-registers with a new email cannot bypass the 30-day post-approval cooldown — the Hospital ID is the durable identifier.

**CRMC-consumed slot transaction (replaces the legacy patient apply-slot rule).** Under the redesign, slots are consumed at CRMC endorsement, not at patient submission. The endorse transaction in `admin/Requests` atomically creates the application "slice" documents for each selected agency and decrements `agencies/{id}.slots.remaining` by 1 per slice. The agencies-update branch of the rule allows any agency role on its own agency (the field-level shape of the decrement is enforced in the client UI, consistent with the broader agencies-update policy). The previous patient-driven slot-decrement branch on `agencies` — which constrained the patch to `diff().affectedKeys().hasOnly(['slots'])` and `slots.remaining == resource.data.slots.remaining - 1` — was removed when the direct-to-agency apply flow was retired (see `firestore.rules` agencies comment).

**Application read-scoping by agency.** An agency user can read only applications whose `agencyId` matches their `userAgencyId()`. Cross-agency reads are denied at the query level (the patient-cooldown check in approve was rewritten to include `where('agencyId', '==', user.agencyId)` to satisfy this constraint).

**Immutability of audit-relevant collections.** `auditLog` and `notificationErrors` are append-only — no updates or deletes ever — which guarantees an attacker cannot tamper with the action history.

**Co-funding request scoping.** An agency can read a `requests` document only if its id appears in the request's `agencyIds[]` array. CRMC populates this array at endorsement time. An agency's update on the request is further constrained to `amountCommitted`, `status`, and `updatedAt` only — the agency cannot rewrite patient data, the assistance type, the bill amount, or the agency list.

**Patient request withdrawal field-level guard.** A patient updating their own request may either (a) change `status` from `'submitted'` to `'closed'` (withdraw), or (b) update `intakeSheet` and `updatedAt` only. No other patient-driven mutations are permitted; CRMC writes the lifecycle transitions beyond `submitted`.

**Document agency scoping via `agencyIds[]`.** An agency user can read a patient document only if its `agencyIds[]` includes their agency id. CRMC stamps this list at endorsement time for every doc on the request. A `/seed`-page backfill populated this for pre-redesign documents; the transitional `('agencyIds' in resource.data)` fallback has since been removed (commit `f497a79`).

**Known broad-write surfaces (acknowledged tradeoffs).** Four rule branches grant broader writes than what the UI exercises, with comments in `firestore.rules` explicitly documenting the deferral and reasoning. These are pragmatic choices for the thesis pilot's client-driven Firestore architecture; each could be tightened later as the UI gating stabilizes:

1. **`agencies` update for any agency role.** The rule allows `isAdmin() || (isAgency() && userAgencyId() == agencyId)`. A coordinator using the Firestore SDK directly could in principle write to `budget.allocated`, `defaultSignatory`, or other fields that the UI hides behind agency-admin gating. The intended tightening (per the rule comment) is a `request.resource.data.budget == resource.data.budget` field-level guard once the UI has been audited to never write budget from a coordinator path.
2. **`applications` update for own agency.** Same shape — `isAgency() && resource.data.agencyId == userAgencyId()` allows any field write on a slice for the agency's own application. A direct SDK write could fake `amountApproved` or `glStatus` outside the Approve modal flow. The UI is the gate today; a field-level diff guard scoped to the lifecycle transitions (e.g., `reviewing → approved` may set the approval fields, `approved → certificate` may flip `glStatus`, etc.) would close this.
3. **`auditLog` create is `isAuth()` with no actor-must-match-caller check.** Any authenticated user could append an entry claiming any actor identity, since the rule does not enforce `request.resource.data.actorId == uid()`. The mitigation today is that only legitimate UI paths call `logAudit()`; a one-line rule addition (`request.resource.data.actorId == uid()` on create) would make audit attribution forge-proof at the data layer.
4. **`conversations` create is open.** Any authenticated user can create a conversation between any two users. The UI restricts the compose flow to legitimate counterpart relationships (patient ↔ CRMC, patient ↔ endorsed agency, etc.), but a malicious actor with scraped UIDs could craft conversations outside those relationships at the SDK level. A rule-side check that the creator is one of `participants[]` (and that the counterpart is a legitimate role pair for the creator) would close it.

None of these is a doc-vs-rules drift — each is an intentional, commented design choice that prioritizes shipping speed and UI-as-gate over rule-level field constraint. Listed here for thesis-defense candor about the authorization model's granularity.

---

## 8. Use Case Diagrams (textual descriptions)

These descriptions can be used to draw use-case diagrams in draw.io, Lucidchart, or any UML tool.

### 8.1 Patient Use Cases

```
Actor: Patient

Use Cases:
   - Register Account
   - Log In
   - Browse Medical Programs (Find Programs)
   - Submit Assistance Request (4-step wizard: need + amount,
     documents + live selfie, optional representative, review)
   - Complete Household Intake Wizard (5 steps, auto-saved)
   - Review Coverage Plan + Proceed (accept CRMC's endorsement)
   - Comply with Per-Agency Requirements (upload any missing docs)
   - Track Request Status (request stepper + per-slice steppers)
   - Withdraw Request (pre-endorsement only)
   - Join CRMC Assessment Interview
   - Download Guarantee Letter (per approving agency)
   - Message CRMC Admin / Endorsed Agency
   - Read Notifications
   - Read User Guide
   - Change Language
   - Update Profile
   - Change Password

Includes:
   - Register Account «includes» Verify Patient Access Code
   - Submit Assistance Request «includes» Confirm Document Completeness
   - Submit Assistance Request «includes» Live Selfie Capture
   - Submit Assistance Request «includes» (optional) Representative Identity Capture
   - Review Coverage Plan + Proceed «includes» Atomic Slice Advancement
     (all endorsed slices move from `endorsed` to `reviewing` in one batch)
```

### 8.2 Agency Coordinator Use Cases

```
Actor: Agency Coordinator

Use Cases:
   - Log In
   - View Funding Inbox (slices endorsed to this agency, post-Proceed)
   - View Co-funding Picture (sibling slices + total funding progress)
   - View Documents (CRMC-verified, read-only)
   - View Case Assessment (CRMC-completed, read-only)
   - Approve Slice (amount + purpose + payable-to)
   - Reject Slice (with reason)
   - Request More Info (moves slice to awaiting_info, notifies patient)
   - Print Guarantee Letter
   - Upload Signed Scan
   - Mark GL Redeemed
   - Mark GL Expired
   - Reverse Approval (preserves patient cooldown, releases budget)
   - Message Patient
   - Message CRMC (the social worker who endorsed)
   - Manage Daily Slots
   - View Application Logs / Funds

Includes:
   - Approve Slice «includes» Check Cooldown (app-level + Hospital ID)
   - Approve Slice «includes» Check Budget Remaining (transactional)
   - Approve Slice «includes» Check Per-Applicant Cap
   - Approve Slice «includes» Advance Parent Request (`amountCommitted` += approved;
     status moves to `partially_funded` or `fully_funded`)
```

### 8.3 Agency Administrator Use Cases (additive)

```
Actor: Agency Administrator
(inherits all Agency Coordinator use cases)

Additional Use Cases:
   - Set Budget Allocation (amount + period + fund source for COA defense)
   - Set Per-Applicant Cap (PCSO ₱25K, DSWD tier limits, etc.)
   - Start New Fiscal Period (zeros committed + disbursed, preserves allocation)
   - View Open Top-Up Requests (from team coordinators)
   - Create Coordinator Account (with Auth-rollback on Firestore failure)
   - Edit Coordinator Account
   - Deactivate / Reactivate Coordinator
   - Promote Coordinator to Admin
   - Demote Admin to Coordinator
   - View Agency Audit Log

Constraints:
   - Cannot demote self
   - Cannot demote the last remaining admin
   - Budget allocation save uses dotted-field updates so concurrent
     coordinator approvals cannot lose committed dollars through a write race
```

### 8.4 CRMC Administrator Use Cases

```
Actor: CRMC Administrator (Staff or Super)

Common Use Cases (the CRMC-gateway workflow):
   - Review Incoming Request (Requests workspace)
   - Verify / Reject / Reset-to-Pending Document
     (reject with reason → patient notification; reset for accident recovery)
   - Schedule + Conduct Assessment Interview (single per request, CRMC-conducted)
   - Record Interview Outcome (Completed / No-show / Reschedule)
   - Complete Unified Intake Sheet (Case Assessment)
   - Endorse Request to one or more Agencies (pure-selection;
     amounts decided by agencies, not CRMC)
   - Re-Endorse on Slice Rejection (cross-slice coverage warnings flag this)
   - Reject / Close Request
   - Message Patient (top-of-detail shortcut)
   - View Application Logs (all agencies)
   - Generate Report
   - Export CSV
   - View Patient Records
   - Issue Patient Access Code (single + bulk)
   - Manage Document Types
   - Manage Assistance Types
   - Manage Agencies
   - Disable Agency (with in-flight handling: auto-reject or hold)
   - Create / Edit Announcements (both staff_admin and super_admin)

Super Admin Only:
   - Manage Admin Accounts (with Auth-rollback on Firestore failure)
   - View Platform Audit Log
```

### 8.5 System Actor

```
Actor: System (automated)

Use Cases:
   - Send Interview Reminder 24 h + 1 h before (both legacy direct apps AND
     new-model CRMC request interviews; per-device localStorage dedup)
   - Reset Daily Slots at PH-local midnight (scheduled Cloud Function +
     belt-and-suspenders lazy reset on CRMC Requests page on first visit)
   - Send Application Status Email (via Vercel /api/send-email + Gmail SMTP)
   - Send Announcement Reminder 24 h before window opens
   - Compute Request Lifecycle Transitions from Slice Approvals
     (request status flips to partially_funded / fully_funded as approvals land)
```

---

## 9. Pages Documentation

Each page is described in one paragraph: purpose, key features, and any mobile-versus-desktop differences. URLs are listed for cross-reference.

### 9.1 Public / Pre-Authentication

**Landing — `/`.** The marketing entry page seen by visitors who reach the system URL in a regular browser. It presents the system's mission, a list of partner agencies pulled live from Firestore, a six-step "How to Get Medical Assistance" walkthrough, and call-to-action buttons for registration and download. When the system is opened in installed-PWA mode (`display-mode: standalone`), the page redirects automatically to the role's dashboard or login screen, since installed users have already passed the discovery stage.

**Login — `/login`.** Email-and-password authentication. Includes a forgot-password modal that triggers a Firebase Auth reset email, a development-only quick-login panel showing the demo accounts, and a language toggle. In installed-PWA mode, the "Back to Home" link is hidden because the marketing page is unreachable from the installed app. Error messages are translated to plain language (`"No account found with this email."` instead of Firebase error codes).

**Register — `/register`.** Multi-step patient registration: Personal Info → Account Setup → Patient Access Code. The third step verifies the access code against the `hospitalIds` collection in real time. Successful registration uses a transactional Firestore write that creates the user document and claims the access code atomically. Bilingual throughout.

**Install — `/install`.** Detects the platform (iOS / Android / desktop) and presents context-specific install instructions. On Android Chrome, it triggers the captured `beforeinstallprompt` event. On iOS Safari, it walks through Share → Add to Home Screen. On desktop, it explains that the app is mobile-oriented. Shows an "already installed" confirmation if running standalone.

### 9.2 Patient (8 pages)

**Dashboard — `/patient/dashboard`.** The post-login landing surface. Shows a personalized greeting, a contextual status line driven by the active request or active slice ("Get started by uploading your documents.", "Your request is under review at CRMC.", "Coverage plan ready — confirm to proceed.", etc.), the active-request status card with a Status badge sourced from the shared `<StatusBadge>` component, a document-summary card with live `onSnapshot` counts (verified / pending), a five-step application-steps progress card, and a dismissible Welcome card for first-time visitors. Banner reminders for upcoming CRMC interviews fire at 24h and 1h before via per-device localStorage dedup; the sweep covers both the new-model CRMC interview (on requests) and legacy direct-app interviews.

**Find Programs — `/patient/programs`.** Browse all enabled agencies with their live slot counts, processing times, assistance type tags, and the agency's current promotion (announcement). Patient cannot apply directly from this page under the CRMC-gateway model — the page is informational; applications go through Request Assistance. A "Holding period active" banner shows when the patient has an in-flight request.

**Request Assistance — `/patient/request`.** The 4-step guided wizard: (1) What you need — assistance type, amount, optional description. (2) Documents — billing statement + the standard required documents checklist; reusable verified docs (e.g., Valid ID) carry over without re-upload; live selfie via camera-only capture. (3) Representative (optional) — when filing on the patient's behalf, the rep supplies their own ID + live selfie + relationship + authorization checkbox. (4) Review + declaration + submit. After submission, this page becomes the patient's active-request view: shows funding progress, coverage plan once endorsed, per-slice compliance checklist, the Proceed gate to accept the coverage plan, and a Withdraw button (pre-endorsement only). Patient also sees the Household Intake Wizard link from here.

**Household Intake Wizard — `/patient/request/:id/intake`.** Bilingual 5-step guided form (Household / Income / Expenses / Medical / Review). Auto-saves every 2 seconds and on every step navigation. Required-field validation jumps the patient back to the missing field with a red ring + scroll-into-view. Review step lists every section's values with per-section Edit links for one-tap return. The factual portion is the patient's responsibility; CRMC fills the assessment portion separately during the interview.

**My Application — `/patient/status`.** Real-time tracking. Top of the page shows the request lifecycle stepper (Submitted → Under Review → Assessment → Endorsed → Partially / Fully Funded). Below it, each endorsed agency slice has its own card with a 4-stage slice stepper (Endorsed → Funding Review → Approved → GL Issued) and a context-aware status banner (Confirm & Proceed when `endorsed`, View Details when `awaiting_info`, etc.). For approved slices, the signed-GL panel renders a thumbnail (image) or PDF chip with download.

**Interviews — `/patient/interviews`.** Lists the scheduled CRMC assessment interview (or any legacy agency interview still in-flight) with countdown chips (Today / Tomorrow / In N days), the conducting CRMC social worker's name, and an Add to Calendar (Google Calendar) link. The Join Google Meet button is the prominent CTA. Today's interview detection uses PH local time anchoring so the badge fires correctly even between UTC and PH midnight.

**Messages — `/patient/messages`.** Conversations with CRMC administrators and any agency endorsed on the patient's request. Patient-to-patient is blocked.

**More — `/patient/more`.** Mobile-only dedicated page (replaces the slide-in drawer). Profile card at top, then grouped sections: Navigation, Account, Settings (Language toggle / Privacy Notice / Help & Support / Report Problem), and Logout.

**User Guide — `/patient/guide`.** Long-form, collapsible FAQ covering registration, request submission, the intake wizard, the Proceed gate, the difference between request status and slice status, interview attendance, GL download, contact, and password recovery. Bilingual throughout.

### 9.3 Agency (16 pages)

**Dashboard — `/agency/dashboard`.** At-a-glance operational dashboard: today's slot remaining, this period's budget remaining, count of slices "For Funding" + "Needs Info", recent applications list. Quick-action cards link to Inbox, Slot Management, Guarantee Letters, etc. Stale-period banner fires when the budget period clock is past its window.

**Funding Inbox — `/agency/inbox`.** The agency's primary work surface. Lists all slices endorsed to this agency (excluding pre-Proceed `endorsed` slices, which are still with the patient). Status filter chips (All / For Funding / Needs Info / Approved / Rejected) double as summary count tiles. Each row shows patient name, slice ID, days-waiting (color-coded amber at 3 days, red at 7 — null-safe), duplicate-patient flag (red border + chip if this patient has multiple in-flight slices), attached doc count, GL status indicator, and an Open button. For approved-and-issued slices, a pre-expiry triage chip ("⚠ GL expires in Nd") surfaces when the validity window closes within 3 days — distinct from the existing post-expiry "Expired (action needed)" line — so coordinators can nudge patients to redeem *before* the committed budget is released. Empty state has a Clear filters CTA.

**Application Detail — `/agency/applications/:id`.** Four-tab page: Overview, Assessment, Documents, Timeline & Notes. The Overview tab shows the Co-funding Picture (total bill, committed across all sibling slices, in-review, still-open), the action banner (Start Review / Approve & Issue GL / Request More Info / Reject / Print GL / Upload Signed Scan / Mark Redeemed / Reverse Approval) gated by current status, and a stepper. The header GL badge flips amber and reads "expires in Nd" when the pre-expiry triage window (3 days) is hit, and the Approve-and-Issue-GL hint copy on the action banner re-keys to an urgency message in the same window, prompting the coordinator to message the patient before the lapse. Documents tab is read-only (CRMC verifies); shows the document-type-name (e.g., "Barangay Certificate"), the `updatedAfterSubmission` chip on patient re-uploads, and a context-aware caption distinguishing CRMC-verified from pending-re-verification. Live `onSnapshot` on patient docs surfaces re-uploads without a page reload. Timeline derives from `status` directly (no stored `stages` field). Top-of-page nav offers prev/next within the current queue filter, "Message Patient", and (when the slice has an `endorsedById`) "Message CRMC".

**Case Assessment — `/agency/applications/:id/intake`.** Read-only view for the agency of the CRMC-completed Unified Intake Sheet. (The agency does not edit the assessment under the redesign; CRMC owns it.)

**GL Viewer — `/agency/applications/:id/gl`.** Renders the Guarantee Letter exactly as it will print. Print and Save-as-PDF buttons open the browser print dialog. Upload Signed Scan modal accepts JPG/PNG/PDF. Read-only banner if the application is rejected.

**Messages — `/agency/messages`.** Two-pane layout (conversation list left, message thread right). Compose, Reply, Mark Read, and Delete supported. Both patient-initiated and CRMC-initiated conversations are visible.

**Guarantee Letters — `/agency/generator`.** Lists all approved slices. Each row offers Open GL Viewer + Print + Upload Signed Scan. Status pill shows GL state (Issued / Redeemed / Expired). Same-tab navigation under the redesign (no popup-blocked new tabs).

**Agency Profile — `/agency/program`.** View and (agency_admin only) edit the agency's public profile: name, description, procedure, location, phone, processing time, assistance types, default signatory, requirements list.

**Slot Management — `/agency/slots`.** Set the daily default slot capacity. View today's remaining and recent slot adjustments. Manual adjustment requires a reason and is audit-logged.

**Application Logs — `/agency/logs`.** Historical view of all the agency's slices with filters (Endorsed / For Funding / Needs Info / Approved / Guarantee Letter / Rejected + legacy Pending / Interview) and CSV export. Filter tabs auto-hide when count is zero so a fully-migrated agency doesn't see permanent legacy tabs.

**Funds — `/agency/funds`.** Read-only view of the agency's budget: allocated, committed, disbursed, remaining (deduced from the budget object, displayed with progress bar). Lists every budget event derived from each application's current state (approve / redeem / expire / reverse). Each event row exposes actor + payableTo + reason via a hover tooltip. Agency-admin viewers see a direct link to the audit log.

**Budget Allocation — `/agency/allocation`.** Agency-admin only. Sets the period budget (monthly / quarterly / yearly), the per-applicant cap (PCSO ₱25K, etc.), and the fund source for COA audit defense. Starts a new period (resets committed + disbursed, preserves allocation). The save path uses dotted-field updates so concurrent coordinator approvals cannot lose committed dollars through a write race. Allocation history (last 10 changes) is shown inline with optimistic updates after Save.

**Agency Audit Log — `/agency/audit`.** Agency-admin only. Lists all actions taken within this agency: approvals, rejections, slot adjustments, account changes, GL state transitions, budget changes, period resets. Filter by date / category. Clear filters CTA on the empty state.

**Team — `/agency/team`.** Agency-admin only. Manage coordinator accounts: create, edit, deactivate, send password reset, promote to admin, demote to coordinator. Guards: cannot demote self; cannot demote the last admin. Account creation rolls back the Firebase Auth user if Firestore setDoc fails (prevents orphan auth accounts). Promote/demote uses a busy-state guard so double-click can't fire twice.

**Announcements — `/agency/announcements`.** Agency-admin only. Manage the agency's promotional announcements that appear on the patient Find Programs page.

**Agency Guide — `/agency/guide`.** Long-form coordinator handbook covering the funding inbox, the agency's role under co-funding, approval, GL print/upload, redemption, expiry, reversal, slot management, budget, messaging, and FAQs.

**Upload Certificates — `/agency/certificates`.** Auxiliary bulk-upload screen for legacy signed-scan migration (rarely used in normal operation).

### 9.4 Admin (17 pages)

**Admin Dashboard — `/admin/dashboard`.** Platform-wide operational overview. Live counter tiles (patient count, agency count, open requests, pending docs, plus super-admin SLA tiles for approved / rejected / certificate backlog). All counters route through onSnapshot with error fallbacks that display "—" on permission failure rather than hanging the loading spinner forever. Stale-app detection covers both the new `awaiting_info` slice status and the legacy `pending` status.

**Requests — `/admin/requests`.** CRMC's primary work surface under the redesign. Lists all patient requests with filters (All / Needs Action / In Progress / Completed) and search. Each row shows the patient, the funding picture (needed / secured / progress bar) derived from slice-level `computeFunding()`, the pipeline stage chip, and any coverage warning ("X rejected — re-endorse", "Y awaiting patient acceptance"). The detail view is a guided workspace: ① Verify documents (with OCR advisory, Reset-to-Pending recovery, reject-with-reason ConfirmModal, **plus a "Verify all pending (N)" bulk action** that commits every pending doc in a single Firestore `writeBatch` — rejection intentionally stays per-doc because it requires a reason and notifies the patient; only the safe direction is bulked), ② Schedule + conduct interview + complete the Unified Intake Sheet, ③ Endorse to one or more agencies (pure-selection model with the optional CRMC note). Status sub-header includes a Message Patient shortcut and a Withdraw / Close / Reject path.

**Intake Sheet — `/admin/requests/:id/intake`.** The Unified Intake Sheet workspace for CRMC. Fillable sections for the assessment portion (the factual portion is patient-completed via the wizard at `/patient/request/:id/intake`). Print Form action generates a styled HTML printout matching CRMC's paper layout.

**Patients — `/admin/patients`.** Lists all registered patients with search by name / contact / email / Hospital ID. Active-applicant query covers all in-flight statuses including `endorsed` (this was a bug pre-redesign — patients with endorsed slices were missing). Detail panel shows their requests, slices, document history, and Hospital ID. Deactivate / Delete account actions are audit-logged.

**Hospital IDs (Access Codes) — `/admin/hospitalids`.** Issue and manage `CRMC-YYYY-NNNNN` Patient Access Codes. Bulk-create up to 100 codes per batch with sequential numbering (collision-safe — uses max existing number, not count). Atomic revoke and delete operations via `writeBatch` so the user profile and the code doc cannot drift into orphan state. **Print Available batch** opens a self-contained print window with the currently-filtered available codes laid out 4-up on A4 with dashed cut lines, CRMC + MAPA header per card, the registration URL (derived from `window.location.origin` so it works in any deployment), brief patient instructions, and the issue date — closing the real-world workflow gap that Medical Social Services issues codes in person and previously had to hand-copy each one. The action is audit-logged (`hospitalid_printed`) so code issuance remains traceable.

**Agencies — `/admin/agencies`.** Lists all partner agencies with status badges and summary statistics. Search and filter. Click a row to open Agency Detail. Pristine empty state has an "Add First Agency" CTA.

**Add Agency — `/admin/agencies/new`.** Super-admin only. Step-by-step creation: profile fields, color, requirements, assistance types, initial coordinator account.

**Agency Detail — `/admin/agencies/:id`.** Full agency profile with edit, enable / disable (with in-flight application handling: auto-reject or hold), team management inline (replaces the retired `/admin/coordinators`), budget read-only view, application statistics, and a delete action wrapped in a ConfirmModal. Disable cascade dialog explains both options before commit.

**Admin Accounts — `/admin/accounts`.** Super-admin only. Manages CRMC system administrator accounts (super and staff levels). Agency staff are managed under their agency. Account creation rolls back the Firebase Auth user if Firestore setDoc fails. Empty state has an "Add First Account" CTA.

**Document Types — `/admin/doctypes`.** Define document types: name, description, required flag, reusable flag, sort order. Drag-to-reorder and duplicate-detection.

**Assistance Types — `/admin/assistance`.** Define assistance categories.

**App Logs — `/admin/logs`.** Cross-agency view of all applications. Status filters cover co-funding statuses (endorsed / reviewing / awaiting_info / approved / certificate / rejected) plus legacy (pending / interview). Search and CSV export. Filter tabs auto-hide when count is zero. Clear filters CTA on the empty state.

**Messages — `/admin/messages`.** Same two-pane Messages component as agency, with admin-level conversation visibility. Compose modal restricted to patients and CRMC staff per the patient's relationships.

**Reports — `/admin/reports`.** Aggregate reports: applications per agency, per status, per period. Bug reports submitted via the Report a Problem dialog. Empty-state CTA on filtered views.

**Export — `/admin/export`.** CSV export hub: pick data type (applications, documents, users, audit log), preview, download.

**Export Preview — `/admin/export/:type`.** Tabular preview of the exported data before download. Date-range filter + search.

**Audit Log — `/admin/auditlog`.** Super-admin only. Platform-wide immutable action history with filters by actor, action type, target, and date range. Clear filters CTA on the empty state.

**Announcements — `/admin/announcements`.** Super-admin or staff-admin. Create system-wide banners (Information / Warning / Maintenance) with start and end times. 24-hour-before reminder is auto-sent to all users.

### 9.5 Cross-Role

**Notifications — `/notifications`.** All authenticated roles. Shows the full list of in-app notifications with category filters, mark-all-read, and clear-all. Tap a notification to open its detail modal and navigate to the related page. On patient mobile, tapping the bell in the topbar navigates to this page instead of opening a dropdown.

### 9.6 First-Visit Guided Tour (cross-cutting onboarding)

A reusable `<Tour>` component delivers a Canva-style first-visit walkthrough on the landing pages of all three roles. New users see a four-step tooltip tour highlighting key elements; returning users see nothing (the dismissal flag is keyed `mapa_tour_{storageKey}_{uid}` in `localStorage`, so it survives logout-and-back-in on the same device and is per-user on shared devices). Implementation is DIY (~200 lines, no library dependency) — Tailwind-styled portal with a four-quadrant dim overlay, a pulsing brand-color spotlight ring on the target, and a tooltip card with Back / Next / Skip / Done controls. Targets are addressed via `data-tour-id="..."` attributes; missing targets fall back gracefully to a centered tooltip so the tour still works when a conditional element isn't currently rendered. Tour string content is bilingual on the patient surface (via `t()` against the `tour.patient.*` i18n keys) and English-only on the agency and admin surfaces, matching the rest of those role's UI per CLAUDE.md.

Per-page tour coverage:

| Page | Steps | Spotlights |
|------|-------|------------|
| **Patient Dashboard** (`/patient/dashboard`) | 4 | Greeting · hero card (whichever conditional variant is rendered) · 5-step journey card · document status |
| **Patient TrackStatus** (`/patient/status`) | 3 | Active/past tabs · request lifecycle stepper · per-agency slice cards (falls back to centered before CRMC endorses) |
| **Agency Dashboard** (`/agency/dashboard`) | 4 | Metrics grid · slot meter · budget card · quick-action shortcuts |
| **Admin Dashboard** (`/admin/dashboard`) | 4 | Metric tiles · alerts panel · activity feed · Manage/Review shortcuts |

Re-trigger affordances: patients re-launch the tour from `/patient/more` → Settings → "Show welcome tour again" (proper home for user-facing toggles); agency coordinators and admins use an unobtrusive footer link "Show welcome tour again" at the bottom of their dashboard. Both call `resetTourFlag(storageKey, uid)` from `utils/tours.js` to clear the localStorage gate, then either navigate home (patient) or reload (agency / admin) so `<Tour>` re-evaluates its mount-time gate. This makes the tour fully demoable to the thesis panel without clearing `localStorage` by hand.

The patient `RequestAssistance` wizard and `IntakeWizard` are intentionally not toured: they are step-by-step wizards with their own progress indicators + Back/Next navigation, so a tour overlay on top would duplicate orientation already present in the wizard chrome.

---

## 10. Workflow Storyboards

These describe the user's perspective frame by frame. Each step is what the user does or sees; system responses are noted.

### 10.1 Patient End-to-End Workflow (CRMC-gateway model)

1. Patient receives a Patient Access Code at the CRMC Medical Social Services office (offline, manual).
2. Patient opens MAPA in their phone browser → taps "Download App" on Landing → installs the PWA via the Install page → opens the installed app from home screen.
3. Patient taps Register → fills personal info, account credentials (BARMM cascading location dropdowns), and the Patient Access Code → submits.
4. System verifies the access code, creates the user account and claims the code in one transaction, signs the patient in.
5. Patient lands on the Dashboard. Welcome card prompts "Get started by filing a request."
6. Patient opens Request Assistance → 4-step wizard: (1) need + amount, (2) attach documents + take live selfie, (3) optional representative section, (4) review + declaration → submit.
7. System creates the request as `submitted`, persists the document references on the request, notifies CRMC admins.
8. Patient sees success screen with the Request ID + clipboard-copy button. Taps "View My Application" to land on TrackStatus.
9. Patient opens the Household Intake Wizard from the active-request panel → 5-step bilingual form (household, income, expenses, medical, review). Auto-saves every 2 seconds + on every step navigation; the indicator shows "Saved · 2:45 PM".
10. (Asynchronously, hours to days) A CRMC social worker opens the Requests workspace → verifies each document (rejection prompts a reason that flows back to the patient as notification + email; reset-to-pending is available for accident recovery).
11. (Once all documents verified) CRMC schedules the assessment interview via the meet.new shortcut → patient receives notification with Date, Time, and Google Meet link.
12. (24 h before) System sends reminder email + in-app notification (per-device localStorage dedup).
13. (1 h before) Second reminder.
14. Patient joins the Google Meet from `/patient/interviews` (or the Dashboard status card with inline Join Meet link) at the scheduled time. The interview details panel shows the CRMC social worker's name + Add to Calendar link.
15. (After interview) CRMC records the outcome (Completed / No-show / Reschedule), finishes the Unified Intake Sheet assessment portion. Patient sees the request advance to `assessment` then to `endorsed` once CRMC endorses to one or more agencies.
16. Patient sees the coverage plan in the active-request panel: each endorsed agency listed with its procedure, requirements, and the funding amount. Per-slice requirements compliance checklist surfaces any missing docs with a direct upload button.
17. Patient taps the Proceed button → system atomically advances every endorsed slice from `endorsed` to `reviewing` in a single writeBatch and notifies every agency's coordinators.
18. (Asynchronously) Each agency makes its funding decision. Patient sees per-slice status changes: Approved, GL Issued (with download), Needs Info (with View Details CTA), or Rejected. Cooldown rules layer correctly for sibling slices.
19. Patient downloads each signed GL from My Application once the agency uploads the wet-signed scan. Presents the GL (digital or printed) at the provider (CRMC Billing Department, Mercury Drug Cotabato, etc.).
20. (Off-system) Provider bills the agency directly for the guaranteed amount.
21. (Asynchronously) Agency marks GL as Redeemed once the bill clears. Request status moves to `partially_funded` or `fully_funded` based on whether the bill is fully covered.

**Withdrawal path (pre-endorsement only).** While the request is in `submitted`, `under_review`, or `assessment` (and no slices exist yet), the patient may tap "Withdraw Application" on the active-request panel → ConfirmModal → request marked `closed` with reason "Withdrawn by applicant" → CRMC notified. After CRMC endorses, withdrawal is not offered (agencies have committed time to review); the patient reaches out via Messages instead.

### 10.2 Agency Coordinator Workflow — single slice under the CRMC-gateway model

1. Coordinator signs in on a laptop browser. Lands on Agency Dashboard.
2. Sees "5 For Funding · 2 Needs Info" in the inbox tile. Taps to open Funding Inbox.
3. Inbox shows slices CRMC endorsed to this agency, already past the patient's Proceed gate. Days-waiting chips highlight 3-day amber and 7-day red rows. Duplicate-patient flag shows if the patient has multiple in-flight slices across agencies.
4. Coordinator clicks the oldest For-Funding slice. ApplicationDetail opens with the Co-funding Picture at the top (Total bill ₱60,000 · Committed ₱20,000 · In review ₱20,000 · Still open ₱20,000) so the coordinator knows how much room there is.
5. Switches to the Documents tab — all CRMC-verified, read-only. Notes that the Barangay Certificate is flagged "Updated after submission" (patient re-uploaded after CRMC verification — a chip highlights this; the caption qualifies "any re-uploaded files are pending re-verification").
6. Switches to the Assessment tab — reads CRMC's completed Unified Intake Sheet + interview outcome + notes. Means-test category: Indigent.
7. Returns to Overview. The action banner says "CRMC verified the documents and completed the assessment. Approve your share and issue the GL, request more info, or reject." Taps "Approve & Issue GL".
8. ApproveModal opens. Pre-fills the agency's per-applicant cap (PCSO ₱25,000) as the hard ceiling. Shows budget remaining (₱150,000). Coordinator enters the approved amount (₱20,000), picks purposes (Hospital Bills, Medicines), enters payable-to ("CRMC Billing Department"), confirms approver name. Clicks "Approve & Issue GL".
9. System runs cooldown checks (per-app + Hospital ID), then a transaction: updates the slice to `approved` with `glStatus: issued`, increments the agency's `budget.committed`, advances the parent request's `amountCommitted` (now ₱40,000 of ₱60,000 secured → status flips to `partially_funded`), stamps Hospital ID `lastApprovedAt` (starts cross-account cooldown), and notifies the patient + the CRMC social worker who endorsed.
10. Coordinator opens the GL Viewer (Print Guarantee Letter button → opens in same tab). Reviews the rendered GL.
11. Taps Print. Browser print dialog opens. Sends to physical printer.
12. Coordinator wet-signs the printed page. Scans or photographs the signed page.
13. Returns to GL Viewer. Taps Upload Signed Scan. Modal opens. Selects the PDF or image of the signed scan. Confirms upload.
14. System stores the certificate document and notifies the patient: "Your signed Guarantee Letter is ready to download."
15. (Days to weeks later, off-system) Provider bills the agency directly. Coordinator opens the slice → Mark GL Redeemed. Budget moves from committed → disbursed; agency Funds page logs the event with the actor + payable-to surfaced in the row tooltip.

**Request-More-Info path (when the agency needs something from the patient before deciding).** Coordinator taps "Request More Info" → RequestInfoModal → enters a templated or free-text message → slice moves to `awaiting_info` → patient gets notification + email + "Needs Info" banner on TrackStatus with View Details CTA → patient uploads the requested doc / replies via Messages → coordinator taps "Resume Review" → slice flips back to `reviewing`.

**Rejection path.** Coordinator taps "Reject" → RejectModal → picks a template reason or writes free-text → slice marked `rejected` with reason. CRMC sees the cross-slice coverage warning "1 rejected · re-endorse" on the Requests list and can endorse to another agency to cover the balance.

### 10.3 CRMC Admin — Request Verification + Endorsement Workflow

1. Admin signs in on a laptop. Lands on Admin Dashboard.
2. Sees "Open requests: 7" tile (with cross-slice coverage warnings like "X awaiting patient acceptance"). Taps to open Requests workspace.
3. Requests list shows the queue with stage chips and the per-request funding picture (needed / secured / progress bar derived from sibling slices, not from the cached `amountCommitted` field — fresh source of truth).
4. Admin clicks a request. Detail opens as a guided stepper.
5. **Step ① Verify documents.** Each attached doc is shown with its current status. For ID-type docs, the OCR advisory line is surfaced ("✓ OCR: ID name matches the account" or "⚠ OCR: name not auto-matched — verify manually"). Admin taps Verify on each doc, or Reject (opens ConfirmModal with reason — reason flows to patient notification + email + persists to `documents.rejectionReason`). Reset-to-Pending available on verified or rejected docs for accident recovery. Each verification stamps `reviewedBy` + `reviewedAt` shown inline on the doc row. When two or more docs are pending and the admin has reviewed them all and they look fine, **Verify all pending (N)** commits every pending doc in a single `writeBatch` — typical request has 4-7 docs, saving 3-6 clicks in the common path. Rejection deliberately stays per-doc (reason required + patient notification).
6. **Step ② Interview + Assessment.** Once all docs are verified, "Schedule Interview" unlocks. Admin opens InterviewModal, taps "Generate Meet" (opens meet.new), copies the URL, fills date / time / conducting social worker. Submit advances the request to `assessment` and notifies the patient.
7. (At the scheduled time) Admin joins the Google Meet, conducts the assessment.
8. (After interview) Admin records the outcome (Completed / No-show / Reschedule — Reschedule re-opens InterviewModal). Then opens the Unified Intake Sheet workspace and completes the assessment portion (the patient already filled the factual portion via the wizard).
9. **Step ③ Endorse.** Once the documents are verified, the intake is complete, AND the interview outcome is recorded, the "Endorse" button unlocks. Admin opens EndorseModal. Shows the funding summary (Needed / Secured / Endorsable). Lists eligible agencies sorted by best-fit (assistance-type match first, then alphabetical) with per-agency context (open slots, budget remaining, per-applicant cap). Pure-selection: admin ticks one or more agencies (no peso amounts at endorsement). Optionally attaches a CRMC note that surfaces on each agency's Approve modal. Confirms.
10. System runs a transaction: creates one application "slice" per selected agency, atomically decrements each agency's daily slot, stamps `documents.agencyIds[]` for read-scoped access, sets the request status to `endorsed`, and notifies the patient (single notification covering all endorsed agencies).
11. Patient sees the coverage plan in TrackStatus, hits Proceed when ready → each slice advances independently from then on. CRMC sees coverage warnings on the Requests list if any slice rejects (and the balance is not yet covered) or stalls in `endorsed` for > 3 days (patient hasn't Proceeded).
12. If a slice rejects, admin opens the request again and re-endorses to a different agency. The earlier endorsement remains in the audit trail.

### 10.4 Agency Disable Workflow

1. Super admin (e.g., agency was terminated by CRMC).
2. Admin opens Agency Detail for the agency in question.
3. Clicks Disable button. Modal appears showing the count of in-flight applications and asking how to handle them: Auto-reject (no cooldown, recommended) or Hold (keep in queue for re-enable).
4. Admin picks an option, confirms.
5. System sets `agency.enabled: false`. If Auto-reject, sweeps each in-flight application, sets status to `rejected` with reason "Agency temporarily unavailable", does NOT stamp Hospital ID cooldown. If Hold, leaves applications in place but the patient sees an "Agency temporarily unavailable" banner.
6. Coordinators of this agency receive in-app + email notification that the agency was disabled.

### 10.5 Patient Withdrawal Workflow

1. Patient regrets filing (found other assistance, made a mistake, etc.). Opens Request Assistance (the active-request panel).
2. The "Withdraw Application" button is offered only when the request is in `submitted`, `under_review`, or `assessment` AND no slices exist yet (CLAUDE.md: "Patient can withdraw before endorsement").
3. Patient taps Withdraw Application → ConfirmModal: "Withdraw this application? This cannot be undone."
4. Patient confirms → system marks the request `closed` with reason "Withdrawn by applicant." → CRMC admins are notified so the row clears from their action queue.
5. Patient is free to submit a new request anytime.

Once CRMC has endorsed (slices exist with agencies committed to review), withdrawal is no longer offered. The patient instead Messages CRMC or the relevant agency if circumstances change.

---

## 11. Testing and Quality Assurance

### 11.1 Testing Approach

The system has been developed and tested with a **manual, scenario-based approach** rather than automated unit/integration testing, given the thesis scope and timeline. Each new feature is verified end-to-end using the deployed staging URL on real devices:

- **Web testing**: Chrome, Firefox, and Edge on Windows; Safari on macOS.
- **Mobile testing**: Chrome on Android (multiple device sizes including 360 px Pixel-class devices); Safari on iOS.
- **PWA install testing**: Add to Home Screen on Android Chrome; Add to Home Screen on iOS Safari.

### 11.2 Test Scenarios Verified

**Authentication and Identity**

- Register with a valid Patient Access Code (cascading BARMM location dropdowns); confirm account is created.
- Register with an invalid / used Patient Access Code; confirm rejection with helpful message.
- Register with all required fields missing; confirm individual validation errors.
- Log in as each demo role (patient, agency coordinator, agency_admin, staff_admin, super_admin); confirm correct dashboard.
- Forgot password flow; confirm reset email is received.

**Patient End-to-End (CRMC-gateway model)**

- Register, file a request via the 4-step wizard (need + amount + documents + live selfie + optional representative + review + declaration), see Request ID on success screen with clipboard-copy.
- Complete the Household Intake Wizard 5-step bilingual form, confirm auto-save indicator shows "Saved · HH:MM" after 2-second debounce and on every step navigation.
- Validate a required field is missing → confirm the wizard jumps to the step + scrolls the missing field into view + applies a red ring.
- Wait for CRMC document verification; confirm in-app + email notification with the rejection reason if applicable.
- Receive the CRMC interview invite; confirm 24h + 1h reminders fire (per-device localStorage dedup means a single device doesn't get duplicate reminders on dashboard re-open).
- Confirm "Add to Calendar" link generates a working Google Calendar event with the PH-anchored date/time and the Meet link in details.
- Verify "Today" badge on the Interviews page fires correctly at all PH local times (including 5 AM PH when UTC is still yesterday).
- Receive coverage plan + tap Proceed → confirm all endorsed slices advance to `reviewing` in a single batch.
- Withdraw a request before endorsement → confirm request marked `closed` and CRMC notified.
- Confirm Withdraw button is NOT offered after endorsement (slices exist).
- Receive and download a signed Guarantee Letter (image and PDF) per approving agency.
- Confirm bilingual toggle works on every patient page.

**Agency End-to-End (slice-focused under the redesign)**

- Confirm Funding Inbox excludes pre-Proceed `endorsed` slices (they're with the patient until Proceed).
- Open a `reviewing` slice → confirm Documents tab is read-only (CRMC-verified) → confirm Co-funding Picture shows the sibling slices and total funding progress.
- Approve a slice; confirm transaction (a) increments agency `budget.committed`, (b) advances parent request's `amountCommitted`, (c) flips parent request to `partially_funded` or `fully_funded`, (d) stamps Hospital ID `lastApprovedAt` (starts cross-account cooldown).
- Approve with amount exceeding budget; confirm validation blocks.
- Approve with amount exceeding `maxPerApplicant`; confirm validation blocks.
- Approve same patient twice within 30 days at DIFFERENT requests; confirm cooldown blocks at the second approval.
- Approve same patient at sibling slices of the SAME request; confirm cooldown intentionally allows this (co-funding exemption).
- Request More Info → confirm slice moves to `awaiting_info`, patient sees the message in TrackStatus banner with View Details CTA, patient docs re-upload via `onSnapshot` reflects live in the agency view.
- Reject slice → confirm CRMC sees the cross-slice coverage warning "1 rejected · re-endorse" on the Requests list.
- Approve, print GL, upload PDF signed scan; confirm patient can download.
- Mark GL Redeemed; confirm budget moves committed → disbursed; confirm Funds event tooltip surfaces actor + payable-to.
- Reverse approval; confirm cooldown preserved (Hospital ID cooldownUntilAt set) and budget released.
- Agency Allocation save while a coordinator is approving concurrently → confirm dotted-field update doesn't overwrite the increment.

**CRMC Admin (Requests Workspace)**

- Verify document → confirm patient is notified.
- Reject document with reason → confirm reason flows to patient notification AND persists on the document for audit.
- Reset document to Pending → confirm reviewer trail is cleared, no patient notification (accident recovery only).
- Schedule the assessment interview via meet.new shortcut; confirm patient gets the link.
- Complete the Unified Intake Sheet during/after the interview; confirm patient's wizard-filled factual portion is preserved (not clobbered).
- Endorse a request to multiple agencies via the pure-selection model → confirm transaction creates N slice docs, decrements N slots, stamps `documents.agencyIds[]`, notifies the patient.
- Re-endorse after a slice rejection → confirm new slice is created, original rejection preserved in audit trail.
- Disable agency with in-flight applications; confirm cascade handling (auto-reject with no cooldown, or hold).
- Issue Patient Access Codes in bulk (up to 100 per batch); confirm new codes appear in registration verifier; confirm sequential numbering uses max existing + 1 (no collisions even after deletes).
- Revoke + Delete a Hospital ID → confirm atomic `writeBatch` so users.hospitalId and the code doc never drift into orphan state.

**First-Visit Guided Tour**

- Sign in as a fresh patient → confirm 4-step tour auto-fires on Dashboard with pulsing spotlight on the greeting, hero card, steps card, and docs status; toggle to Filipino → re-trigger via More → Settings → Show welcome tour again; confirm tooltip copy renders in Filipino.
- Navigate to TrackStatus as a freshly-submitted patient → confirm 3-step tour auto-fires; confirm the third "Agency cards" step falls back to centered (no slices yet) without breaking the flow.
- Sign in as an agency coordinator → confirm 4-step English tour fires on Agency Dashboard with spotlights on metrics, slot meter, budget card, and quick actions; refresh page → confirm tour does NOT re-fire (localStorage gate working).
- Sign in as a super_admin → confirm 4-step English tour fires on Admin Dashboard with spotlights on metrics, alerts, activity feed, and Manage/Review shortcuts.
- Replay-tour affordances: patient More → Settings → "Show welcome tour again" → confirm toast + navigate to dashboard + tour re-fires; agency / admin footer "Show welcome tour again" link → confirm page reloads and tour re-fires.
- Per-user scope: log out the patient and log in as a different patient on the same device → confirm the second patient sees the tour fresh (uid scoping).

**Cross-Cutting**

- Service worker auto-update on deploy (close all tabs, reopen, get new version).
- Offline app shell load (turn airplane mode on, open app — shell renders).
- PWA install on Android Chrome (custom prompt fires) and iOS Safari (manual flow).
- Topbar collapses to patient-friendly layout in standalone mode for patients.
- Non-patient roles signing in to installed PWA are bounced with a friendly explanation.
- Create admin account with bad Firestore rules → confirm Auth-user rollback fires (no orphan auth account).
- All onSnapshot listeners with a permission failure → confirm the loading spinner clears + console.error fires (never hangs silently).

### 11.3 Read-Pass Review Series (post-redesign quality pass)

After the CRMC-gateway redesign stabilized, each major page was read end-to-end and reviewed for correctness, UX, and consistency. The full series produced ~30 commits and captured the bugs catalogued in §11.4 below. Pages covered:

- Patient: TrackStatus, RequestAssistance, IntakeWizard, Interviews, Dashboard
- Agency: Inbox, ApplicationDetail, Funds, Team, Allocation
- Admin: Requests, AgencyDetail, HospitalIDs, Accounts, Reports

The series also delivered cross-cutting cleanups: 20 onSnapshot error-callback fixes; 124 orphan i18n keys removed; `STATUS_CONFIG` consolidation across 6 pages (single source via `<StatusBadge>` component); empty-state CTAs across 14 filterable lists and 4 pristine-empty pages with creator authority; touch-target floor enforcement on all patient CTAs.

A second, **full-system 46-page audit** followed, this time explicitly avoiding the subagent-skim pattern that produced false positives during the first pass (auto-summaries missed a Dashboard empty state and an Inbox GL chip that already existed). Every page was read directly against its actual source. The audit ran in three batches (Patient + Auth = 13 pages, Agency = 16 pages, Admin = 17 pages) and produced bugs #21 through #29 in §11.4 plus a thesis doc §6.2 schema realignment (bug #25) — caught because the doc still referenced `actor`/`actorUid`/`at` while the code had moved to `actorName`/`actorId`/`createdAt`.

### 11.4 Real Correctness Bugs Caught in the Read-Pass Series

| # | Bug | Impact | Fix |
|---|-----|--------|-----|
| 1 | admin/Patients active-applicant query missing `endorsed` | Patients with endorsed slices were invisible in the admin list | Added to query |
| 2 | 20 onSnapshot listeners had no error callback | Loading spinners would hang forever on permission errors | Sweep added handlers + setLoading(false) |
| 3 | Interview reminder dedup writes silently denied by Firestore rules | Patients spammed with the same 24h/1h reminder on every dashboard mount | Switched dedup to per-device localStorage |
| 4 | New-model CRMC interviews never reminded | Patients got no 24h/1h reminders for the most important interview | Added parallel sweep over requests |
| 5 | agency/Allocation budget save race | Concurrent coordinator approval's committed-increment could be lost (silent money loss) | Switched to dotted-field updates so committed/disbursed are untouchable from the save path |
| 6 | admin/HospitalIDs revoke/delete non-atomic | Orphan state possible between code doc and user profile | `writeBatch` for atomicity |
| 7 | Orphan Firebase Auth user on Firestore setDoc failure | Account creation could leave a ghost auth user permanently registered | `deleteUser` rollback in both admin/Accounts + agency/Team paths |
| 8 | patient/Interviews `todayStr` used UTC, not PH local | "Today" interview mis-classified for 8 hours every PH morning | Switched to `toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })` |
| 9 | agency/ApplicationDetail `days` calc crashed on legacy data | `submittedAt.toDate()` failed if value was JS Date or ISO string | Switched to defensive `tsToDate()` |
| 10 | agency/ApplicationDetail approve path had unreachable `endorsing` branch | Dead code | Simplified |
| 11 | patient/RequestAssistance pctBill could render NaN% | `amt / amountNeeded` when amt was undefined | Guarded with `Number(amt) \|\| 0` |
| 12 | agency/ApplicationDetail patientDocs frozen at one-shot fetch | Patient's awaiting-info re-uploads invisible to agency without refresh | Switched to onSnapshot |
| 13 | agency/Inbox `days >= N` treated null as fresh | Apps with no submittedAt silently classified gray | Explicit null branch |
| 14 | admin/Requests funding-column reads stale `r.amountCommitted` | List could show out-of-date funding figures vs detail view | Use slice-derived `computeFunding()` everywhere |
| 15 | admin/Requests allSlices listener loaded entire collection | Scales linearly with system age | Scoped query to active statuses + rejected |
| 16 | admin/Requests endorsement wrote dead `sliceStages()` | 6-stage scaffold written to slice docs but Timeline now derived from status | Dropped writes; deleted helper |
| 17 | `isGLExpired` duplicated in agency/Inbox + agency/ApplicationDetail | Threshold/boundary drift risk between two surfaces showing the same GL state | Consolidated to `utils/constants` so the canonical answer is shared |
| 18 | GL state surfaced "Expired (action needed)" only AFTER lapse | Coordinator triage window already closed; committed budget had to be released instead of redeemed | Added `isGLExpiringSoon` + `glDaysRemaining`; pre-expiry amber chip on Inbox + ApplicationDetail header + urgency hint copy on the action banner |
| 19 | `tsToDate` defensive Firestore Timestamp converter inlined as `ts.toDate ? ts.toDate() : new Date(ts)` across the codebase | Same one-line helper drift-prone across 26 files; any future change to timestamp handling would need 26 simultaneous edits | Extracted to `utils/dates.js` (commit `d01a910`, 6 files); sweep finished across the remaining 20 sites over commits `91e7350`, `fc1c847`, `4ba96c0`, `3b1e398`, `46a1196`. The inline pattern now exists in exactly one place — the helper's own definition |
| 20 | admin/HospitalIDs had no print view despite codes being issued in person | Medical Social Services had to hand-copy each code to issue physically; didn't scale past a handful | Added "Print Available" — 4-up A4 cards with dashed cut lines, derived registration URL, audit-logged issuance |
| 21 | Demo accounts on the Seed page couldn't be repaired after deletion | admin/Accounts (and admin/Patients) Delete only removed the Firestore profile; the Auth account stayed orphaned and Seed printed "Already exists" + skipped, so the email was permanently broken | Self-healing Seed: on `auth/email-already-in-use`, sign in with the demo password, check whether the Firestore profile exists, recreate it if not; failed sign-in (wrong password) surfaces a clear "delete from Firebase Console" message |
| 22 | patient/MedicalPrograms agency-list sort crashed on a null `name` | One corrupt agency doc blanked the entire Find Programs page (`.localeCompare` on `undefined` throws) | `(a.name ?? '').localeCompare(b.name ?? '')` |
| 23 | Notifications select-all toggled `notifications.length` but the displayed checkbox state used `filtered.length` | Under an active category filter, clicking select-all selected EVERY notification across all categories — then immediately un-checked itself because the full selection was a superset of what's visible. Confusing | Scoped selectAll to `filtered.length` + `filtered.map(n => n.id)` so what gets selected matches what's on screen |
| 24 | patient/Guide statuses section described the legacy direct-to-agency lifecycle (pending/reviewing/interview/...) | Patient read the Guide, opened TrackStatus, saw a 6-stage request stepper they were never told about. Content drift since the redesign | Rewrote: (a) NEW "What is co-funding?" section, (b) NEW "What is the Household Intake Wizard?" section, (c) NEW request-lifecycle section covering the 6 request stages, (d) restructured the existing statuses section as the per-agency slice journey (endorsed → reviewing → awaiting_info → approved → certificate). Also added a search box across the Guide. Bilingual EN + FIL throughout |
| 25 | agency/GLViewer wrote to deprecated `applications.stages[]` field on Mark-as-Issued | Each issuance silently wrote a stale 6-stage scaffold to the slice doc. Harmless to readers (Timeline derives from `status` directly post-redesign), but polluted the data model and would have confused future migrations | Dropped the `stages:` field from the updateDoc call |
| 26 | agency/CertificateGenerator read `app.stages` to look up approvedStage.date | Always `undefined` under the redesign — fallback to `formatDate(app.approvedAt)` always won, so functionally OK but the lookup was dead code. Found alongside #25 in the same audit batch | Removed the lookup; now reads `app.approvedAt` directly |
| 27 | agency/Logs + admin/Patients sort used `.seconds` accessor | Only present on Firestore Timestamp objects. Legacy data stored as JS Date or ISO string fell back to 0 and clustered at the top of the sort, breaking chronological order | Switched both to `tsToDate(b.submittedAt)?.getTime() ?? 0` (the defensive helper from utils/dates) |
| 28 | Thesis §6.2 auditLog schema listed field names that don't exist | Doc said `actor`, `actorUid`, `at`; actual writer in utils/auditLog uses `actorName`, `actorId`, `createdAt`. All three readers agreed with the writer; only the doc was wrong | Realigned the schema diagram + the §7.3 "broad-write surfaces" paragraph that referenced `actorUid` in a proposed rule tightening |
| 29 | admin/AddAgency: agency created BEFORE admin Auth, sign-out BEFORE setDoc | Two compound bugs: (a) if admin's createUserWithEmailAndPassword failed (e.g., email-already-in-use), the agency was already in Firestore with no admin able to log in; (b) sign-out happened before setDoc, so a setDoc failure couldn't roll back via deleteUser. Both produced unrecoverable orphan state | Reordered: create admin Auth + Firestore profile first (with deleteUser rollback if setDoc fails), THEN create the agency doc with deleteDocSafe rollback on the admin profile if agency creation fails. Atomic-feeling outcome — either both succeed or neither does (modulo the rare step-2-failure Auth orphan, which is logged for manual cleanup) |
| 30 | admin/Reports rendered a "Budget Request quick-facts callout" panel that was unreachable | The useEffect filtered Budget Requests out at the loader, so no Budget Request ever made it to the per-card render — but ~12 lines of UI tried to render their quick-facts anyway | Removed the dead branch |
| 31 | admin/Accounts + admin/Patients + admin/AgencyDetail Delete modals never explained the orphan-Auth constraint | Operator clicked Delete, the Firestore profile vanished, but the email stayed registered with Firebase Auth. Recreating an account with the same email then hit "already in use" with no warning of why | Added an explicit warning to all three Delete confirm modals: "The Firebase Auth account can't be deleted from the browser — the email stays registered until you also remove it from Firebase Console → Authentication." Proper fix (Cloud Function with admin SDK) is blocked by Spark plan |

#### 11.4a — Audit Round 2 (R1–R29, live-session driven, 2026-06-02 → 2026-06-04)

A second pass driven by real live-session demos against `localhost:5173`. Each finding was triaged in conversation with the operator (UX dead-ends caught visually, data-cascade gaps caught during real patient → CRMC → agency walkthroughs) then fixed with a "before / why this is wrong / how it now behaves" commit body. 29 findings total; 17 in §B.23 of the revision list.

| # | Bug | Impact | Fix | Commit |
|---|-----|--------|-----|--------|
| R1 | AuthContext didn't check `deletion: true` flag on login | Soft-deleted patients could still sign in | Added deletion gate that signs the user out and throws a clear "account marked for deletion" error | `aa8e793` |
| R2 | `computeFunding` counted expired GLs as committed | Parent request showed slices as "secured" after the GL had been auto-released back to the agency budget | `isCommittedSlice` helper excludes `glStatus === 'expired'` certificates | `aa8e793` |
| R3 | Parent request `amountCommitted` + `status` went stale on slice transitions | Coordination board showed wrong funding totals after expiry / reversal | `deriveRequestFinancials` + `runTransaction` re-sync on every release path | `aa8e793` |
| R4 | Slice rejection didn't re-derive parent request status | admin/Requests kept showing "Endorsing" forever even though no agency was processing | `runTransaction` re-derives parent after every reject | `703cfa6` |
| R5 | agency/SlotManagement `handleAdd` / `handleDeduct` / `handleSaveTotal` raced concurrent writes | Daily slot counter could drift on simultaneous coordinator actions | All three wrapped in `runTransaction` | `703cfa6` |
| R6 | `dataExport.js` failed wholesale on any single-section error | Patient's RA 10173 §16(f) export aborted entirely if one collection read denied | `Promise.allSettled`, per-section try/catch, top-level `errors[]` in the JSON output | `76ba87b` |
| R7 | `getOrCreateConversation` rejected `roles: undefined` | Messages send threw a Firestore "undefined field" error masked behind generic toast | Defaults injected; React Router v7 future flags enabled simultaneously | `b7ceeaf` |
| R8 | Endorsement rolled back entirely when ONE attached document had been deleted | Failed for the whole referral if any single `documentId` in `attachedDocuments` was stale; no slices created, no slot decremented | Moved per-doc `agencyIds` stamping OUT of the transaction; best-effort post-step with per-doc try/catch for `not-found` | `b01d303` |
| R9 | Agency couldn't read patient documents via the rule analyzer's path | "Missing or insufficient permissions" when opening any endorsed slice | Two-part fix: query narrowed via `array-contains` + `firestore.rules` `documents.read` split into three separate `allow read` clauses so the rule analyzer can prove subset alignment | `9d0644b` + `bb3bcef` |
| R10 | `/api/send-email` route 404 in dev | Console noise on every notify call during local development | Dev-only skip in `notifications.js` (no real email infrastructure in dev) | `9d0644b` |
| R11 | patient Dashboard step 5 had no clickable path | "Receive your Guarantee Letter" tile looked clickable but did nothing | Set `path: '/patient/status'` | `014bb6b` |
| R12 | TrackStatus showed empty space when GL issued but signed scan pending | Patient saw "Guarantee Letter Issued" status but no Download button; confusing | Amber "Awaiting signed scan from agency" pill fills the slot until `certificateUploaded` | `fee18a3` |
| R13 | EndorseModal didn't warn when attached docs had been deleted | CRMC referred a request to agencies who saw no documents to verify | Pre-endorse `getDoc()` check; amber/red banner lists missing docs by name; non-blocking (informs CRMC's call) | `f42ec44` |
| R14 | Patient TrackStatus stepper rows had no tap affordance | Patient on `assessment` stage couldn't jump to interview details from status page | Active "Assessment & Interview" and "Endorsed to Agencies" rows become tap targets with CTA + chevron | `a971431` |
| R15 | Allocation Amount input rendered leading "0" | Typing "10000" became "010000"; placeholder "e.g. 500000" never showed | State held as string, init to `""`, onChange strips leading zeros from pastes | `ef9077f` |
| R16 | "Confirm & Proceed" banner navigated to /patient/request | Patient hit Step 1 of the new-request wizard instead of confirming their endorsed slice | Inline `handleSliceProceed` flips slice `endorsed → reviewing` + notifies agency; no navigation | `ed9fdc4` |
| R17 | Active GLs filed under "Past Applications" tab | Patient came to grab their downloadable GL and found it categorized as past | `isSliceTerminal` predicate: `certificate` is terminal only when `glStatus` is `redeemed`/`expired` or `isGLExpired(app)` | `a149d08` |
| R18 | Dashboard `activeApp` filter matched any non-rejected slice | Status card said "Your application is in progress" for slices redeemed weeks ago | Reuse `isSliceTerminal` from R17; hoisted to `utils/requests.js` as single source of truth | `c75e733` |
| R19 | Dashboard `endorsed`/`reviewing`/`awaiting_info` CTAs routed to /patient/request | Same dead-end as R16 from the Dashboard side | All three redirected to `/patient/status` where the R16 inline handler lives | `c75e733` |
| R20 | `handleDeleteAccount` cascade missed requests, conversations, certificates | RA 10173 §16(e) right-to-erasure incomplete — orphan parent request + conversation threads kept patient PII visible | All six patient-keyed collections fetched in parallel; per-conversation message subcollection batch-delete; `catch (err)` instead of silent `catch {}` | `0032d96` |
| R21 | Messages `handleSend` had no try/catch | A failed send locked the button forever (`setSending(false)` never ran); user had to refresh | try/catch/finally; toast on error; typed text preserved so user can retry without losing draft | `a6b2998` |
| R22 | `admin/AuditLog ACTION_CONFIG` missing 9 actions logged in code | `request_endorsed`, `gl_redeemed`, etc. rendered with raw action key + unstyled badge | All 9 added with matching label + badge color + new "Lifecycle" category in the filter row | `0032d96` |
| R23 | Failed thread load looked identical to empty conversation | Snapshot error → `messages=[]` → "No messages yet" empty state; user had no clue load failed | Separate `loadError` state + red error panel ("Couldn't load this thread") | `a6b2998` |
| R24 | admin/Accounts setDoc omitted `deletion: false` / `cooldown: 0` | Future queries like `where('deletion', '==', false)` would silently miss these docs (Firestore can't match a missing field via equality) | Both fields stamped on creation, matching every other creation path | `0032d96` |
| R25 | patient/More handleLogout fired signOut without awaiting | Navigate ran before auth-state cleared; fast back/forward could briefly show authenticated content | Async with try/catch; `await logout()` before navigate | `5d35c0a` |
| R26 | Partial document-upload failure collapsed to generic "submission failed" toast | Patient had no idea which upload broke (network drop on doc 3 of 5 indistinguishable from rules denial on doc 1) | Per-doc try/catch rethrows `UPLOAD_FAILED:<typeName>` sentinel; outer catch decodes and names the doc | `5d35c0a` |
| R27 | Messages read-receipt updateDoc had `.catch(() => {})` | Rules denials and network blips silently swallowed; no production diagnostics | Bumped to `console.warn` so the failure is visible without alarming the user | `a6b2998` |
| R28 | GLViewer redirected to /agency/inbox on transient missing-doc states | Firestore offline replay / brief permission flicker yanked agency out of an open GL viewer mid-session | `firstLoad` ref: only the FIRST missing snapshot triggers redirect; subsequent misses log a warning and keep last state on screen | `5d35c0a` |
| R29 | patient Messages was mobile-card + modal on every viewport | Wide desktop wasted 60%+ of screen; agency/admin already had two-panel split | Responsive layout: `<md` keeps the mobile card + modal; `md+` renders 320 px left list + inline `ConversationThread` on the right (reuses existing component). Drive-by R21/R23/R27 echoes patched in `ConversationThread` since it had the same bugs | `986396b` |

#### 11.4b — Demo-Account Maintenance Trio (R30, 2026-06-05)

A live-session login test exposed that demo accounts had drifted from canonical state — `admin@crmc.gov.ph` signed in but landed on /patient/dashboard (Firestore profile said `role: 'patient'`). `bootstrap-users.js` is idempotent by design (leaves existing Auth + Firestore alone) so it can't recover from drift. Three scripts shipped to close the gap.

| # | Item | Resolution | Commit |
|---|------|------------|--------|
| R30a | Extract canonical `USERS` array to shared module | `scripts/demo-accounts.js` becomes the single source of truth for the 11 demo accounts. `scripts/bootstrap-users.js` refactored to import from it — same data, same behavior. Adding a new demo account now needs one edit | `6a41039` |
| R30b | `scripts/check-demo-accounts.js` — read-only health diagnostic | Uses Web SDK + `.env`, runs without service-account.json. Verdict per account: ✅ OK / ⚠️ WRONG_ROLE / 🔑 BAD_PASSWORD / 🕳️ NO_PROFILE / 🛑 MARKED_FOR_DELETION / ⚠️ ON_HOLDING_PERIOD. First run flagged 7 of 11 demo accounts drifted | `a2641b9` |
| R30c | `scripts/repair-demo-accounts.js` — force-restore via Admin SDK | Creates missing Auth users, force-resets passwords, writes Firestore profiles via `ref.set(canonical, { merge: true })` so extras (patient address etc.) survive. `--dry-run` mode prints per-field diff. Idempotent | `6a41039` + `a5cfa57` (merge fix) |
| R30d | `.gitignore` patterns for `service-account*.json` | Blanket coverage: `service-account.json`, `service-account-*.json`, `*-service-account.json`, `firebase-adminsdk-*.json`. A service-account.json grants full read/write to every Firestore document; must never be committed | `a2641b9` |
| R30e (diagnostic) | Spark plan 20K writes/day quota presents as silent gRPC hang in Admin SDK | Three layers of isolation tests narrowed the cause: `auth.updateUser()` works → Auth fine; `db.doc().get()` works → reads fine; `db.doc().set()` to a fresh `_diagnostic/` collection hangs → not doc-specific. Direct **Firestore REST API** call surfaced the real error in 614 ms: `429 RESOURCE_EXHAUSTED — Quota exceeded`. Three rapid REST writes all returned 429 instantly → daily quota, not burst. The Admin SDK swallows 429s into infinite gRPC retries (by design, operationally indistinguishable from a network hang). Resets at midnight Pacific Time | (diagnostic) |
| R30f | Documented playbook: "what to do when writes hang silently" | Try the Firestore REST API directly with the service-account credential. If 429 RESOURCE_EXHAUSTED: you're over quota, wait for reset (or upgrade to Blaze). If REST hangs too: it's actually a network-layer issue (firewall, proxy, gRPC interference). Saves hours of chasing the wrong cause | (documented in §B.24 of revision-list + §11.5 below) |

End-state: maintenance tooling permanent. Pre-defense run is `check-demo-accounts.js` (5 s) → if anything drifted, `repair-demo-accounts.js` (30 s after quota reset). Replaces what would otherwise be ~15 minutes of Firebase Console clicking per drifted account.

#### 11.4c — Post-Quota Recovery Push (Operational Tooling + Agency UX, 2026-06-06 late)

After the daily write quota reset and the demo accounts were repaired to ✅ 11/11, the rest of the day shifted to closing the operational gaps the audit had surfaced. Six commits landed in one push window covering reference-data seeding, agency logo support, full-database backup, defense-demo scenario prep, a sidebar discoverability fix (R31), and BARMM-aware location dropdowns (R32).

| # | Item | Resolution | Commit |
|---|------|------------|--------|
| 25.1 | `scripts/bootstrap-reference-data.js` admin-SDK seeder | Companion to `bootstrap-users.js`. Seeds 4 agencies + 8 documentTypes + 8 assistanceTypes + 20 hospitalIds with `setDoc({merge:true})`; idempotent. Per-agency budget initialised to zero so allocation pages don't render NaN. Replaces the old `/seed` web page's reference-data portion, which required super_admin login + `VITE_ENABLE_SEED=true` and didn't work during the same-day recovery (chicken-and-egg: no admin could log in until users were repaired). Verified live: 40 writes, all 4 agencies present | `04de563` |
| 25.2 | Optional `logoUrl` per agency, fallback to colored initials | New `<AgencyAvatar />` component with onError swap (image if URL set and loads, fallback to colored initials otherwise). Logo URL input on the agency edit modal with HTTPS-only validation (Cloud Storage upload blocked by Spark plan; external HTTPS URLs are the only path today). `bootstrap-reference-data.js` carries `logoUrl: null` per seed agency; agency_admins paste their URL via `/admin/agencies` edit | `a8ddb6a` |
| 25.3 | `scripts/export-firestore.js` full-database backup | Walks every top-level collection (16 of them) + 2 known subcollection paths (`notifications/{uid}/items`, `conversations/{id}/messages`), writes JSON files under `./backups/{ISO-timestamp}/`. Timestamps normalised to ISO-8601. Spark plan has no auto-backup; this is the operator's only rollback before any destructive op. Verified live: 19,538 docs in 142.8 s. `.gitignore` updated to exclude `backups/` so PII never reaches the repo | `3a81913` |
| 25.4 | `scripts/seed-demo-scenario.js` defense-walkthrough scenario | One request from `patient@gmail.com` for ₱25,000 (Hospital Bills) describing a pneumonia case at CRMC ICU, three attached documents in 'pending' state with placeholder text-as-base64 content. Strictly additive (won't touch existing data). `--dry-run` mode + prints walkthrough hints. Pre-defense workflow: run 1-2 hours before the panel; fresh `submittedAt` timestamps; demonstrator drives the panel through verify → intake → interview → endorse → approve → GL issued live | `3a81913` |
| 25.5 | `<AgencyAvatar />` sweep across 8 primary surfaces | Component was only adopted on `admin/Agencies` initially. This batch swapped inline `${agency.color}`+initials at 7 other sites where the full agency object is in scope: `patient/MedicalPrograms` (mobile+desktop), `auth/Landing`, `admin/AgencyDetail`, `admin/AddAgency` form preview, `agency/Dashboard`, `agency/Program` (preview+header). Slice-derived avatar sites (slice cards, EndorseModal rows, etc.) still render from denormalised `agencyColor`/`agencyInitials` on the slice doc; adding logo support there needs a runtime lookup or denormalisation, deferred | `3a81913` |
| R31 | Team + Audit Log missing from desktop agency sidebar | `/agency/team` was reachable only by URL or mobile bottom tabs. Desktop sidebar config (`AGENCY_NAV` in `Layout.jsx`) never listed it. Same situation for `/agency/audit`. Both routes/pages/rules worked; only sidebar discovery was broken. Added both entries with `adminOnly: true` so regular agency coordinators don't see them. Sixteen-line fix | `8ea2882` |
| R32 | BARMM cascading dropdowns for agency location | Free-text Location field replaced with the same BARMM Province → City/Municipality cascading dropdowns the patient registration form uses, plus an optional Office / Building Name free-text field. Save still writes a derived `location` string for backward compat with every render site that reads `agency.location`. On edit of a legacy agency, structured fields start empty and the previous flat value is shown as amber helper text. Validation rejects save without province + city. Applied to BOTH `AddAgency.jsx` and the `AgencyModal` in `admin/Agencies.jsx` (the latter shared with `admin/AgencyDetail`). `bootstrap-reference-data.js` updated to seed structured fields too | `da06bbf` |

End-state of §11.4c: maintenance tooling now covers reference data, full-database backups, and demo-scenario prep alongside the demo-accounts trio. Agency UX picks up logo support, sidebar discoverability for Team management, and structured BARMM-aware locations.

#### 11.4d — Inter-Agency Coordination Plan, Phase 1 (R33–R35, 2026-06-07)

Motivated by the research question "how do real systems implement inter-agency coordination?" — surveyed NHS England Integrated Care Systems (Shared Care Records with HL7 FHIR R4), Salesforce Public Sector (Activity Timeline + Chatter), ServiceNow Public Sector Digital Services (watcher/subscriber model), Bonterra / Apricot 360 (closed-loop warm handoffs), UNHCR proGres v4 (refugee multi-partner case management), Estonia X-Road (citizen-visible audit), and Open Referral / Human Services Data Specification (open standard for human services interop). Drafted a four-phase plan: pre-defense polish (Phase 1, this batch), post-defense pilot (Phase 2), Blaze-dependent v2 (Phase 3), production / multi-hospital (Phase 4).

This subsection documents the three Phase 1 items. Phases 2–4 are listed as future work in §12.2 below.

| # | Item | Resolution | Commit |
|---|------|------------|--------|
| R33 | Case Timeline — chronological cross-agency event feed | New `<CaseTimeline />` component renders above the existing "Co-funding picture" panel on `agency/ApplicationDetail`. Sources every relevant `auditLog` entry scoped to the request via a denormalised `requestId` field. `logAudit()` gained optional `requestId` + `patientId` params; 9 existing call sites updated to pass them; 3 new audit event types added (`slice_advanced` from `updateStatus()`, `app_approved` after approve transaction, `patient_proceeded` from patient's Confirm & Proceed). `firestore.rules` `auditLog.read` extended with two clauses: any co-funding agency reads entries on requests it holds a slice in; any patient reads entries where `entry.patientId == uid()` (set up for Phase 2.3 patient-visible audit view). Pattern source: Salesforce Public Sector Activity Timeline + NHS Shared Care Records. Theoretical anchor: Bardach (1998) "frame reflection" in collaborative public management | `0744760` |
| R34 | Watcher subscriptions on requests | When CRMC endorses, every `agency_admin` + `agency` UID of the endorsed agencies is `arrayUnion`-ed into `request.watchers[]` inside the same transaction. On `app_approved` and slice rejection, notifications fan out to every watcher except the actor (and except the `endorsedById` admin, already notified). Scope deliberately limited to approve + reject events — high-signal cross-agency moments — to avoid notification noise (minor transitions stay in the Case Timeline). Pattern source: ServiceNow Public Sector watcher / subscriber model. Theoretical anchor: Klijn & Koppenjan (2016) "network awareness" — each node in a governance network sees the network's activity in real time without polling | `7607637` |
| R35 | Live over-commitment guard in ApproveModal | Soft warning card that updates as the coordinator types AND as sibling agencies independently approve. Three states: gray (partial), green (would fully fund), amber (would over-commit, with exact over-amount + suggested action). Doesn't block submit — MAPA's existing design explicitly allows controlled over-commitment (CRMC sometimes intentionally over-endorses to give the patient a buffer if any agency rejects). Reuses the already-subscribed `siblings` array; no new reads. Pattern source: industry-standard optimistic concurrency UX, with MAPA's preserved-human-judgment twist. Theoretical anchor: Bardach (1998) "collaborative craftsmanship" — the platform informs, the operator decides | `cec9960` |

End-state of §11.4d: each co-funding agency now sees (a) a chronological feed of every cross-agency event on the case, (b) real-time push notifications when siblings approve or reject, (c) a live coordination signal in the approval flow that shows the running network total. Pattern sourcing connects to four enterprise systems (NHS, Salesforce, ServiceNow, Estonia X-Road on the deferred patient-audit clause) and three threads of public-administration literature (Bardach 1998, Klijn & Koppenjan 2016, the implicit FHIR/Open Referral standards work).

Three coordination items remain on the deferred list, each pulling from a documented enterprise pattern:

- **Phase 2.1 — Structured referrals** (Bonterra warm-handoff pattern). "Suggest another agency" button on `agency/ApplicationDetail` that creates a `referralSuggestions/{id}` doc visible to CRMC; closes the bottom-up coordination loop by giving agencies a structured voice without bypassing CRMC's gateway authority. ~4-6 hours.
- **Phase 2.2 — Outcome reconciliation** (Bonterra closed-loop feedback). When CRMC re-endorses to a new agency after a rejection, the new slice carries `previousRejections[]`; the new agency sees a banner explaining sibling history. Prevents duplicated eligibility checks. ~3-4 hours.
- **Phase 2.3 — Patient-visible audit trail** (Estonia X-Road citizen-data-access log). New `/patient/access-log` page surfaces every audit entry where `entry.patientId == self`. Display: "Malasakit Center read your documents on Mar 5 14:30." Operationalises RA 10173 §16(c) right to access; rule layer already in place (R33 plumbed the denormalisation). ~3-4 hours.

Phases 3 (in-case comment threads, joint Meet scheduling, Open Referral/HSDS adapter) and 4 (multi-hospital sharding, real outcome tracking, donor analytics, PhilSys integration) are described in §12.2 Future Work.

### 11.5 Known Issues and Limitations

| Severity | Item | Status / Plan |
|----------|------|---------------|
| Low | Console.log statements in production code | Vite production config does not strip console output (`drop: ['console']` recommended) |
| Medium | Bundle size ~1.2 MB raw / ~317 KB gzipped for the shared chunk | Largely Firebase SDK; acceptable for thesis pilot |
| Low | Some icon-only buttons missing `aria-label` | Identified during audit; gradually fixed |
| Acknowledged | Email notifications require Vercel env vars (SMTP_USER, SMTP_PASS, SMTP_FROM) to be set in the deployment | One-time setup; documented in DEPLOY.md |
| Acknowledged | Signed GL PDF upload capped at ~700 KB raw (Firestore 1 MiB document limit, base64 expansion) | Documented; full Firebase Storage migration is the production path (currently blocked by Firebase Spark plan constraints on post-Oct-2024 projects) |
| Acknowledged | No automated tests | Outside scope; manual testing + read-pass review series on every change |
| Acknowledged | GL_STATUS_CONFIG not yet extracted | Two render sites use different visual treatments (badge vs text); would need a label-only helper rather than a full canonical config. Documented; not blocking |
| Acknowledged | Keyboard shortcuts on admin/Requests (V to verify focused doc, J/K to navigate queue) | Bulk-verify shipped 2026-05-31. Keyboard shortcuts deferred — useful for high-volume CRMC days but design call needed on focus model and shortcut conflict with browser shortcuts |
| Acknowledged | Four `firestore.rules` branches grant broader writes than the UI exercises (`agencies` update for any agency role, `applications` update for own agency, `auditLog` create with no actor-must-match check, `conversations` create open to any authenticated user) | Comments in `firestore.rules` document each as an intentional deferral; UI is the gate today | See §7.3 "Known broad-write surfaces" for the per-surface tightening path. Each could be closed with a small rule addition once the UI gating is fully audited; deferred to post-pilot |
| Acknowledged | Account deletion in admin/Accounts, admin/Patients, admin/AgencyDetail removes only the Firestore profile — the Firebase Auth account stays orphaned | Client-side Firebase can't delete an Auth account without "recent sign-in" or admin SDK. The 2026-06-02 audit added explicit warnings to all three Delete confirm modals so operators know to also remove the email from Firebase Console → Authentication | Proper fix is a Cloud Function with admin SDK `deleteUser`; blocked by Spark plan per the Email Delivery section. Warning-text mitigation shipped (bug #31) |
| Acknowledged | admin/AppLogs search and filter only apply to the loaded page (PAGE_SIZE = 100) | An operator searching for an old application has to click Load More repeatedly to bring it into the in-memory window before the filter can find it | Server-side query rewrite needed; deferred — non-blocking for pilot volume |
| Acknowledged | admin/AddAgency Auth-account leakage on the rare step-2 failure | When the agency-doc creation fails AFTER the admin Auth + profile already succeeded, the rollback can clear the Firestore profile but can't `deleteUser` (signed out of the secondary auth session by then). The orphan email must be removed from Firebase Console manually. Logged loudly | Same Cloud Function path as #31 would close this; deferred |
| Acknowledged | **Spark plan 20K writes/day Firestore quota** presents as a silent gRPC hang in the Admin SDK | Heavy dev + test activity in a single 24-hour window can exhaust the daily allowance. Once exhausted, every Firestore write across the project (patient registrations, admin edits, notification fan-outs, even quota-recovery scripts) returns `429 RESOURCE_EXHAUSTED`. The Admin SDK swallows the 429 into infinite silent gRPC retries; the Web SDK queues writes locally. Operationally **indistinguishable from a network firewall hang** until the operator either reads §B.24 of the revision list or runs the documented REST API diagnostic. Reset is at midnight Pacific Time | Diagnosis playbook in §B.24 + §12.1 below. Mitigation: stagger high-write activity across days. Permanent fix: Blaze plan upgrade removes the cap |

### 11.6 Performance Observations

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

2. **No Firebase Cloud Functions.** Email delivery uses a Vercel serverless route as a workaround. The scheduled daily slot reset has a Cloud Function ready (gated on Blaze) but currently relies on a belt-and-suspenders lazy reset on the CRMC Requests page on first visit of the day. If Blaze plan is acquired, migration to Firebase Cloud Functions (and the official Trigger Email from Firestore extension) would simplify ops.

3. **No automated tests.** Manual testing + the read-pass review series is sufficient for thesis pilot but should be supplemented by Cypress (E2E) and Vitest (unit) before production. The read-pass series caught 16 real correctness bugs that an automated suite would have caught earlier.

4. **Single-pilot scope.** The system is hardcoded for one hospital (CRMC). A multi-hospital deployment would require restructuring the `users.hospitalId` namespace, the Patient Access Code format, and adding a `hospitals` collection.

5. **No SMS notification fallback.** Patients without consistent email access miss notifications. SMS via a service like Twilio would close this gap (cost-prohibitive for thesis pilot per CLAUDE.md).

6. **Document storage in Firestore.** Documents and signed GL scans are stored as base64 in Firestore. This is convenient but inefficient at scale; the base64 expansion caps PDF GL scans at ~700 KB raw. Migration to Firebase Storage with signed URLs is the recommended long-term path, blocked currently by Spark-plan restrictions on Storage for post-Oct-2024 projects.

7. **Mobile experience is responsive-web, not a native app.** A separate React Native or Flutter mobile app is planned (sharing the same Firebase backend) as the primary patient experience. The current PWA serves the responsive-web fallback.

8. **Interview reminder is best-effort, client-side.** The 24h + 1h reminders fire only when the patient opens the dashboard. A scheduled push (Firebase Cloud Messaging on Blaze) would deliver reliably regardless of patient device state.

9. **Cooldown system is per-Hospital-ID + per-application.** It survives account churn (delete-and-re-register) but doesn't catch a determined attacker creating multiple Hospital IDs. The intended mitigation is operational (CRMC issues codes in person after social-work intake).

10. **Spark plan write quota silently degrades under sustained load.** Firestore Spark caps the project at 20,000 document writes per day. The Firebase Admin SDK turns `429 RESOURCE_EXHAUSTED` into infinite silent gRPC retries — writes hang forever with no error, no toast, no diagnostic in the operator's terminal. The Web SDK queues writes locally with no user-facing feedback. The pattern is **operationally indistinguishable from a network firewall hang**, which can cost hours of debugging on the wrong cause. The §B.24 playbook (call the Firestore REST API directly; if you get 429, you're over quota) lets the operator confirm or rule out a quota issue in under a minute. Reset is at midnight Pacific Time. The permanent fix is Blaze plan upgrade (removes the daily cap); the operational mitigation is to stagger high-write activity across days during the pilot.

### 12.2 Future Work

- **PhilSys integration.** Once a public API is available, the manual social-worker ID verification could be supplemented by a national-ID check (currently OCR-assisted, social-worker-confirmed per CLAUDE.md).

- **Push notifications via Firebase Cloud Messaging.** Free, supports both web and native, would deliver real-time updates without email-spam risk and would make interview reminders reliable.

- **Integration with IHOMIS hospital system.** Real-time billing data exchange would close the loop on GL redemption (currently manually marked by the coordinator after the provider bills back).

- **Donor portal.** A public-facing dashboard showing aggregate assistance disbursed could enable corporate / private donor matching.

- **Multi-language expansion.** Adding Maguindanaon and Iranun would cover more of the BARMM constituent base.

- **Offline-first patient applications.** Currently the app shell loads offline but writes require connectivity. Firestore's local persistence layer would allow patients on intermittent 4G to draft requests offline.

- **Cross-hospital network.** Adapting the schema to support multiple partner hospitals (BARMM-wide, eventually nationwide) is the largest architectural change but unlocks the most impact.

- **Keyboard shortcuts on admin/Requests.** Bulk-verify shipped 2026-05-31 (Verify all pending — single-batch `writeBatch`). The remaining throughput lever is keyboard shortcuts (V to verify focused doc, J/K to navigate the doc queue) for high-volume CRMC days. Design call needed on focus model and conflict avoidance with browser shortcuts.

- **GL_STATUS_CONFIG consolidation.** The agency/ApplicationDetail GL status pill and the agency/Inbox text indicator use different visual treatments. Extracting a shared label helper (keeping the visual treatments per-context) would centralize the "expired vs issued" decision currently duplicated.

- **Live `allSlices` query bound.** admin/Requests' cross-slice coverage warnings currently load every slice in the system (scoped to active + rejected statuses). At larger scale, denormalizing a `coverageStatus` field onto the parent request would unbind this listener entirely.

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **Application** (a.k.a. Slice) | A per-agency funding slice of a request. Under the CRMC-gateway model, applications are created by CRMC at endorsement, one per selected agency, as children of the parent request. Each agency makes its own funding decision on its slice. |
| **Application Lifecycle (Slice)** | endorsed → reviewing (post-Proceed) → (awaiting_info ↔ reviewing) → approved → certificate (or rejected at any point). |
| **Assistance Type** | A category of help the system supports (Hospital Bills, Medicines, Chemotherapy, Laboratory Tests, Surgery, Emergency Medical Assistance, Burial Assistance, etc.), defined by CRMC admin. |
| **Case Assessment** | The structured Unified Intake Sheet completed jointly by the patient (factual portion, via guided wizard) and the CRMC social worker (assessment portion, during the interview). Digitally equivalent to CRMC's paper "Unified Intake Sheet + Social Case Study". |
| **Co-funding Model** | The CRMC-gateway approach: one patient request → CRMC verifies + endorses → multiple agencies fund the bill in parallel as slices, each issuing its own GL. The patient sees a unified coverage plan instead of running parallel applications. |
| **Committed Budget** | The total of approved-but-not-yet-redeemed GL amounts; subtracted from an agency's allocation when computing remaining budget. Owned by the approve / redeem / reverse code paths only — never written by the Allocation save. |
| **Cooldown** | A 30-day window after a successful approval during which a patient cannot be re-approved by any agency, with an explicit exception for sibling slices of the same co-funding request. Stored both on the application (per-app) and on the Hospital ID (cross-agency, survives account churn). |
| **Coverage Plan** | The set of agencies CRMC endorsed the patient's request to, plus each agency's procedure and requirements, shown on the patient's TrackStatus + Request Assistance views. The patient confirms via Proceed to advance each slice into agency review. |
| **Disbursed Budget** | The total of GL amounts the agency has finalized (Redeemed). |
| **Endorsement** | CRMC's act of routing a verified, assessed request to one or more partner agencies for funding. Pure-selection: CRMC picks WHO, not HOW MUCH; each agency decides its own amount. |
| **Endorsable Headroom** | `amountNeeded − committed − outstanding`. The peso amount CRMC may still endorse without breaching the bill cap; surfaced on the EndorseModal funding summary. |
| **Funding Review** | The agency-side lifecycle phase from `endorsed → reviewing` (after the patient hits Proceed) until the agency approves or rejects. Visible to coordinators as the "For Funding" status. |
| **Guarantee Letter (GL)** | The official document issued to an approved patient, stating the guaranteed amount, purpose, and provider that will be billed. Valid for 30 days. Each approving agency issues its own GL for its committed slice. |
| **GL Status** | Issued / Redeemed / Expired. Tracks the lifecycle of an issued GL. |
| **GL Pre-Expiry Triage Window** | The 3-day window before a GL's 30-day validity lapses (`GL_EXPIRING_SOON_DAYS` in `utils/constants`). Surfaces on the agency Inbox + ApplicationDetail as an amber "⚠ GL expires in Nd" chip + urgency hint copy so coordinators can nudge the patient to redeem before the committed budget has to be released. Distinct from the patient TrackStatus warning, which uses a wider 7-day window to give patients more planning runway. |
| **`glDaysRemaining`** | Helper in `utils/constants` returning days left in a GL's validity window (positive while valid, negative once expired, null when not applicable). Drives the "expires in Nd" copy across surfaces. |
| **Hospital ID** | CRMC's Patient Access Code, format `CRMC-YYYY-NNNNN`. Issued offline by CRMC Medical Social Services. Also the anchor for cross-account cooldown (survives delete-and-re-register). |
| **In-Flight Request** | A request not yet in a terminal state (i.e., not `fully_funded`, `closed`, or `rejected`). |
| **In-Flight Slice** | A slice not yet in a terminal state (not `approved`-and-paid, `certificate`-and-redeemed, or `rejected`). |
| **Means-Test Category** | The social worker's classification of the patient's financial situation: Indigent / Marginalized / Low Income / Above Threshold. Recorded on the Unified Intake Sheet. |
| **Per-Applicant Cap** | Agency-set ceiling on how much a single case may receive (PCSO ₱25K, DSWD tier limits, etc.). CRMC sees a soft warning at endorsement; the agency's Approve modal hard-blocks any approval above this cap. |
| **Proceed Gate** | The patient action that accepts the coverage plan and advances every endorsed slice from `endorsed` to `reviewing` in a single atomic writeBatch. Until the patient Proceeds, agencies see nothing in their inbox. |
| **PWA** | Progressive Web Application — a web app installable to the device home screen with offline shell and app-like UX. |
| **Representative (filed-by)** | A relative filing on the patient's behalf. The representative supplies their own ID + live selfie + relationship + authorization. The patient remains the primary account holder. |
| **Request** | The patient's single co-funding request stating the bill amount, assistance type, and uploaded documents. Created by the patient via the 4-step wizard. CRMC's primary unit of work. |
| **Request Lifecycle** | submitted → under_review → assessment → endorsed → partially_funded → fully_funded (or closed / rejected). Visualized as a 6-stage stepper on patient TrackStatus. |
| **Reviewer Trail** | The "verified by X · Mar 5" / "rejected by X · Mar 5" line shown inline on each document row in the CRMC Requests workspace. Sourced from `documents.reviewedBy` + `reviewedAt`. |
| **Slice** | See Application. A per-agency funding child of a request. |
| **Slot** | A daily-capped count of new endorsements an agency can receive per day. Decremented at CRMC endorsement (not patient submission, since the patient submits to CRMC, not to agencies). Reset at PH-local midnight. |
| **Stage** | A milestone in a request's or slice's lifecycle, rendered as a step in the progress timeline. Slice stepper has 4 stages under the new model (Endorsed → Funding Review → Approved → GL Issued); legacy direct apps retain the 6-stage view. |
| **Withdrawal** | Patient-initiated request close. Offered only in pre-endorsement states (`submitted`, `under_review`, `assessment`) with no slices yet. Once CRMC endorses, the patient must instead reach out via Messages. |

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

These are visible in the Login page's development quick-access panel and are managed by a suite of admin-SDK scripts. The three demo-account scripts share `scripts/demo-accounts.js` as a single source of truth.

**Demo-account maintenance (three-script trio + shared module):**

| Script | Purpose | Needs service-account.json? |
|--------|---------|-----------------------------|
| `scripts/bootstrap-users.js` | First-time creation. Idempotent: if Auth exists it's left alone; if Firestore profile exists it's left alone. The right tool for a fresh project. | Yes |
| `scripts/check-demo-accounts.js` | Read-only health diagnostic. For each account: tries the canonical sign-in, reads `users/{uid}`, reports ✅ OK / ⚠️ WRONG_ROLE / 🔑 BAD_PASSWORD / 🕳️ NO_PROFILE / 🛑 MARKED_FOR_DELETION. Recommended as a pre-defense smoke test. | No (uses Web SDK + `.env`) |
| `scripts/repair-demo-accounts.js` | Force-restore. Creates missing Auth users, force-resets drifted passwords, merges canonical fields into Firestore profiles with `{ merge: true }` so accumulated test data (patient address, photoURL, etc.) survives. `--dry-run` mode prints per-field diff. | Yes |

**Reference-data + demo-scenario + backup (added §B.25, 2026-06-06):**

| Script | Purpose | Needs service-account.json? |
|--------|---------|-----------------------------|
| `scripts/bootstrap-reference-data.js` | Seeds the four non-user reference collections: 4 agencies + 8 documentTypes + 8 assistanceTypes + 20 hospitalIds. All writes use `{merge:true}` so re-running is a no-op. Per-agency budget initialised to zero. Replaces the user-creation portion of the old `/seed` web page. Verified live: 40 writes, all 4 agencies present. | Yes |
| `scripts/seed-demo-scenario.js` | Creates one fresh in-flight assistance request for `patient@gmail.com` (₱25,000, Hospital Bills, three pending documents). Strictly additive. `--dry-run` mode + walkthrough hints on completion. Pre-defense pre-prep so the panel sees the system in motion, not empty. | Yes |
| `scripts/export-firestore.js` | Full-database backup. Walks every top-level collection + 2 subcollection paths, writes JSON files under `./backups/{ISO-timestamp}/`. Spark plan has no auto-backup; this is the only rollback before destructive operations. Verified live: 19,538 docs in 142.8 s. `backups/` is gitignored. | Yes |

Pre-defense recommended workflow:

```bash
# Step 1 — Health check (5 seconds, no credentials)
node scripts/check-demo-accounts.js

# Step 2 — If drifted, repair (after midnight Pacific if Spark plan quota is hit)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/repair-demo-accounts.js --dry-run    # preview
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/repair-demo-accounts.js              # apply

# Step 3 — Safety net snapshot (5 minutes; produces ~60 MB of JSON)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/export-firestore.js

# Step 4 — Pre-prep the defense scenario (≤30 seconds)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/seed-demo-scenario.js

# Step 5 — Final verify
node scripts/check-demo-accounts.js
```

Approximate total time: 5–10 minutes from a fresh-laptop start to defense-ready state.

The legacy `/seed` route still exists (gated by `VITE_ENABLE_SEED=true`) but its user-creation portion was moved out to `scripts/bootstrap-users.js` per the 2026-06-01 tightening of `users/create` rule. After §B.25, the reference-data portion is also superseded by `scripts/bootstrap-reference-data.js`, which uses the Admin SDK and bypasses the rule layer entirely. The `/seed` page remains as a fallback but is no longer the primary recovery path.

---

*End of MAPA thesis documentation. Prepared for the thesis manuscript. Total system scope: ~38 pages across 5 roles, single React + Firebase codebase deployed via Vercel, PWA-installable for patient mobile use.*