# MAPA Project Context

## What This Is
MAPA (Medical Assistance Portal Access) is a **client-agnostic** platform for medical financial assistance. It digitizes the application process — patients apply online, the hosting medical center's social-services office reviews the documents and does one **remote, asynchronous assessment** (no scheduled interview: the social worker works a queue and reaches the patient through in-app messaging), then endorses the request to one or more funding agencies; approved patients receive a Guarantee Letter (digital certificate) to claim at the agency office.

The **host organization is configurable, not hardcoded** — a single source of truth in `src/config/org.js` (+ `functions/src/orgConfig.js`) drives the brand name, the gateway office, the facility name, the access-code prefix, and support contact, overridable per deployment via `VITE_ORG_*` env (neutral MAPA defaults otherwise). Patient-facing copy uses the `{{org}}` / `{{gateway}}` / `{{facility}}` i18n tokens; staff pages read `ORG` directly. The workflow, forms, and the Order of Charging throughout this file are modeled on a real Philippine medical-center social-services process, but the product, code, and copy are fully client-agnostic and name no specific host. (See the "Org config / de-CRMC" memory. Geography — BARMM/Cotabato address + barangay data — is real location data, kept and not part of the configurable brand.)

This is a **production system** built for real use (target deployment: a Philippine hospital with a medical social service). It is a four-person capstone built over ~9 months, and it is **not a throwaway pilot** — apply a production quality and robustness bar, and weigh features by real operational value at scale (coordinator workload, assessment turnaround, concurrency safety, indigent-patient phone UX), not demo-readiness. Pilot-era shortcuts in this file are being reconciled against that reality.

The system has two patient-facing surfaces:
- A web portal (this codebase) — used by agencies, admins, and patients who prefer browser access
- A mobile app (planned, separate project) — the primary patient experience, more user-friendly than the web for indigent users on phones

Agencies and admins use the web only. Patients can use either, but mobile is the intended primary channel.

## Tech Stack (do not change without discussion)
- Frontend (web): React 18 + Vite + Tailwind CSS
- Backend: Firebase (Firestore, Auth, Hosting)
- Auth: Firebase Authentication (email + password) + **TOTP MFA for staff roles** (Identity Platform; patients exempt) and **Firebase App Check** (reCAPTCHA Enterprise, monitor mode). See `docs/security-improvement-plan.md` + `security-research.md`.
- Database: Cloud Firestore (NoSQL)
- Mobile app: planned, framework TBD (likely React Native or Flutter — share Firebase backend with web)
- i18n: react-i18next for Filipino/English support — not yet integrated

## Communication Channels (current decisions)
- Assessment — **remote and asynchronous. No appointments, no scheduled interview.** The mandatory human assessment is kept, but it is worked from a queue, not booked. After documents verify, the request enters an "assess" queue; a gateway social worker picks it up, reaches the patient through the in-app conversation, then completes the Unified Intake Sheet. The assessment is **text-only** — see the Meet note under Communication Channels before adding any live-call step. The completed intake sheet is the endorse gate (`docsVerified && intakeComplete`) — the human-in-the-loop requirement without the travel/wait/no-show friction. See docs/remove-interview-scheduling-plan.md.
  - **Why no booking:** a pre-booked appointment reintroduces exactly the friction MAPA exists to remove; congestion control is moot when the assessment is remote/async (nobody queues at the office for it). Reversed the earlier appointment-system decision (2026-09-24).
  - Google Meet (on demand) was the chosen answer for a live call — free, reliable on weak networks, no infra to run — but it is **not implemented.** `request.meetLink` (with interviewDate/Outcome) exists only on requests assessed before booking was removed (1 in production); the agency view shows it as a legacy record and **nothing writes it**. Treat remote assessment as text-only. Building our own video is still NOT planned (see Out Of Scope).
- Notifications: in-app notifications (Firestore) + email, **sent only by the server** (Phase 1, 2026-11-21; docs/phase1-messages-accounts-plan.md).
  - `notify()` writes the in-app notification only. The `sendNotificationEmail` Cloud Function emails each new notification if the sender may reach the recipient (`functions/src/emailScope.js`: patients → only themselves; hospital staff → their hospital's patients and staff; agencies → patients endorsed to them, their team and partner hospitals' staff; Super Admin → staff) and is under the hourly limit (patients 10, staff 120). Notifications written by other functions are emailed too. `channel: 'inapp'` opts out (announcement fan-outs). SMTP login = Functions secrets `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`. Never add a browser-callable email or SMS endpoint again — the old `/api/send-email` and `/api/send-sms` mailed anyone anything (gap I5) and were removed.
  - Announcements: the audience (`targetRoles` at the announcement's hospital) is notified by `onAnnouncementCreated`; the 24-hour reminder by `announcementReminders`.
  - **SMS is off** (2026-11-21). The Semaphore channel was removed with `/api/send-sms`; if it returns, it is a branch of `sendNotificationEmail` limited to staff senders and named events.
  - When mobile app ships, add push notifications (free via Firebase Cloud Messaging)

## User Roles
Display names differ from the stored role ids (owner decision 2026-11-14: labels
only, ids never renamed — they're data, rules and tests). Use the ids in code;
show the names in UI (`ROLE_LABEL` / `ROLE_LABEL_SHORT` in src/utils/constants.js).
- `platform_admin` → **"Super Admin"** — the network operator *(multi-hospital
  Phase 6, not yet deployed)*: onboards hospitals (prefix, region, sign-ups
  open/paused, first admins, onboarding-request queue), owns agencies (incl.
  partner hospitals, teams, slots) + reference data, sees network counts only.
  No tenant, **no patient PII** (not in `isAdmin()`). Created only via
  `scripts/create-platform-admin.mjs`.
- `super_admin` → **"Hospital Admin"** — full gateway access to **its own
  hospital**: request queue (verify / assess / endorse to partner agencies),
  patients, access codes (own prefix), staff accounts, audit log, Hospital
  Settings (branding), announcements, messages, reports, export.
- `staff_admin` → "Staff Admin" — the hospital's day-to-day gateway work; no staff
  accounts, audit log, Hospital Settings, access-code reset/delete or user deletion. Staff Admins DO issue access codes at the desk (owner decision 2026-11-15). Staff Admins see each case's Case Timeline (that request's audit entries; owner decision 2026-11-16) but not the full Audit Log.
- `agency_admin` → "Agency Admin" — agency portal + budget allocation, own team,
  promotions, agency audit log; partner hospitals read-only.
- `agency` → "Agency Coordinator" — inbox of slices endorsed to their agency from
  any partner hospital; reads only patients endorsed to the agency. Writes to
  its agency doc are limited (rules, 2026-11-15) to budget usage, today's
  remaining slots and one named hospital's remaining slots (`slotRestoredFor`);
  capacity, per-hospital totals, manual slot adjustments, allocation, cap,
  assistance types, name, the Agency Profile text and `enabled` are the Agency
  Admin's / Super Admin's (owner decision 2026-11-16: only the Agency Admin
  edits the profile). `enabled` is the Super Admin's alone.
- **Messaging is reply-only for patients:** only staff and agencies start a
  conversation; patient copy must never tell them to start one. **No one deletes
  a conversation or message** (case record; owner decision 2026-11-16, rules deny it).
- `patient` — patient portal, own data only. **The access code is OPTIONAL at
  registration** (owner decision 2026-11-15, reversing 2026-11-14; see
  reports/Access code at registration.md). With a code, its hospital is their
  first and the same code backs their first request. Without one, they get a
  network account with no hospital and enter a code when they file. One
  account works network-wide: for each request they compare hospitals at
  `/patient/hospitals` and claim a code from the hospital they choose (one
  code = one request).

## Design Principles
- Government-adjacent system. Tone: civic, professional, trustworthy. Not flashy.
- Patient-facing UI must be bilingual (Filipino + English). Use inline bilingual labels where possible. **Enforced** by `npm run lint:i18n` across `src/pages/patient/**`, `src/components/patient/**`, and the shared shell components patients see (Layout, AnnouncementBanner, AnnouncementFeedCard, OfflineBanner, InstallNudge, InstallPrompt).
- **Staff surfaces (agency/admin pages) are English-only by design.** The gateway + partner-agency operators are professionals expected to work in English (clinical / government default language for record-keeping in the Philippines). The eslint linter does NOT enforce i18n on `src/pages/agency/**` or `src/pages/admin/**`. If a future stakeholder reports that staff need bilingual UI, that becomes a scoped epic — adding it to the linter scope requires committing to translating ~30+ staff pages. Not a v1 shortcut.
- Mobile-first thinking for patient screens, even on web. Many patients use phones on slow connections.
- Match the gateway's actual workflow (Client's Information Sheet + Unified Intake Sheet). Don't invent fields they don't use.
- ID verification is **OCR-assisted, social-worker-confirmed**: on-device OCR (tesseract.js) reads the ID name as an advisory cross-check, and a camera-only **live selfie** is compared to the ID by the gateway social worker. No PhilSys, no automated biometrics — the social worker always makes the final call.
- Patient Access Code (`<PREFIX>-YYYY-NNNNN`) is **required for every request and optional at registration** (2026-11-15; it was required at registration 2026-11-14): a code given at registration backs the first request; each later request needs a new code. A rejected/closed request consumes its code — staff use document Redo for fixable problems. Issued in person by a hospital's gateway office. **Each hospital has its own prefix** (multi-hospital Phase 8: `hospitals/{id}.accessCodePrefix`, claimed once in `accessCodePrefixes/{PREFIX}` so it stays unique). Claiming a code (`src/utils/accessCodes.js` `claimAccessCode`, one transaction) makes the code's hospital the patient's current one (`users.tenantId`), adds it to `users.tenantIds`, and sets `users.hospitalId`; the request is then written in ONE batch with `hospitalIds/{code}.requestId`, so **a code backs exactly one request**. A hospital with `enabled: false` takes no new claims. Printed documents use the CASE hospital's branding (`fetchHospitalBranding`), not the viewer's `ORG`.
- **Course-of-treatment codes (Phase 3A, 2026-11-16).** A code issued with `courseUntil` (at most ~3 months; IssueCodeModal) backs the patient's requests one after another until then — one active request at a time still applies; the rules (`courseActive`) allow re-binding `requestId` while it runs, and staff can end a course early (`courseUntil` to now). Ordinary codes still back exactly one request.
- **DOH monthly report (Phase 3B).** Export → DOH Monthly Assistance Report: one row per approved slice (age, sex, city, diagnosis, care setting, fund source, amounts; no names; src/utils/dohReport.js). Patients give `sex` at sign-up; older accounts fill birthdate + sex once (ProfileGapsCard; rules: fill-once). Export queries are always scoped to the staff member's hospital (`tenantWhere` / `patientWhere`).
- **Patient-bound codes (owner decision 2026-11-15).** The Hospital Admin or a Staff Admin issues each code to ONE named patient at the desk (IssueCodeModal); only the Hospital Admin can reset or delete one: name, birthdate, mobile number, visit date, case number and the ID seen. These go in the staff-only `hospitalIds/{code}/privateInfo/issued`; the code doc carries only `bound: true`.
- **Claiming one:** the claimant must give the same last name + birthdate (`codeProof()` in src/utils/codeIssue.js, letters-only last name). That is checked by verifyAccessCode and enforced by the rules (`codeClaimProofOk`). At registration the account takes the recorded name and birthdate (`codeNameOk`).
- **No blank batches:** blank codes are no longer created. Blank codes issued earlier keep working until `BLANK_CODE_CUTOFF` (2026-12-15, Manila time; the same date is in the rules and in functions/src/codeIssue.js).
- **Tests:** rules tests load the rules through tests/rules/helpers/rules.js, which moves that cutoff into the future.

## Out Of Scope (do NOT build)
- PhilSys API integration
- Real money movement (no bank APIs, no payments). Note: monetary *commitments* ARE tracked as data — approved amounts, agency budgets, Guarantee Letter status. MAPA records intent; actual settlement happens off-system between agency and provider.
- SMS notifications — built via Semaphore, then **switched off** (2026-11-21) when the open `/api/send-sms` endpoint was removed. See Communication Channels.
- Custom video calling built on raw WebRTC (own signaling/TURN/SFU/media infra) — **not planned.** Remote assessment is text-only today; an on-demand Google Meet link remains the chosen option if a live call is ever needed. A *managed* embedded-video provider (Daily / LiveKit / self-hosted Jitsi) is a reconsiderable production option only if in-app join friction proves to be a real, observed barrier — never a from-scratch WebRTC build. See Communication Channels.
- Interview appointment / self-service booking system — **removed** (was built, now reversed). Assessment is remote/async; see docs/remove-interview-scheduling-plan.md.
- Donor portal
- Fraud detection engine (manual judgment by social workers)
- ~~Multi-hospital network (one host facility per deployment)~~ — **now in scope** (owner decision 2026-11-13). MAPA is becoming one gateway shared by many BARMM hospitals; see Tenancy below and docs/multi-hospital-network-plan.md.
- Real-time IHOMIS integration (use manual case number reference instead)

## Firestore Collections
users, requests, applications, approvalMarks (per-agency 30-day cooldown), documents, documentContents, documentTypes, assistanceTypes, agencies, hospitalIds, certificates, conversations, notifications/{uid}/items, reports, announcements, auditLog, docReviewPresence
`hospitals` (multi-hospital tenants; Phase 1), `accessCodePrefixes` (prefix → hospital claims; Phase 8), `networkStats` (per-hospital counts for platform_admin, Admin-SDK written; Phase 9), `hospitalsPublic` (sign-in-free hospital projection for Landing/Register and the patient marketplace — name, prefix, office, address, region, contact email; must equal the hospital doc), `hospitalsPublicStats` (per-hospital typical turnaround for the marketplace, counts only, Admin-SDK written by networkStats), `onboardingRequests` (hospital onboarding records: the public /for-hospitals expression of interest, then the Super Admin's stages Interest → Verification → Agreement → Setup & training → Live at /platform/onboarding/:id, with verification, agreement, training and filed documents in Storage `onboarding/{id}/`; platform_admin only — see reports/Hospital onboarding requirements.md and src/utils/onboarding.js). **Retention:** a request closed as `closedAs` 'declined' (by MAPA) or 'withdrawn' (by the hospital) stays in the Declined stage; the monthly `purgeDeclinedOnboarding` function deletes it and its `onboarding/{id}/` files one year after the last action (`updatedAt`), as the For Hospitals privacy notice promises, leaving an audit entry with the hospital name only. **A hospital set up from onboarding starts with patient registration closed (`enabled: false`, `onboarding.stage`); only the go-live step opens it — don't add other paths that flip `enabled` for an onboarding hospital.** The shared **Training Hospital** (`mapa-training-hospital`, prefix `TRAIN`, `onboarding.training: true`) is open for practice with sample patients but is never published to `hospitalsPublic` (syncHospitalPublic skips it) — never partner a real agency with it.
**Input verification Phase 1** (reports/Patient input verification.md): `billKeys/{tenantId}__{BILLNO}` records each bill number confirmed in the intake sheet's bill check (with "checked against": billing system or signed bill), so the same bill on another request is caught; reuse needs a written reason (audited). `identityIndex` / `identityIndexByUser` (server-only keyed hashes, secret `IDENTITY_KEY`) and `identityFlags/{tenantId}__{uid}` (functions/src/identityIndex.js) flag other accounts with the same PhilSys card, name + phone, or phone. Matches at another hospital are a COUNT only — never names, hospitals or cases. Flags are advice for the social worker; never auto-reject on them. Funding over-commitment across agencies stays a soft warning (owner design).
**Input verification Phase 2:**
- Medical certificates/abstracts, the bill, the indigency certificate and the social case study are verified with a per-document checklist (src/utils/docChecks.js; ticks stored as `documents.checks`). "Verify all" covers only documents without one.
- A request needs a recorded verification call (`intakeSheet.verificationCall`) before endorsing when `interviewReasons()` (src/utils/verificationPolicy.js) says so: an amount at or above the hospital's threshold, a strong duplicate-account flag, or a reused bill number.
- The policy lives in `hospitalSettings/{tenantId}`, which is staff-only so patients can't see the threshold. The Hospital Admin edits it in Hospital Settings.

**Input verification Phase 3:**
- The patient signs a declaration at submission (`patient.request.declaration*`, EN/FIL, naming the RA 11463 Sec. 11 penalties). It is stored on the request as `declaration { version, lang, byRep, at }`.
- **Bump `DECLARATION_VERSION`** (src/utils/verificationPolicy.js) whenever that text changes. The wording should be reviewed by the team's adviser.
- Optional second-person approval (`hospitalSettings.secondPersonAboveAmount`, off by default): above that amount, whoever confirmed the bill, recorded the call or completed the assessment can't also endorse (`secondPersonHold()`).
- The endorse gates are client-side, like the rest of the endorse gate; the rules don't enforce them.

## Tenancy (multi-hospital network — all phases built, not yet deployed)
MAPA is moving from one host facility per deployment to **one deployment serving many
hospitals** (docs/multi-hospital-network-plan.md — read it before touching rules,
queries, roles, access codes, or org config). Locked decisions (2026-11-13):
- A **hospital is the tenant**: its gateway staff, patients, access codes, requests,
  documents, intake sheets, conversations, certificates, reports, announcements and
  audit log carry a **`tenantId`** (the `hospitals/{id}` doc id). NOT `hospitalId` —
  that field already means the patient's access code (`hospitalIds` collection). Gateway roles (`super_admin`, `staff_admin`) become
  **hospital-scoped**; a new **`platform_admin`** role runs the network (onboards
  hospitals/agencies, aggregate analytics, no patient PII).
- **Hospital #1 (`hospital-1`) was merged into Cotabato Regional and Medical Center
  (`cotabato-regional-and-medical-center`) and deleted (2026-11-14).** `hospital-1`
  remains only as the rules/env fallback id for records with no hospital — it
  matches no hospital now, which is the safe outcome. Do NOT run
  scripts/seed-default-hospital.mjs against production (it would recreate it).
- **Agency slots are per partner hospital** (`agencies.hospitalSlots[hospitalId]
  = { total, remaining, lastResetDate }`, set by the agency admin on Slot
  Management; `effectiveSlots(agency, today, hospitalId)` in src/utils/requests.js).
  A hospital without its own entry uses the agency-wide `slots`. A hospital's
  endorsement consumes only its own share (rules-enforced).
- **Agencies are network-level and shared**: an agency partners with many hospitals
  (`agencies.partnerHospitalIds`, set by platform_admin; no list = no hospital)
  and funds slices only from partner hospitals (rules-enforced). Slices carry both
  `tenantId` and `agencyId`. An agency reads a patient profile only via
  `users.agencyIds` (written at endorsement). One budget per agency (per-hospital
  sub-budgets are future work).
- ~~A patient belongs to **one** hospital, decided by the access code they register
  with.~~ **Superseded by the patient marketplace (2026-11-14,
  docs/patient-marketplace-plan.md):** a patient account is network-level;
  `users.tenantId` is the patient's CURRENT hospital (where they are filing) and
  `users.tenantIds` every hospital they have filed with. A hospital lists/reads its
  patients through `tenantIds` (`patientWhere()` in src/utils/hospitals.js — use it,
  not `tenantWhere()`, for patient queries); the rules let a patient move
  `tenantId` only together with claiming that hospital's code.
- Reference data = network defaults (`src/data/referenceData.js`) + optional
  per-hospital overrides. Existing production data backfills to **hospital #1**.
- Order is data → queries → rules. Never tighten rules on `tenantId` before the
  data and queries carry it, and never merge a rules change without the tenancy
  rules tests proving cross-hospital access is denied.
- **Rules on existing docs are strict on `tenantId` — never give `resource.data`
  a default** (`get('tenantId', 'hospital-1')`). Rules are checked against a
  query's filters, where an unfiltered field reads as absent, so a default makes
  unfiltered admin queries pass and leak other hospitals' docs (reproduced in
  tests/rules/tenantBoundary.rules.test.js). Every gateway query on tenant data
  must spread `tenantWhere()` (src/utils/hospitals.js).

## Co-funding model (current)
The gateway (the host organization) is the single intake point; agencies only
fund. The patient submits ONE **request** (a bill + amount needed) with the full
required-document checklist and a live selfie. The gateway verifies the documents (OCR-assisted), does ONE remote
async assessment and fills the Unified Intake Sheet, then **endorses** the request
to one or more agencies as child application "slices" toward zero balance. Agencies
do NOT re-review documents or re-assess — they only approve their slice and the
Guarantee Letter issues at approval. See docs/redesign-plan.md.

- **Request lifecycle:** submitted → under_review → assessment → endorsed → partially_funded → fully_funded (or closed / rejected). Patient can withdraw before endorsement. (`assessment` may be skipped in the status field now that entry is no longer stamped by interview booking; the gateway stage machine `verify → assess → endorse` in `src/utils/requestStage.js` drives the queue off docs + intake, not the status.)
- **Slice lifecycle:** endorsed → (patient Proceeds) → reviewing ("For Funding") → approved (GL issued) (or awaiting_info ("Needs Info") / rejected / closed). The patient's Assessment step is derived (`inAssessment()` in src/utils/journey.js: every attached document verified, not yet endorsed); nothing writes status `assessment`. An agency's `amountApproved` is **rules-capped at that slice's endorsed `amountRequested`** (which equals the full request `amountNeeded` — each slice is endorsed for the whole need, not a pre-split portion). So a *single* agency can't approve past the need, but **cumulative over-commitment across multiple agencies IS allowed by design** — the gateway sometimes intentionally over-endorses to give the patient a buffer. ApproveModal shows a soft `overCommit` warning (not a block) when sibling coverage + this approval exceed `amountNeeded`. Per-agency `maxPerApplicant` is a separate hard cap.
- **Repeat limit per agency (rules-enforced; Phase 1, 2026-11-16 — was a fixed 30-day cooldown).** `approvalMarks/{agencyId}__{patientId}` records an agency's latest approval for a patient (plus `byType` per assistance type); the approval must write it in the same transaction. The limit is the agency's own `repeatLimit = { days, perType }` (default 30 days, not per type; 0 = none), set by its Agency Admin on Budget Allocation. Inside the limit the rules (`outsideRepeatLimit` / `repeatOverrideOk`) allow the approval only with a written reason stamped on the slice as `repeatOverride` (audited). The SAME request never counts; a reversal keeps the mark. src/utils/approvalCooldown.js mirrors the rule for the UI.
- **GL settlement (Phase 1):** Mark GL Redeemed records `redeemedAmount` (≤ approved, rules-checked); the full approved amount leaves `budget.committed`, only the actual amount enters `budget.disbursed`. Request funding still counts approved amounts.
- **The letter's own `glStatus` decides (2026-11-16).** A letter exists from approval (its 10 days start then), before the agency's optional "Mark as Issued" (`status` approved → certificate). Funding (web + `syncRequestFinancials`), analytics, the patient's active/past split and countdown, and the agency's Redeem/Expire actions all read `glStatus` whatever the slice status; redeeming at 'approved' also sets 'certificate'. Never key letter logic on `status === 'certificate'` alone.
- **Patient classification = DOH AO 2021-0044 (2026-11-16; reports/DOH patient classification and CoE.md, docs/intake-sheet-fields.md).** Classes `indigent_c3` / `incapacitated_c2` / `incapacitated_c1` / `capable` at 140 / 180 / 220% of the hospital's PSA poverty line per person (`hospitalSettings.povertyLinePerCapita` + `povertyLineYear`, set by the Hospital Admin; nothing hard-coded; stamped on the sheet as `classificationBasis`). Advisory suggestion (4Ps → C3), social worker decides; reason required off-suggestion or for Capable. Old-scale values (`indigent`/`marginalized`/`low_income`/`above_threshold`) stay on old records, labelled "old scale", never reused. The poverty line carries its PSA citation (`povertyLineCitation` / `povertyLineCitationShort` / `povertyLineStatus` interim|current), copied into `classificationBasis`.
- **Certificate of Eligibility (2026-11-16; reports/Certificate of Eligibility layout.md; src/utils/eligibilityCert.js).** No official template exists; layout adapted from DSWD's CoE, a hospital CoE and AO 2021-0044. Generated on the hospital's request page from a completed AO 2021-0044 classification (old-scale ones must be reclassified), numbered `{PREFIX}-COE-{YYYY}-{NNNNN}` from `eligibilityCounters/{tenantId}__{year}`, content frozen in `eligibilityCertificates/{requestId}__{controlNo}` (snapshot). Printed, wet-signed (MSW + noted-by `hospitalSettings.coeNotedByName`), conforme signed, stamped, then the scan is uploaded (base64 + SHA-256, the GL upload modal). Never deleted; a correction voids it and a new number is issued. No peso amounts on it. Read by the hospital, the patient (Track Status) and endorsed agencies. Not an endorse gate. Replace the layout with CRMC's real form when they share it.
- **Funder type (2026-11-17; reports/Legislator funders and anti epal rule.md; src/utils/fundingType.js).** `agencies.fundingType` = `national_program` / `regional_program` / `lgu_program` / `private` (or unset), set only by the Super Admin (rules pin it for agency staff and check the value). A label only — shown with `budget.fundSource` in the hospital's endorse list, the agency suggestion picker, the Agencies list and the agency's Funds page. Private/NGO funds are not government aid, so the FY2026 GAA anti-epal rules (Sec. 19–20) don't reach them; political-office funders paying from private money are typed `private`. Not shown to patients yet (agenciesPublic is a fixed projection).
- **Billing scope (2026-11-16, reports/Hospital billing module for MAPA.md + Hospital billing systems integration.md):** MAPA is NOT the hospital's billing system — no itemized charges, payments, statements, receipts or PhilHealth claims; the hospital's own system (likely iHOMIS) is the record. MAPA keeps coverage and settlement only. `requests.discountsApplied` (senior/PWD discount + VAT exemption, from the bill's discount column) comes off before PhilHealth in `computeAmountNeeded`; absent on older requests. Hospital staff see every guarantee letter (valid / expiring / used / expired, totals per agency) at Export → Guarantee Letters (src/utils/glLedger.js), read-only. Held for the CRMC meeting: a hospital-side "applied to the bill" mark, agency-repaid tracking, and a bill that grows after endorsement.
- **Holding Period (`users.cooldown > 0`, rules-enforced).** Set/lifted only by the patient's CURRENT hospital (Patients page). While on, the patient can't create a request or switch hospitals.
- The assessment lives on the **request** (the gateway-conducted, one remote async assessment via messaging + on-demand Meet; the completed Unified Intake Sheet is the endorse gate). The agency's job is the funding decision only.

### Coverage-model redesign (shipped 2026-10-12, flag-gated)
- **Single source of truth:** `src/data/referenceData.js` holds the assistance-type catalog + required-document rules as declarative requirement records `{ docId, when, quantity?, appliesIf? }` (core + per-type + threshold-conditional), with externalized `THRESHOLDS`. The old editable **Assistance Types / Document Types admin pages were removed** — these are seeded config now (`Seed.jsx` + `scripts/bootstrap-reference-data.js` import `referenceData.js`).
- **Per-assistance-type checklist** behind `VITE_PER_TYPE_DOCS` (default **off** → the legacy flat `required:true` list still runs in prod). On → the checklist resolves per selected type + bill amount. **Gate before enabling in prod:** the gateway confirms the real per-type document sets + thresholds via `docs/document-requirements-checklist.md` (lists are currently research placeholders).
- **PhilHealth is an optional prior-coverage line**, not a mandatory "first" step. `amountNeeded = totalBill − philhealthCovered − otherCovered` is unchanged; only the framing was demoted. Scope was **inpatient hospital bills** (owner decision 2026-10-12); since Phase 2A (2026-11-16) a request is `careSetting` **inpatient** (filed with the final billing statement at discharge, or discharged with an unpaid bill — CRMC: admitted patients file only at discharge, so the bill doesn't grow after endorsement; owner 2026-11-16) or **outpatient** at one of the hospital's own units (`careUnit`: dialysis, chemotherapy, pharmacy, laboratory, clinic; outside providers not covered). Outpatients file the unit's charge slip + the doctor's order instead of the billing statement (documentTypes `requiredWhen` / `careSetting`, resolved by `docTypeRequired()` in src/utils/outpatient.js; `required` stays the legacy every-request flag), dialysis adds the PhilHealth sessions certificate + `philhealthSessionsUsed`, and agencies together may commit at most the outpatient charge (rules-capped; inpatient keeps the over-endorsing buffer). **Phase 2B reuse:** documentTypes carry `reuseMonths` / `reuseFrom` (src/utils/documentReuse.js): Valid ID / PhilHealth ID 12 months from verification; doctor's order and barangay indigency certificate 3 months from the date printed on them, which the social worker records at verification (`documents.issuedOn`). Patients can copy last request's household answers (not medical); staff can reuse a classification from the last 6 months at the same hospital while household size and income are unchanged (src/utils/classificationReuse.js). **Phase 2C agency documents:** each agency's `requirements` (document names) is checked at endorsement as a warning (src/utils/agencyDocs.js; an outpatient's charge slip stands in for the billing statement), and the patient is told what to upload. Coverage-plan uploads carry `requestId` + `addedAfterFiling` (rules: the request must be the patient's own); the hospital sees them as "Added after filing", and verifying one attaches it to the request and gives the endorsed agencies read access. See docs/outpatient-support-plan.md and docs/assistance-model-remediation-plan.md.

## Coding Conventions
- Components in /src/components, pages in /src/pages
- Firestore queries grouped in /src/utils
- All admin actions must call logAudit()
- All notifications use the notify() utility (writes the in-app notification; the server sends the email)
- Use Tailwind utility classes; no inline styles
- Patient-facing strings should be ready for i18n (use t('key') pattern when adding new strings); `npm run lint:i18n` enforces this on patient-facing files
- When building patient-side features in web, keep them mobile-friendly (touch targets ≥44px, large tap areas, readable font sizes on small screens) — the mobile app will reuse the same Firestore data, so the data model should serve both

## Testing & quality gates
- **Tests live in `tests/{utils,components,rules}/`.** Component tests use jsdom + React Testing Library; rules tests use the Firestore emulator; utils tests are pure node.
- **`npm test`** → utils (~3s). **`npm run test:components`** → component smoke tests (~15s). **`npm run test:rules`** → emulator + rules tests (~30s incl. boot). **`npm run test:functions`** → Cloud Function handler tests (~5s). **`npm run test:all`** chains all four.
- **Pre-commit hook** runs utils tests automatically before every commit. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` for trivial / WIP commits. Installed via `simple-git-hooks` on `npm install`.
- **`npm run lint:i18n`** flags hardcoded JSX strings on patient-facing files. Warn-level by design; promote to error when baseline is 0.
- **`npm run budget`** checks the gzipped production bundle against `bundle-budget.json` (run after `npm run build`); CI fails if a bundle grows past budget. First-load weight matters for indigent patients on slow connections — when growth is intended, bump the budget in the same PR and say why.
- **GitHub Actions CI** runs build + utils + component tests + rules tests in parallel on every push to main and every PR. Vercel deploys independently; CI is a separate signal.

## How To Work With Me
- Read this file at the start of every task
- When you write code, match existing patterns in similar files
- Ask before adding new dependencies (npm packages cost build time and complexity)
- Show code changes before writing them so I can review
- For UI work on patient-facing screens, consider both web and future mobile — avoid web-only patterns where possible (e.g., hover-only interactions don't work on mobile)

## Reference Documents (read when relevant)
- docs/redesign-plan.md — the frozen gateway redesign plan (model, lifecycle, phases)
- docs/intake-sheet-fields.md — every field from the gateway's paper intake forms
- docs/sprint-plan.md — current sprint goals
- docs/design-workflow.md — how to combine the design skills + Magic Patterns MCP for web UI work (read before non-trivial reskins)
- docs/reskin-relayout-plan.md — the living tracker of which pages are reskinned/relaid out and what remains (check before touching any page)
- docs/remove-interview-scheduling-plan.md — the interview-scheduling removal → async remote assessment (supersedes docs/appointment-system-plan.md)
- docs/ux-research/ — end-to-end UX study (README + current-state inventory of every page/panel/modal, external benchmarks, and a phased improvement plan). Read docs/ux-research/README.md before any broad UX/reskin work.
- docs/visual-identity/ — the brand source-of-truth (audit, benchmarks, the identity system spec incl. the "care-pin" logomark + palette/WCAG/type, and a reusable research prompt). Read before any logo/brand/theme work. The mark lives at public/brand/mapa-mark.svg + src/components/ui/Logo.jsx (MapaMark).
- docs/patient-abuse-hardening-plan.md — the patient-surface abuse hardening (#1–#5, all shipped); accepted risks recorded in docs/threat-model.md
- docs/assistance-model-remediation-plan.md — the assistance-model remediation (coverage-model redesign shipped 2026-10-12; agency single-source + eligibility/capacity/charging-order still open). `src/data/referenceData.js` is the catalog/requirement source of truth.
- docs/document-requirements-checklist.md — hand to the gateway to confirm the real per-type document sets + thresholds; the gate before enabling `VITE_PER_TYPE_DOCS` in prod.
- docs/multi-hospital-network-plan.md — the multi-hospital tenancy plan (hospital = tenant, shared agencies, platform_admin, phased data → queries → rules rollout)
- docs/outpatient-support-plan.md — outpatient support (planned, not built; waits for the CRMC meeting). Also proposes replacing the per-agency 30-day cooldown with an expense record + per-program repeat intervals.
- (add others as you create them)