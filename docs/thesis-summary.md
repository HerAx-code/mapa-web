# MAPA — Thesis project summary

Last updated: 2026-06-07. **Current-state refresh: 2026-08-25.**

> ## ⚠ Current state as of 2026-08-25 (read this first)
> This summary's body predates a large batch of work. Corrections that
> supersede statements below, all live in production:
>
> **Platform & infrastructure**
> - **Blaze plan, not Spark.** Firebase Storage + Cloud Functions are
>   available. Two functions are **deployed** in `asia-southeast1`:
>   `verifyAccessCode` (access-code throttle) and `syncRequestFinancials`
>   (Firestore trigger that recomputes a request's funding tally from its
>   slices — server-authoritative integrity the rules alone can't give).
>   Any "Spark plan / Cloud Functions not deployed / Storage unavailable"
>   text below is historical. (`documentContents` is still base64-in-
>   Firestore until the written Storage migration is run.)
> - **CI + tests:** GitHub Actions runs build + all four suites on every
>   push/PR, plus a pre-commit hook. Current: utils 35 / components 64 /
>   functions 49 / rules 138 = **286 tests** (the §4 "76" and §9 counts
>   are stale).
>
> **Agency model (RA 11463 reconciliation)** — live in the production DB
> - **GL-issuing funders are four**: DOH-MAIP, PCSO MAP, DSWD AICS, AMBaG —
>   plus **Malasakit reframed as a disabled coordination hub** (it is legally
>   a one-stop shop, not a funder). Any "four agencies (Malasakit, AMBaG,
>   PCSO, DSWD) / 11 demo accounts" text is superseded.
> - **PhilHealth-first (2026-08-27):** PhilHealth is **NOT** an agency — it is
>   the **first-charge coverage that reduces the bill** (Order of Charging,
>   JAO 2020-0001), captured as `philhealthCovered` on the request; CRMC
>   applies it at assessment and only the **residual** is endorsed to the four
>   funders. The `philhealth` agency + its two logins are disabled. Any "five
>   funders including PhilHealth" text is superseded.
>   See `docs/philhealth-first-plan.md`.
> - NOTE: this is applied to the production database and its seed/migration
>   scripts live on the `feat/agencies-ra11463` branch; if reading `main`'s
>   `scripts/bootstrap-reference-data.js` it may still list the old four
>   until that branch is merged.
>
> **Security** — a 2026-07-24 sweep closed a further set of permissive
> create/update rules (documentContents, reports, documents, notifications,
> requests, conversations, hospitalIds) beyond the 2026-06 passes, each
> with a rules test. See the reconciled rule set (138 rules tests). A
> further `applications.update` identity-lock landed 2026-08-25.
>
> **RA 10173 §16(e) erasure — residual CLOSED (2026-08-25).** Patient
> deletion now removes the Firebase **Auth** account too, via the deployed
> `deleteAuthUser` Cloud Function (super_admin-only, idempotent,
> best-effort with a manual-removal fallback). §6 below still describes the
> Auth account as the "one residual" — that is now historical.
>
> **Public UI redesign (2026-08-25)** — live
> - Landing hero rebuilt as a **two-column editorial layout** with an
>   illustrative application-journey card.
> - **All colorful emoji replaced with Material Design line icons** across
>   patient and staff surfaces (civic/professional tone; `react-icons/md`,
>   no new deps). Monochrome UI marks (✓ ⚠ ▲▼) kept.
> - A subtle **CSS animated "aurora" background** on the landing hero and
>   the **Login + Register** pages (reduced-motion-safe, no image/video).
> - Auth pages elevated to match the landing. PWA install CTA relabelled
>   "Install App" (was "Download App") with honest, safe-install copy;
>   `docs/mobile-app-apk.md` documents the PWA-vs-APK path.
>
> **Addendum — 2026-09-03 (work after the 2026-08-25 banner)**
> - **Interview booking is now a self-service appointment system.** Patients
>   book the single CRMC assessment interview from capacity-limited slots;
>   **in-person by default, Google Meet online as a fallback.** Adds an
>   `interviewSlots` collection, an admin slot publisher + per-request
>   open/close-booking gate, and two more **deployed** Cloud Functions —
>   `onInterviewSlotWritten` (book/cancel sync + in-person queue number) and
>   `interviewReminders` (scheduled 24 h + 1 h email + in-app). Interview
>   reminders are therefore no longer client-side/dashboard-poll only.
> - **QR Patient Access Codes** — the code is also issued as a scannable QR
>   that opens the portal and pre-fills it; printed code stays as fallback.
> - **SMS: built, not yet live.** Semaphore (opt-in, PII-free, high-value
>   alerts) via `api/send-sms.js` + `notify({ sms, smsText })`, pending
>   sender-name approval; in-app + email remain the live channels. Any "no
>   SMS" text is superseded.
> - **CI adds a Playwright E2E smoke suite** to the existing suites.
> - **Patient-mobile redesign** — `JourneyStrip` + `StatusHero`, Bricolage
>   display font, pine/amber (stage) vs green (money) colour language.
> - **Landing + `/install` redesign** — one warm cohesive design system;
>   added eligibility, a free/anti-scam band, an FAQ, and a visit-us block;
>   PWA maskable icon fixed (blue-border-behind-logo).
>
> **Addendum — 2026-09-04 (security hardening).** Staff **TOTP MFA** (all
> non-patient roles, Identity Platform; patients exempt); **App Check**
> (reCAPTCHA Enterprise) in monitor mode; **security headers + report-only
> CSP**, **Dependabot** + `npm audit` CI, and a **rules-deploy CI gate**; an
> **incident-response / breach runbook** (RA 10173 72-hour duty) + a
> `users.update` role-escalation test. See `docs/security-improvement-plan.md`,
> `security-research.md`, `incident-response-runbook.md`, `threat-model.md`.
>
> **Addendum — 2026-09-06 (consistency / money-path review).** Fixed:
> deactivation now enforced on every auth path (was password-login only, so an
> MFA-enrolled deactivated staff account could sign in); `applications.update`
> caps `amountApproved <= amountRequested` (no agency over-approval /
> double-funding); `onInterviewSlotWritten` releases a patient's duplicate
> booked slot; `REQ_RANK` de-duplicated to one shared export; listeners audited
> (no leaks). The **rules-deploy CI gate is proven in production** (rules
> auto-test + deploy on merge).

This document distils the MAPA project for thesis defense. It is
organised in the order a panel typically asks: what did you build,
what was it for, what trade-offs did you make, how do you know it
works, what doesn't it do, and what would v2 look like.

For granular history of every decision and commit, see
`docs/revision-list.md`. For threats and mitigations, see
`docs/threat-model.md`. For operator procedures, see
`docs/runbook.md`. This file is the panel-facing summary that
cross-references the other three.

## 1. What MAPA is

MAPA (Medical Assistance Portal Access) is a web + mobile platform
that digitises the medical financial assistance process at
Cotabato Regional Medical Center (CRMC). Patients apply for
hospital-bill / medicine / lab assistance through a single
mobile-first portal; CRMC's Malasakit Center verifies the
documents, conducts one assessment interview, and routes the
request to one or more partner agencies (Malasakit Center,
AMBaG, PCSO MAP, DSWD AICS) as funding "slices" toward zero
balance.

The defining design decision is the **CRMC-gateway co-funding
model**: one patient submits one request, CRMC owns the
verification + assessment + interview, and agencies make
funding-only decisions on their share. This eliminates the
pre-MAPA practice of indigent patients physically queueing at
each agency, repeating their story, and handing over photocopies
of the same documents to each.

The pilot partner is CRMC's Malasakit Center in Cotabato City,
Philippines. The system is a thesis project by a single student
over nine months.

## 2. Architecture and tech stack

- **Frontend (web)**: React 18 + Vite + Tailwind CSS. Mobile-first,
  installable as a Progressive Web App.
- **Backend**: Firebase — Firestore (NoSQL), Authentication
  (email/password), Hosting (production hosting via Vercel — Firebase
  Hosting is the standard Firebase path but Vercel was used for
  serverless function deploys, namely `/api/send-email` for SMTP).
- **Auth model**: 5 roles (`patient`, `agency`, `agency_admin`,
  `staff_admin`, `super_admin`). Role-based Firestore rules are the
  single source of server-side authorisation.
- **i18n**: react-i18next, English + Filipino, structured for future
  expansion (Maguindanaon / Maranao / Tausug noted as future work).
- **PWA**: vite-plugin-pwa, installable with maskable icons + screenshots
  + Android home-screen shortcuts. Service worker auto-updates on
  navigation.
- **Background work**: Cloud Functions written but not deployed —
  client-side lazy fallbacks in `agency/Dashboard.jsx` perform daily
  slot reset + hourly GL expiry sweep when an agency coordinator
  opens the page. The pilot operates entirely on the free Spark plan.

The system has no traditional backend server. Firestore Security
Rules carry the entire server-side authorisation surface. This is
both an architectural choice (lower complexity for a solo nine-month
build) and a major limitation (no Cloud Functions, no cron, no
operational telemetry beyond what Firebase exposes).

## 3. Data model — the co-funding flow

| Collection | Owner | Purpose |
|---|---|---|
| `users/{uid}` | Self / admin | Profile + role + agency assignment |
| `hospitalIds/{id}` | CRMC | Patient access codes (`CRMC-YYYY-NNNNN`) |
| `requests/{id}` | Patient (owns) / CRMC (manages) | One per ask; the parent record holding the bill, amount needed, and the request's intake-sheet content |
| `applications/{id}` | CRMC creates at endorse; agency edits | An "application slice" — one per agency endorsed against a parent request. Carries the agency's funding decision |
| `documents/{id}` + `documentContents/{id}` (Firestore base64, ~700 KiB cap after image compression) | Patient | Uploaded files: IDs, billing statements, abstracts, certificates of indigency. (A Cloud Storage migration was attempted on 2026-06-02 but reverted — the pilot stays on Spark and Firebase Storage requires Blaze. The Storage code path is dormant but ready to re-activate when budget permits) |
| `certificates/{id}` | Agency | Issued Guarantee Letter (GL) + signed scan after wet-sign |
| `notifications/{uid}/items/{id}` | Anyone with `notify()` | Bell-icon feed |
| `conversations/{id}` + `messages` subcollection | Any participant | Patient ↔ CRMC ↔ Agency messaging |
| `auditLog/{id}` | Any admin action | Immutable append-only operational log |
| `agencies/{id}` | Admin | Agency profile, slots, budget |

Lifecycle of one request, end-to-end:

1. Patient `submitted` → 2. CRMC `under_review` (docs verified) →
3. `assessment` (interview + Unified Intake Sheet filled) →
4. `endorsed` (one or more application slices created) →
5. `partially_funded` / `fully_funded` (or `closed` / `rejected`)

Each child slice has its own lifecycle: `endorsed` → patient Proceeds
→ `reviewing` (For Funding) → `approved` (GL issued; budget committed)
→ `certificate` (GL signed + uploaded) → `redeemed` (provider billed
the agency).

The interview lives on the **request**, not on each slice. CRMC
interviews once; the result populates the intake sheet that all
endorsed agencies read.

A `certificate` slice is **not** the same as a "done" slice. A slice
is only terminal once `glStatus === 'redeemed'` (patient claimed it),
`glStatus === 'expired'` (passed the 30-day validity window), or
`isGLExpired(app) === true` (window passed but the sweep hasn't
flipped the flag yet). The `isSliceTerminal` predicate in
`src/utils/requests.js` is the single source of truth for this
across the patient Dashboard, the Status page tabs, and the active-app
picker — preventing the live-downloadable-GL-but-filed-under-Past UX
trap that R17/R18 closed.

## 4. Verification — automated tests + manual audit

The system carries an automated regression net built in the final
two days of the program.

| Suite | Files | Count | Wall time |
|---|---|---|---|
| Unit tests (`npm test`) | `tests/utils/` | 29 | ~1 s |
| Firestore rules tests (`npm run test:rules`) | `tests/rules/` | 47 | ~15 s incl. emulator boot |
| **Total** | | **76** | ~16 s |

Unit tests cover the pure utilities that drive the funding
calculation (`computeAmountNeeded`, `computeFunding`,
`deriveRequestStatus`), the name handling (the L8 honorific stripper,
the L14 reserved-name guard), and the data-export filename helper.

Rules tests exercise every write-side constraint shipped across the
three security passes: actor attribution on `auditLog`, size caps on
display-layer text, patient-write constraints on `documents`,
cross-agency guard on `certificates`, coordinator budget-write block
on `agencies`, conversation participant requirement, message
attribution + size, recipient creation rules on `users`.

Manual verification was done in three sweeps using Playwright at
mobile (375×667) and desktop (1280×800) viewports, covering 41 unique
routes. The full audit log of findings (L1–L14) lives in
`docs/revision-list.md` §B.13 and §B.14.

A fourth verification round — the live-session audit (`docs/revision-list.md`
§B.20 and §B.23, R1–R29) — was driven by a real demo session against
`localhost:5173` on 2026-06-02 → 2026-06-04. The user exercised the
patient / agency / admin flows in a live browser; each UX dead-end,
silent error, or data-cascade gap was triaged and fixed with a
"before / why this is wrong / how it now behaves" commit body. 29
findings closed across that window; the highlights — patient status
page proceed action, certificate-slice tab classification, complete
patient delete cascade, two-panel desktop Messages layout — are in
§B.23 of the revision list.

One real-world deploy check: the patient install flow was end-to-end
verified by installing the PWA on a real Android phone from the live
Vercel deployment (`mapa-web-six.vercel.app`).

## 5. Security posture

The thread of the security work is best understood as a single
incident-response narrative, not a linear feature build.

**Discovery (2026-06-01):** during a live Playwright audit of the
admin Audit Log page, 18 planted entries were found in the
`auditLog` collection with fake "System / Recovery Engine /
Migration Daemon" actors carrying shell-command payloads aimed at
human and AI agents reviewing the dashboard — `claude -p "…"`
recursive invocations and `firebase deploy --only firestore:rules`
attempts. The entries were *not* executed.

**Root cause:** the previous `auditLog.create` rule was
`allow create: if isAuth()` — any authenticated user could write
arbitrary actor names and payloads. Any role with `logAudit()` access
(every authenticated user) could plant prompts.

**Response (three layered rule passes):**

1. **Pass 1** (commit `f14ea17`): `auditLog.create` now requires
   `actorId == request.auth.uid` and bounds `details` at 2000 chars.
   Display layer in `admin/AuditLog` clamps `details` to 240 chars
   with "Show more". Companion attack (registration with role-
   impersonating names like "CRMC Admin", "System Diagnostics",
   "cascade_…") closed by a reserved-token guard in `Register.jsx`.

2. **Pass 2** (`242c175`): same hardening pattern applied to
   `notifications`, `conversations`, `notificationErrors`, `reports`.
   Plus `scripts/cleanup-injection-audit.js` — an admin-SDK script
   that purges the planted entries from production.

3. **Pass 3** (`9a596d4`): patient-write constraints on `documents`
   (patientId match, status='pending', no pre-stamped agencyIds,
   ocrText size cap, later no pre-stamped storagePath), agency
   ownership guard on `certificates`, message-attribution + size cap
   on conversation messages, banner-size caps on announcements.

4. **Cleanup**: the operator ran `cleanup-injection-audit.js
   --delete` against production; 18 entries purged.

The complete threat-mitigation table — 10 threats addressed, 8
accepted with rationale, 7 operational limits — is in
`docs/threat-model.md`.

## 6. Compliance — RA 10173 §16(e) right-to-erasure and §16(f) data portability

The patient can both **obtain a copy** of every record MAPA holds about
them and **trigger their permanent erasure** through the admin
workflow. Both flows are mapped to specific provisions of the
Philippine Data Privacy Act.

**§16(f) — right to data portability.** The "Download my data"
button in the Privacy Notice modal triggers
`buildPatientDataExport(uid)`, which fans out across every
patient-keyed collection and returns a single JSON blob (format
`MAPA-RA10173-v1`) covering profile, requests, application slices,
documents (metadata + content), certificates, notifications, and
conversations with both sides' messages. Timestamps are normalised to
ISO strings so the download round-trips back into `Date()` cleanly.

**§16(e) — right to erasure.** Patients flag their account for
deletion via the admin (the soft-delete flag gates login at
`AuthContext` per R1, 2026-06-03); a super_admin then commits the
permanent erasure from `admin/Patients`. The cascade fetches and
removes every patient-keyed collection in parallel: documents,
documentContents, applications, **requests** (the co-funding parent),
**conversations** (both sides' messages + the conversation docs
themselves), **certificates** keyed by application id, and the
notifications subtree. Failure modes are now logged rather than
silently swallowed so a partial cascade is visible to the operator.
Closing this cascade was R20 of the audit-round-2 batch (§B.23 of
the revision list); previously the cascade missed requests,
conversations, and certificates — orphaning patient PII in those
collections after a deletion. The Firebase Auth user is the one
residual: the client SDK cannot delete other users' Auth accounts,
so the email stays registered. This is mitigated by warning copy in
the delete modal and is the v2 target for a Firebase Admin SDK
deletion Cloud Function (Blaze plan).

## 7. Operational posture

The system is operator-runnable today via ten admin-SDK scripts,
grouped by purpose:

**Seed + maintenance (demo accounts):**
- `scripts/demo-accounts.js` — canonical `USERS` array; single
  source of truth for the 11 demo accounts (2 CRMC admins, 4
  agency_admins, 4 coordinators, 1 patient). Imported by both
  scripts below.
- `scripts/bootstrap-users.js` — one-shot creation of the seed
  accounts (idempotent: leaves existing Auth + Firestore alone).
- `scripts/check-demo-accounts.js` — read-only health diagnostic.
  Uses the Web SDK + `.env`, so it runs without a service-account
  key. Verdict per account: ✅ OK / ⚠️ WRONG_ROLE / 🔑 BAD_PASSWORD /
  🕳️ NO_PROFILE. Recommended as a pre-defense smoke test.
- `scripts/repair-demo-accounts.js` — force-restore via Admin SDK.
  Creates missing Auth users, force-resets drifted passwords,
  merges canonical fields back into Firestore profiles (with
  `{ merge: true }` so accumulated test data like patient address
  / photoURL survives). Includes `--dry-run` mode.

**Seed + maintenance (reference data + defense prep, added §B.25):**
- `scripts/bootstrap-reference-data.js` — admin-SDK companion to
  `bootstrap-users.js`. Seeds the four non-user reference
  collections (4 agencies + 8 documentTypes + 8 assistanceTypes +
  20 hospitalIds) with `{merge:true}` so re-running is idempotent.
  Replaces the user-creation portion of the legacy `/seed` web page.
- `scripts/seed-demo-scenario.js` — pre-prep for the thesis-defense
  walkthrough. Creates one in-flight request from the demo patient
  (₱25,000 for Hospital Bills) plus three pending documents.
  Strictly additive (won't touch existing data). The demonstrator
  drives the panel through verify → endorse → approve → GL issued
  live in 10 minutes during the actual defense.
- `scripts/export-firestore.js` — full-database backup via Admin
  SDK. Walks every top-level collection + the two known
  subcollection paths (`notifications/{uid}/items`,
  `conversations/{id}/messages`), writes one JSON file per
  collection under `./backups/{ISO-timestamp}/`. Spark plan has no
  auto-backup; this is the operator's only rollback before
  destructive operations. Verified live: 19,538 docs in 142.8 s.

**Periodic + incident response:**
- `scripts/cleanup-orphans.js` — periodic Firestore garbage
  collection.
- `scripts/cleanup-injection-audit.js` — the audit-log purge tool
  used in the prompt-injection security response.
- `scripts/migrate-doc-content-to-storage.js` — the migration
  helper for moving patient document content from Firestore to
  Cloud Storage (dormant under Spark, ready for v2 Blaze).

The full operational runbook — deploy procedures, incident
response, credential rotation, backup, pinned versions — is in
`docs/runbook.md`.

### A note on Spark plan write quotas (added 2026-06-06)

The pilot runs on Firebase's free Spark plan, which caps Firestore
at 20,000 document writes per day per project (resets at midnight
Pacific Time). A live-session debugging run on 2026-06-05 surfaced
that **the Firebase Admin SDK swallows `429 RESOURCE_EXHAUSTED`
errors into infinite silent gRPC retries** — meaning writes don't
just fail, they hang indefinitely with no error, no toast, no
diagnostic. The Web SDK behaves similarly, queuing writes locally
in the assumption they'll succeed later.

This pattern is operationally indistinguishable from a network
firewall hang. The reliable way to diagnose it is to bypass the
SDK and call the Firestore REST API directly — `429` comes back
in under a second instead of hanging. The full playbook lives in
§B.24 of the revision list. This is worth presenting honestly
during defense as a real-world Spark plan trade-off: the system
silently degrades under sustained write load instead of failing
loudly, which can mask the cause for hours.

## 8. Limitations and future work

This is the "what the system intentionally does not do" inventory,
to be presented honestly during defense.

**Pilot scope (explicit in CLAUDE.md):**

- Single hospital (CRMC). Multi-tenancy is v2 architecture, not a
  config change.
- SMS notifications are built (Semaphore, opt-in and PII-free,
  reserved for high-value alerts) but not yet activated — the
  sender name is pending approval, so in-app + email are the live
  channels, with FCM push planned for the mobile app.
- No PhilSys integration. Government API access requires an
  approval process that does not fit a nine-month timeline.
- No real money movement. MAPA records commitments; settlement
  happens off-system between agency and provider.
- OCR is advisory only. The social worker compares the live selfie
  to the uploaded ID and makes the final call. By design, not by
  oversight.

**Engineering posture residuals:**

- Pilot runs on Firebase's **Spark (free) plan**. Cloud Functions
  written but not deployed; client-side lazy fallbacks handle
  scheduled work (slot reset, GL expiry). Same Blaze constraint
  applies to Cloud Storage — patient document content is currently
  base64-in-Firestore (capped at ~700 KiB after image compression);
  the migration to Cloud Storage was implemented and partially
  deployed on 2026-06-02 but reverted in commit (this batch)
  because Storage on Spark is not available on this project. The
  migration code stays in tree for v2 activation.
- **Spark plan write quota (20K writes/day) is real, and it bites
  silently.** Heavy dev + test sessions in a single 24-hour window
  can exhaust the daily allowance, after which every Firestore
  write across the entire project (patient registrations, admin
  edits, notifications, audit log entries, even quota recovery
  attempts) returns `429 RESOURCE_EXHAUSTED`. The Admin SDK
  swallows this into silent retries; the Web SDK queues locally
  with no user-facing feedback. Reset happens at midnight Pacific
  Time. The §B.24 diagnostic playbook lets the operator confirm
  this in under a minute via a direct REST call. v2 mitigation:
  Blaze upgrade removes the cap. Current mitigation: stagger
  high-write activity across days; document the playbook so the
  next incident is diagnosed in minutes not hours.
- No staging environment. Dev work hits the same Firestore as the
  pilot.
- No CI/CD. Manual `firebase deploy --only firestore:rules` and
  Vercel auto-deploy on `git push`. Rules tests must be run locally
  before any rule change.
- No 2FA, no session timeout. Firebase Auth defaults.
- Bilingual (Filipino + English) only. Cotabato has significant
  Maguindanaon, Maranao, and Tausug speakers; future i18n work is
  translation-budget-bound, not engineering-bound.

**Specific deferred items** (see §B.21 of `docs/revision-list.md`):

- L5 Tour Skip "delay" — likely Playwright snapshot-timing artifact;
  no real user reports.
- L11 root-cause data cleanup — the `⚠ data check` chip surfaces the
  contract violation; underlying request-status field still needs an
  operator re-derive.
- Admin AppLogs server-side search.
- `MAX_CAPACITY = 100` hardcode in `agency/SlotManagement`.

## 9. Defense-ready statements

The following claims are defensible, with reference to test files /
commits / docs:

1. **"The security model is verified by 47 automated rules tests."**
   `npm run test:rules` runs the Firestore emulator + exercises every
   write-side constraint. See `tests/rules/`.

2. **"The funding logic is verified by 29 automated unit tests."**
   `npm test` covers the pure utilities that drive `computeFunding`,
   `deriveRequestStatus`, and the input validation in the auth flows.

3. **"The system survives an attempted prompt-injection attack."**
   The 18-entry incident is documented in `docs/threat-model.md` T2;
   the rule + display + registration layers that defang the attack
   are commits `f14ea17`, `242c175`, `9a596d4`. The cleanup tool
   `scripts/cleanup-injection-audit.js` purged the planted entries.

4. **"The patient install flow is verified end-to-end on real
   hardware."** Confirmed install of the PWA on a real Android phone
   from `https://mapa-web-six.vercel.app`.

5. **"The system is operator-runnable, not just demo-runnable."**
   `docs/runbook.md` covers deploy, incident response, credential
   rotation, backup, pinned versions.

6. **"The system meets RA 10173 §16(f) data portability."**
   `src/utils/dataExport.js` + "Download my data" button in the
   Privacy Notice modal. The export is a single
   `MAPA-RA10173-v1` JSON blob covering every patient-keyed
   collection.

7. **"The system meets RA 10173 §16(e) right-to-erasure."**
   `admin/Patients.handleDeleteAccount` cascades the deletion across
   all six patient-keyed collections (documents, documentContents,
   applications, requests, conversations + nested messages,
   certificates, notifications subtree). Closed by R20 of audit
   round 2 (§B.23). The residual — Firebase Auth user — is documented
   and queued for the v2 Admin SDK Cloud Function.

8. **"Limitations are documented, not hidden."** §A1–A8 of
   `docs/threat-model.md` is the formal accepted-residuals list with
   rationale.

9. **"Patient surfaces are responsive — phone-first AND
   desktop-aware."** `/patient/status` and `/patient/messages` both
   adapt their layout: phone gets a mobile-optimised single column
   with modal overlays; desktop gets a wider single column with
   inline interactions (status) or a two-panel split with inline
   thread rendering (messages). The agency / admin two-panel
   pattern is reused on the patient Messages page on `md+`, so the
   layout no longer suggests "this is just a webpage built for
   phones" when viewed at desk-screen size. R29 of the audit-round-2
   batch.

10. **"The demo set is recoverable from drift in one command."**
    `scripts/check-demo-accounts.js` is a Web-SDK diagnostic
    runnable with no extra credentials; it reports each of the 11
    demo accounts as ✅ OK / ⚠️ WRONG_ROLE / 🔑 BAD_PASSWORD /
    🕳️ NO_PROFILE. `scripts/repair-demo-accounts.js` (Admin SDK)
    aggressively restores all 11 to canonical state, idempotently,
    with a `--dry-run` mode that prints the per-field diff before
    writing. The two share `scripts/demo-accounts.js` as a single
    source of truth. Designed so a pre-defense run takes 5 seconds
    of check + (if needed) 30 seconds of repair, instead of an
    hour of Firebase Console clicking.

11. **"Real-world Spark plan failure modes are documented, not
    hidden."** A live debugging session on 2026-06-05 surfaced
    that the Firebase Admin SDK turns `429 RESOURCE_EXHAUSTED`
    (daily write quota) into infinite silent gRPC retries — writes
    just hang forever with no error. The diagnostic playbook (call
    the Firestore REST API directly; if you get 429, you're over
    quota) is documented in §B.24 of the revision list. This is the
    kind of trade-off worth presenting honestly during defense:
    the free tier silently degrades under load instead of failing
    loudly. Blaze removes the cap; the playbook diagnoses the
    cause in under a minute.

12. **"The system is recoverable from a clean checkout in under
    ten minutes."** Five admin-SDK scripts plus a fresh
    `service-account.json` rebuild every layer of the data model
    independently: `bootstrap-users.js` seeds the 11 demo accounts,
    `bootstrap-reference-data.js` seeds the 4 partner agencies +
    catalogs, `seed-demo-scenario.js` adds one in-flight request
    for the panel walkthrough, `export-firestore.js` snapshots the
    current state to disk before any destructive op, and
    `check-demo-accounts.js` is the read-only smoke test the
    operator runs immediately before defense. The pre-defense
    workflow (§7 above) chains them. This is the difference
    between "demo only runs in one specific environment" and
    "system can be brought up reproducibly anywhere with the
    service-account key" — the latter answers the "but what if
    something breaks?" question during defense.

13. **"Agency branding is operator-managed."** Each agency can
    set a `logoUrl` via the admin edit modal (HTTPS only since
    Cloud Storage is off the Spark table). The shared
    `<AgencyAvatar />` component renders the image at every site
    where the full agency object is in scope (admin/Agencies,
    patient/MedicalPrograms, auth/Landing, agency/Dashboard,
    agency/Program, admin/AgencyDetail, admin/AddAgency) and
    falls back to the colored-initials block on broken-link or
    unset URL. Agency_admins paste their official logo URL once
    during onboarding; no Cloud Storage upload required.

14. **"Inter-agency coordination is implemented as three
    sourced enterprise patterns, not ad-hoc UX."** MAPA's
    Phase 1 coordination layer (§B.26, R33–R35) ships three
    mechanisms each drawn from a documented production system:
    (a) the **Case Timeline** on every agency's view of a
    co-funded case renders a chronological cross-agency event
    feed — Salesforce Public Sector Activity Timeline + NHS
    England Integrated Care Systems shared care record event
    view; (b) **watcher subscriptions** push real-time
    notifications to all participating agency staff when
    siblings approve or reject — ServiceNow Public Sector
    watcher / subscriber model; (c) a **live over-commitment
    guard** in the approve flow shows the running co-funding
    total as the coordinator types, with three colour-coded
    states — industry-standard optimistic concurrency UX,
    preserved-human-judgment variant. All three operate within
    the deliberately constrained CRMC-gateway model: agencies
    remain independent decision-makers; CRMC remains the
    network broker. The platform supports structural
    coordination — Bardach (1998) "frame reflection",
    Klijn & Koppenjan (2016) "network awareness" — while the
    social workers do the relational work. Three coordination
    features pending in Phases 2–4 (structured referrals,
    outcome reconciliation, patient-visible audit trail,
    in-case comment threads, joint Meet scheduling, HSDS
    interop adapter) are documented as honest future work in
    `docs/thesis-documentation.md §11.4d` and §12.2.

## 10. Reading order for a panel

For a panel that wants to drill in:

1. Read `CLAUDE.md` first — frozen project context.
2. Then this file (`docs/thesis-summary.md`) for the narrative.
3. Then `docs/threat-model.md` for security depth.
4. Then `docs/runbook.md` for operational depth.
5. Then `docs/revision-list.md` for granular history — §B.21 closing
   summary is the one-table view.
6. Then `tests/` to verify any specific claim by reading or running
   the assertion.