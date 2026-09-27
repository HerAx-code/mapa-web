# 01 — Current-state inventory (as-built)

*Every route, page, panel, and modal in the MAPA web portal, by user type, with
what it does and its notable UX mechanics. Source of truth: the code as of
2026-09-27 (`src/App.jsx`, `src/components/Layout.jsx`, and the page/component files
cited).* Depth is weighted toward the end-to-end core; secondary CRUD/analytics pages
are inventoried at purpose level.

---

## 0. Shell & navigation IA (`components/Layout.jsx`)

One `Layout` wraps every authenticated page. It provides:

- **Top bar:** apps grid (⌘K command palette for admins), notifications bell, messages,
  profile dropdown, language toggle. Announcement banners + offline banner sit above.
- **Left sidebar** (desktop lg+) driven by role nav config; **BottomTabBar** on mobile
  for patients (primary 4 + "More").
- **Shared panels:** `NotifPanel` (bell dropdown → `NotificationModal` detail),
  `MsgPanel` (conversation preview), `AppsPanel` (grid launcher), `ProfilePanel`
  (→ `ProfileModals`: account / password / MFA / privacy / help / report), and a shell
  **`ComposeModal`** (new-message composer with a recipient search).
- **Guards:** installed-PWA-on-staff bounce screen (staff are web-only); a role-change
  refresh toast.

**Navigation maps (from `Layout.jsx`):**

| Role | Primary nav |
|------|-------------|
| **Patient** | Dashboard · Find Programs · Request Assistance · My Application (status) · Messages · User Guide (mobile: bottom tabs + More) |
| **Agency** | Dashboard · Application Inbox · Messages · Agency Profile · Slot Management · Guarantee Letters · Funds · Impact · *(agency_admin also:* Budget Allocation · Team · Promotions · Audit Log*)* · Application Logs · User Guide |
| **Admin** | *Management:* Dashboard · Agencies · Admin Accounts¹ · Announcements · Document Types · Assistance Types. *Operations:* Requests · Analytics · App Logs · Patients · Access Codes · Messages · Reports · Export · Audit Log¹ |

¹ super_admin only (staff_admin cannot reach Accounts / Audit Log).

**Notable / issues:**
- `ComposeModal` still fetches **all users** and, for a patient caller, filters to
  `super_admin/staff_admin/agency` as recipients — a patient recipient picker that
  **reply-only messaging** (abuse hardening #2) made unreachable via the UI but left in
  code. Inconsistent with the new model; candidate for removal/alignment.
- Notification system: ~30 typed icons/colors + category chips + toast on arrival +
  "see all" page. Rich but the patient sees many system/agency types.

---

## 1. Auth & public (`pages/auth/*`, `Landing`, `Register`, `Login`, `InstallApp`)

- **Landing** — civic marketing page (hero, stats, "cost" section, programs). Public.
- **Register** — patient self-registration gated by the **Patient Access Code**
  (CRMC-YYYY-NNNNN); reserved-name blocklist (anti-impersonation).
- **Login** — email+password; staff hit the TOTP MFA challenge.
- **InstallApp** — PWA install guidance.

---

## 2. Patient surface

The primary, bilingual (FIL/EN), mobile-first audience. Routes under `/patient/*`.

### 2.1 Dashboard (`patient/Dashboard.jsx`) — the landing surface
Highly adaptive. Renders, by state:
- **Greeting** + one-line "what's next" status; **"What's new" feed** (announcements).
- **Adaptive hero** — one of: `StatusHero` (pre-funding request, "Step X of 6 + one
  action"), `BalanceHero` (funding stage, money-forward), a per-**slice** status card,
  a "rejected — try another program" card, a first-run **welcome hero** (what you can
  apply for + Get Started), or a compact link card once there's progress.
- **`JourneyStrip`** (compact where-am-I) under the hero.
- **`NextActionCard`** — the single pressing patient action (fix a rejected doc /
  respond to awaiting_info), or nothing when the ball is with CRMC.
- **`TimelineCard`** — a 5-step event timeline driven by request rank.
- **"Application Steps"** — a collapsible 5-step guide (upload → find program → track →
  approved → claim), with progress bar. *Separate content from TimelineCard.*
- **Aside:** `CoverageCard` (bill → PhilHealth − other → needed → approved/remaining),
  `DocumentsList` (per-doc verified/pending/rejected), `MessagesPreview` (last 3).
- **`InstallPrompt`**, first-visit **`Tour`**.

> **UX note:** this one page contains **three** distinct progress models
> (JourneyStrip, TimelineCard, Application-Steps) plus **six** hero branches. See
> finding #1.

### 2.2 Request Assistance (`patient/RequestAssistance.jsx`) — the submit wizard + active-request home
- **4-step wizard:** (1) Need — assistance type, total bill, description; (2) Documents
  — required checklist with **advisory on-device OCR** name-check + "doesn't look like
  an ID" nudge, and a camera-only **selfie** (`SelfieCaptureModal`); (3) Representative
  (optional filed-by: rep ID + selfie + relationship + authorization); (4) Review +
  declaration. Text step indicator ("Step N of 4 · label"), progress bars.
- **Active-request view** (when one exists): `BalanceHero`, Household/Intake sheet entry,
  **coverage plan** (per-agency slices with requirements + procedure + upload), **Proceed**
  gate, document summary + re-upload of rejected docs, withdraw (pre-endorsement only).

### 2.3 Track Status (`patient/TrackStatus.jsx`) — "My Application"
- Tabs: **In Progress** / **Past** (counts).
- Active co-funding request: `JourneyStrip` + `BalanceHero` + a **6-stage request
  stepper** (submitted → under_review → assessment → endorsed → funded → completed) +
  coverage progress + per-slice breakdown + Proceed CTA.
- Per-**slice** cards: **4-stage** slice stepper (endorsed → funding → approved →
  certificate); per-status action banners (pending / endorsed→Proceed / reviewing /
  awaiting_info / approved / certificate) with **GL expiry** visibility (red expired /
  amber ≤7 days); approved-amount hero; `GLDocumentPanel`; withdraw; expand future steps.
- Past: GL download (or "awaiting scan" pill), rejection reason.
- First-visit **`Tour`**.

> **UX note:** contains a **legacy** 6-stage direct-to-agency `buildStages` path with an
> `interview` stage + note — residue from the removed interview flow.

### 2.4 Secondary patient pages
- **Find Programs** (`MedicalPrograms.jsx`) — browse funding agencies/programs.
- **Intake Wizard** (`IntakeWizard.jsx`) — patient fills the factual portion of the
  Unified Intake Sheet (family, income, expenses, medical). Route `/patient/request/:id/intake`.
- **Messages** — reply-only conversation view (shared `AdminMessages` shell).
- **User Guide** (`Guide.jsx`), **Help** (`Help.jsx`), **More** (`More.jsx`, mobile
  hub), **Account Security** (`AccountSecurity.jsx`), **Privacy Notice**
  (`PrivacyNotice.jsx`), **Access Log** (`AccessLog.jsx`, who viewed my data).

### 2.5 Patient modals / shared components
`SelfieCaptureModal` (camera-only, oval framing guide, advisory liveness banner,
consent checkbox, retake/use, no-camera fallback) · `ConfirmModal` (withdraw etc.) ·
`ProfileModals` · `NotificationModal` · shell `ComposeModal`. Shared heroes:
`BalanceHero`, `StatusHero`, `JourneyStrip`, `AnnouncementFeedCard`, `GLDocumentPanel`.

---

## 3. Admin (CRMC) surface — English-only desktop

### 3.1 Requests (`admin/Requests.jsx`) — the operational heart
- **Queue list:** `QueueTabs` (coarse stage buckets) + `RequestsTable` + `BulkActionBar`,
  search (`?q=` deep-link from ⌘K), **48h SLA** state (on-track / due-soon / overdue).
- **RequestDetail workspace** (two-column: work column + sticky context rail):
  - Context rail: amount-needed hero, funding progress, `PathToZeroBalance`,
    **`RequestStageRail`** (verify → assess → endorse), officer + SLA.
  - **① `VerifyDocsPanel`** — per-doc verify/reject/un-verify, **bulk-verify pending**,
    OCR-text expander, `DocViewerModal`, **`CompareFacesModal`** (ID↔selfie side-by-side).
  - **② Assessment** — Unified Intake Sheet link; **PhilHealth-first coverage** inputs
    (bill → PhilHealth − other → residual, editable pre-endorse); "message patient"
    (async remote assessment; Meet link dropped in chat when needed).
  - **③ `EndorseModal`** — **pure-selection** multi-agency picker (best-fit vs
    type-mismatch chips, slots, budget, per-applicant cap shown; pre-endorse
    **missing-document check**; optional referral notes; watcher seeding).
  - Reject / Close(partial) via `ConfirmModal` (with reason); stale-endorsement nudge;
    super_admin **CaseTimeline** (audit-scoped).

### 3.2 Other admin pages
- **Dashboard** (`admin/Dashboard.jsx`) — console: pipeline funnel, agency capacity,
  KPIs (`PipelineFunnel`, `AgencyCapacityOverview`, `DeltaChip`).
- **Analytics** (`Analytics.jsx`) — program overview charts (`BarList`, `TrendArea`).
- **Agencies** (`Agencies.jsx`) + **AgencyDetail** (budget/slots/types/signatory) +
  **AddAgency**.
- **Accounts** (`Accounts.jsx`, super_admin) — staff/coordinator CRUD (secondary-app
  create), modals.
- **Patients** (`Patients.jsx`) — directory + patient profile modal.
- **Access Codes** (`HospitalIDs.jsx`) — issue/print (QR) CRMC-YYYY-NNNNN codes.
- **Document Types** / **Assistance Types** — config CRUD.
- **Announcements** — broadcast composer (banner/feed/both, audience, schedule).
- **Messages** (`admin/Messages.jsx` + `messages/AdminComposeModal`, `ConversationThread`).
- **App Logs**, **Reports** (problem reports), **Export** (+ `ExportPreview`),
  **Audit Log** (super_admin).

---

## 4. Agency surface — English-only desktop

### 4.1 Application Inbox (`agency/Inbox.jsx`) — the funding queue
- **Filter tiles** (Total / For Funding / Needs Info / Approved / Rejected) as clickable
  filters; search; **Newest ↔ Oldest** sort toggle (triage view).
- Table: patient, app ID, submitted + **days-waiting** chip (amber ≥3d, red ≥7d),
  doc count, status + **GL status/expiry** chips, **duplicate-patient** row flag,
  message + open actions. `endorsed` slices are hidden until the patient proceeds.

### 4.2 Application Detail (`agency/ApplicationDetail.jsx`) — the case record + decision panel
Full case record (patient, docs via `DocViewerModal`, sibling-slice coverage,
CRMC notes, `CaseTimeline`) with the three decision modals from `ApplicationModals.jsx`:
- **`ApproveModal`** — approved amount with **three hard caps** (remaining budget /
  endorsed slice cap / per-applicant policy cap), **purpose** multi-select, **payable-to**,
  a **30-day cooldown** block for prior approvals, and a **live co-funding running total**
  (sibling commitments + this amount vs need; over-commit warning / perfect-fill cue).
  Issues the GL on approve.
- **`RejectModal`** — reason templates + custom (required).
- **`RequestInfoModal`** — templated "needs info" → `awaiting_info` (auto-reverts on
  patient upload).
- Also: `SuggestEndorsementModal`, `SignedGLUploadModal` (wet-signed scan),
  `CompactStepper`, `IntakeSheet` (read), `GLViewer`.

### 4.3 Other agency pages
Dashboard (budget hero, queue snapshot, lazy slot-reset/GL-expiry jobs) · Slot
Management · Guarantee Letters (`CertificateGenerator`) · Upload Certificates · Funds ·
Impact · Budget Allocation (agency_admin) · Team (agency_admin) · Promotions
(agency_admin) · Application Logs · Audit Log (agency_admin) · Agency Profile
(public-facing) · User Guide.

---

## 5. Cross-cutting inventory notes

- **Progress representations (patient):** `JourneyStrip`, Dashboard `TimelineCard`,
  Dashboard "Application Steps", TrackStatus **request** stepper (6), TrackStatus
  **slice** stepper (4). → finding #1.
- **Status→label/color logic** lives in ≥4 places: `utils/constants` (`APP_STATUS_CONFIG`,
  `REQUEST_STATUS_CONFIG`), Dashboard `STATUS_VISUAL`, `buildStages`, `JourneyStrip`.
- **`peso()`** is re-defined per page (Dashboard, TrackStatus, Requests, RequestAssistance,
  ApplicationModals…), each `toLocaleString()` without a fixed PH locale.
- **Aging language differs:** CRMC = "48h SLA (on-track/due-soon/overdue)"; agency =
  "N days waiting (amber ≥3 / red ≥7)". Two vocabularies for the same idea.
- **Terminology:** request (CRMC) / application / slice (agency) / case — same entity,
  many names, all visible to the patient.
- **Verification reviewer surface:** `CompareFacesModal` is side-by-side ID↔selfie +
  advisory scores; `DocViewerModal` shows the image + OCR text + rejection reason. No
  guided capture-quality assist on the ID upload beyond the "not an ID" nudge.
- **Onboarding density (patient):** welcome hero + Tour + Application-Steps guide +
  greeting status can co-occur on a first visit.
