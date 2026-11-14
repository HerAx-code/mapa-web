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
  - Google Meet (on demand) was the chosen answer for a live call — free, reliable on weak networks, no infra to run — but it is **not implemented.** `request.meetLink` is rendered in the agency view and **nothing writes it**: there is no producer in any page or Cloud Function, so no link can ever appear. Treat remote assessment as text-only until either the producer is built or the read-side remnant is removed. Building our own video is still NOT planned (see Out Of Scope).
- Notifications: in-app notifications (Firestore) + email (Firebase)
  - **SMS via Semaphore** (semaphore.co, PH-local) — built as a third channel through `api/send-sms.js` + `notify({ sms: true, smsText })`. It's **opt-in per call and paid per segment**, so reserved for high-value, time-critical messages (e.g. approval) with minimal, PII-free copy (RA-10173) — never every notification. Provisioned by setting `SEMAPHORE_API_KEY` in Vercel; unset = the channel no-ops (in-app + email unaffected). Push is planned via Firebase Cloud Messaging when the mobile app ships.
  - When mobile app ships, add push notifications (free via Firebase Cloud Messaging)

## User Roles
- platform_admin — *(multi-hospital Phase 6, not yet deployed)* network operator ("Network Admin"): onboards hospitals + their first admins, owns agencies + reference data, no tenant, **no patient PII** (not in `isAdmin()`). Created only via `scripts/create-platform-admin.mjs`
- super_admin — full access to **its own hospital** (hospital-scoped under multi-hospital tenancy); agencies + reference data move to platform_admin in Phase 6
- staff_admin — operations (no accounts, audit, announcements, coordinators)
- agency — agency portal, own applications only
- patient — patient portal, own data only (self-registers with Patient Access Code)

## Design Principles
- Government-adjacent system. Tone: civic, professional, trustworthy. Not flashy.
- Patient-facing UI must be bilingual (Filipino + English). Use inline bilingual labels where possible. **Enforced** by `npm run lint:i18n` across `src/pages/patient/**`, `src/components/patient/**`, and the shared shell components patients see (Layout, AnnouncementBanner, AnnouncementFeedCard, OfflineBanner, InstallNudge, InstallPrompt).
- **Staff surfaces (agency/admin pages) are English-only by design.** The gateway + partner-agency operators are professionals expected to work in English (clinical / government default language for record-keeping in the Philippines). The eslint linter does NOT enforce i18n on `src/pages/agency/**` or `src/pages/admin/**`. If a future stakeholder reports that staff need bilingual UI, that becomes a scoped epic — adding it to the linter scope requires committing to translating ~30+ staff pages. Not a v1 shortcut.
- Mobile-first thinking for patient screens, even on web. Many patients use phones on slow connections.
- Match the gateway's actual workflow (Client's Information Sheet + Unified Intake Sheet). Don't invent fields they don't use.
- ID verification is **OCR-assisted, social-worker-confirmed**: on-device OCR (tesseract.js) reads the ID name as an advisory cross-check, and a camera-only **live selfie** is compared to the ID by the gateway social worker. No PhilSys, no automated biometrics — the social worker always makes the final call.
- Patient Access Code (`<PREFIX>-YYYY-NNNNN`, default prefix `MAPA`, set via `ORG.accessCodePrefix`) is the registration gate. Issued in person by the gateway office. (`legacyAccessCodePrefixes` is empty — a clean MAPA-only cut; add a prefix there if a future migration needs to keep accepting old codes.)

## Out Of Scope (do NOT build)
- PhilSys API integration
- Real money movement (no bank APIs, no payments). Note: monetary *commitments* ARE tracked as data — approved amounts, agency budgets, Guarantee Letter status. MAPA records intent; actual settlement happens off-system between agency and provider.
- ~~SMS notifications~~ — **now built** via Semaphore (opt-in, high-value messages only). See Communication Channels.
- Custom video calling built on raw WebRTC (own signaling/TURN/SFU/media infra) — **not planned.** Remote assessment is text-only today; an on-demand Google Meet link remains the chosen option if a live call is ever needed. A *managed* embedded-video provider (Daily / LiveKit / self-hosted Jitsi) is a reconsiderable production option only if in-app join friction proves to be a real, observed barrier — never a from-scratch WebRTC build. See Communication Channels.
- Interview appointment / self-service booking system — **removed** (was built, now reversed). Assessment is remote/async; see docs/remove-interview-scheduling-plan.md.
- Donor portal
- Fraud detection engine (manual judgment by social workers)
- ~~Multi-hospital network (one host facility per deployment)~~ — **now in scope** (owner decision 2026-11-13). MAPA is becoming one gateway shared by many BARMM hospitals; see Tenancy below and docs/multi-hospital-network-plan.md.
- Real-time IHOMIS integration (use manual case number reference instead)

## Firestore Collections
users, requests, applications, documents, documentContents, documentTypes, assistanceTypes, agencies, hospitalIds, certificates, conversations, notifications/{uid}/items, reports, announcements, auditLog, docReviewPresence
`hospitals` (multi-hospital tenants; Phase 1)

## Tenancy (multi-hospital network — in progress)
MAPA is moving from one host facility per deployment to **one deployment serving many
hospitals** (docs/multi-hospital-network-plan.md — read it before touching rules,
queries, roles, access codes, or org config). Locked decisions (2026-11-13):
- A **hospital is the tenant**: its gateway staff, patients, access codes, requests,
  documents, intake sheets, conversations, certificates, reports, announcements and
  audit log carry a **`tenantId`** (the `hospitals/{id}` doc id). NOT `hospitalId` —
  that field already means the patient's access code (`hospitalIds` collection). Gateway roles (`super_admin`, `staff_admin`) become
  **hospital-scoped**; a new **`platform_admin`** role runs the network (onboards
  hospitals/agencies, aggregate analytics, no patient PII).
- **Agencies are network-level and shared**: an agency partners with many hospitals
  (`agencies.partnerHospitalIds`, set by platform_admin; no list = hospital #1 only)
  and funds slices only from partner hospitals (rules-enforced). Slices carry both
  `tenantId` and `agencyId`. An agency reads a patient profile only via
  `users.agencyIds` (written at endorsement). One budget per agency (per-hospital
  sub-budgets are future work).
- A patient belongs to **one** hospital, decided by the **per-hospital access-code
  prefix** they register with (prefixes globally unique).
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
- **Slice lifecycle:** endorsed → (patient Proceeds) → reviewing ("For Funding") → approved (GL issued) (or needs_info / rejected). An agency's `amountApproved` is **rules-capped at that slice's endorsed `amountRequested`** (which equals the full request `amountNeeded` — each slice is endorsed for the whole need, not a pre-split portion). So a *single* agency can't approve past the need, but **cumulative over-commitment across multiple agencies IS allowed by design** — the gateway sometimes intentionally over-endorses to give the patient a buffer. ApproveModal shows a soft `overCommit` warning (not a block) when sibling coverage + this approval exceed `amountNeeded`. Per-agency `maxPerApplicant` is a separate hard cap.
- The assessment lives on the **request** (the gateway-conducted, one remote async assessment via messaging + on-demand Meet; the completed Unified Intake Sheet is the endorse gate). The agency's job is the funding decision only.

### Coverage-model redesign (shipped 2026-10-12, flag-gated)
- **Single source of truth:** `src/data/referenceData.js` holds the assistance-type catalog + required-document rules as declarative requirement records `{ docId, when, quantity?, appliesIf? }` (core + per-type + threshold-conditional), with externalized `THRESHOLDS`. The old editable **Assistance Types / Document Types admin pages were removed** — these are seeded config now (`Seed.jsx` + `scripts/bootstrap-reference-data.js` import `referenceData.js`).
- **Per-assistance-type checklist** behind `VITE_PER_TYPE_DOCS` (default **off** → the legacy flat `required:true` list still runs in prod). On → the checklist resolves per selected type + bill amount. **Gate before enabling in prod:** the gateway confirms the real per-type document sets + thresholds via `docs/document-requirements-checklist.md` (lists are currently research placeholders).
- **PhilHealth is an optional prior-coverage line**, not a mandatory "first" step. `amountNeeded = totalBill − philhealthCovered − otherCovered` is unchanged; only the framing was demoted. Scope is **inpatient hospital bills** (owner decision). See docs/assistance-model-remediation-plan.md.

## Coding Conventions
- Components in /src/components, pages in /src/pages
- Firestore queries grouped in /src/utils
- All admin actions must call logAudit()
- All notifications use the notify() utility (writes to Firestore + sends email)
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
- (add others as you create them)