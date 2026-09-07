# MAPA Revision List

**Project:** Medical Assistance Portal Access (MAPA) — Cotabato Regional Medical Center
**Status:** Updated 2026-06-07
**Scope:** All revisions from the bilingual rollout through the CRMC-gateway redesign through the read-pass review series, the operator-throughput follow-up, the first-visit guided tour batch, the full-system 46-page audit + sweep, the post-pilot live-session audit round 2 (R13–R29), the demo-account maintenance trio + Spark plan write-quota investigation, the post-quota recovery push (reference-data seeder, agency logo support, full-database backup, defense-demo scenario, sidebar gap fix R31, BARMM location dropdowns R32), and **the Inter-Agency Coordination Plan Phase 1 (R33 Activity Timeline + R34 Watcher Subscriptions + R35 Live Over-Commitment Guard)**.

---

## Part A — Adviser Revision List Compliance

The list below maps each adviser-issued revision to the action taken in the codebase. Commit hashes provide traceability against the project's git history.

| # | Revision | Status | Action Taken | Commit |
|---|---|---|---|---|
| 1 | Agency announcements | Done | Agency-side promotions feature added; later reframed as program promotions to fit the co-funding model. Staff Admin and Super Admin both have announcement authority via `/admin/announcements`. | `b94f5ec`, `ec09d24` |
| 2 | Remove the Available Codes panel (in Super Admin and Staff Admin) | Done | Available-codes panel removed from admin surfaces during the phase-1 admin revisions. | `6f688ba` |
| 3 | Temporary password in agency account setup should be auto-generated | Done | `generateTempPassword()` utility wired into the Add Coordinator modal and admin account creation, with show/hide + copy + regenerate UI. | `6f688ba` |
| 4 | Agency list should be sorted properly (ascending / descending sort) | Done | Sortable column headers on the admin Agencies list. | `6f688ba` |
| 5 | The Agency Admin should add members (not the Super Admin or Staff Admin) | Done | New `agency_admin` role introduced. The `agency/Team` page is restricted to agency_admin and is the only path for adding coordinators. CRMC admins can view the agency's team from `admin/AgencyDetail` and (super_admin only) deactivate or delete, but cannot create. | `f2b48ec` + `agency/Team.jsx` (whole-page restriction) |
| 6 | Fix the application process (Application Submitted → Under Agency Review → Interview Scheduled → Application Approved) | Done (re-shaped by the CRMC-gateway redesign) | The lifecycle now lives on two levels. Patient-facing request: Submitted → Under Review → Assessment (interview here) → Endorsed → Partially / Fully Funded. Each per-agency funding slice has its own lifecycle: Endorsed → For Funding → Approved → GL Issued. Both are visualized on patient TrackStatus and on the agency ApplicationDetail page. | Sections B.1–B.50 of the changelog + `2d9f549` (slice stepper), `50fc5ee` (Timeline derived from status) |
| 7 | Fix the coordination of Agency and Super Admin / Staff Admin | Done | Direct-messaging shortcuts on both sides — agency "Message CRMC" button, CRMC "Message Patient" and "Message Agency" buttons; cross-slice coverage warnings ("X rejected — re-endorse", "Y awaiting patient") on the CRMC Requests list; CRMC notes flow through to the agency's Approve modal. | `c84c61a`, `c9b818a`, `6ec525b`, `be1ffb3` |
| 8 | All medical assistance requests go to CRMC admins first, then CRMC endorses to the particular agency (Endorse > Verify > Approve) | Done — this is the CRMC-gateway redesign | Patient submits one request → CRMC verifies documents + completes the Unified Intake Sheet + conducts the assessment interview + endorses to one or more agencies as funding "slices" → each agency makes its own funding decision. Agencies no longer accept direct applications. | Entire Section B (the redesign): `ef8e4c0`, `581c7ce`, `a8dc8b8`, `2cc6f0b`, `585ce2b`, `c4c9d0f`, `ed6487b`, `2f68dd6`, `453e600`, `71a037b`, `a37c966`, `15c3fc3`, `dc42836` (multi-agency split), `f9d4929` (pure-selection model) |
| 9 | The Staff Admin can make announcements | Done | `/admin/announcements` route allows both `super_admin` and `staff_admin` roles. | App.jsx route configuration |
| 10 | Inputting locations should be a dropdown (populate with areas in the BARMM region) | Done | Registration uses cascading location dropdowns populated from Bangsamoro Autonomous Region in Muslim Mindanao (BARMM) data. | `25b3131` |
| 11 | The Agency should review documents (not the Super Admin or Staff Admin) | Done — solved differently (more efficient) | The adviser asked for per-agency document review. Our solution: CRMC centralizes document verification once at intake, then the verified documents flow with the endorsement to every agency. Rationale: (a) the patient uploads documents once instead of re-uploading per agency, (b) all agencies see consistent verified documents, (c) a single social-worker assessment determines eligibility instead of N redundant agency reviews, (d) this matches the actual CRMC Malasakit Center workflow. Agencies still **read** the documents for their funding decision; they just don't re-verify them. | `96728d7` (agencies read), `5d3dcf1` (docs inside request), `f4f0670` (CRMC doc verify flow polish) |
| 12 | The document will be uploaded when applying for medical assistance | Done | Documents are uploaded inside the request submission flow (4-step wizard). The standalone "My Documents" page was retired since documents now live with their request. | `5d3dcf1`, `141eb57` |

**All 12 adviser revisions are complete.**

---

## Part B — Full Revision Changelog

Organized by phase. Each row lists the change and the git commit for traceability.

### B.0 — Pre-redesign foundation

UI / UX audits, mobile-first hardening, PWA capability, and race-condition fixes that landed before the CRMC-gateway pivot.

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 0.1 | Initial bilingual rollout + UI/UX audit + Vercel config | Mass rollout of FIL/EN locales and first-pass review | `2ec0d67` |
| 0.2 | Second-pass patient UI/UX audit | 20 fixes | `8255be4` |
| 0.3 | Third-pass registration UI/UX audit | 15 fixes | `3b4c639` |
| 0.4 | Login UI/UX audit | 12 fixes | `bafc869` |
| 0.5 | Workflow audit tier 1 (race conditions) | 4 race conditions fixed | `d5b9b84` |
| 0.6 | Workflow audit tier 2 | SLA visibility, GL expiry, deletion guard, stolen-code recovery, meet-link validation | `c8e6b5e` |
| 0.7 | Workflow audit tier 3 | notify error log + orphan cleanup script | `252f47a` |
| 0.8 | Workflow audit "future tier" | Disable cascade, hospital-ID cooldown, verify rate limit | `fdc9b74` |
| 0.9 | Coordinator-pages audit | 4 critical fixes + tier-2/3 polish | `e7d5df4`, `f55a546` |
| 0.10 | Cross-cutting cleanup | GL_VALIDITY_DAYS consolidation + Inbox / GLViewer polish | `65c737f` |
| 0.11 | Pre-pilot operational runbook | Cleanup workflow + checklist doc | `5ec3cc8` |
| 0.12 | Patient mobile feel | Bottom tab bar, slim drawer, dedicated More page, responsive modals, touch targets, page transitions | `7eb5545`, `c7e80c8`, `0097d93`, `596b80f`, `6680204`, `e0bb7bd`, `f63f505`, `13b62ba`, `6bf8053`, `d26dc78`, `6423679`, `87de796`, `347de59`, `d909afe` |
| 0.13 | Patient Dashboard polish | Dismissible welcome, status-line greeting, code-split, title-cased name | `5980553`, `45109f2`, `658a4dd` |
| 0.14 | PWA capabilities | Installable patient app, /install page, skipWaiting+clientsClaim, hide marketing in PWA, gate PWA for non-patients | `1fac07d`, `41989d4`, `3c43325`, `71f4a04`, `7596ed9`, `2fa7f27`, `4fb2f6a` |
| 0.15 | Admin IA cleanup | Agency staff live under their agency, not in a flat global list | `f2b48ec` |
| 0.16 | Demo data | 1 agency_admin + 1 coordinator per agency (8 users) | `924faf8` |
| 0.17 | Email notifications | Queue via Vercel serverless + Gmail SMTP (no Firebase Blaze needed) | `f182ee3`, `d50de4b` |
| 0.18 | Auth rule fix | Patient registration hospitalIds claim chicken-and-egg | `8846ff0` |
| 0.19 | AuthContext orphan deletion | Stop auto-deleting orphan auth on every state change | `f30adaa` |
| 0.20 | Apply flow permission-denied | Fix slot decrement rule + log catch errors | `e3e5867` |
| 0.21 | Approve flow same-agency cooldown scope | Dodge rule denial | `7ad4fde` |
| 0.22 | Agency announcements (adviser item 1) | Implemented | `b94f5ec` |
| 0.23 | BARMM cascading location dropdowns (adviser item 10) | Implemented | `25b3131` |
| 0.24 | Admin revisions phase 1 | Codes card removed, auto-generated passwords, sortable lists, member-adding flow, announcements | `6f688ba` |
| 0.25 | Thesis documentation | `docs/thesis-documentation.md` written | `b5670c6` |

### B.1 — CRMC-gateway redesign (the pivot)

The frozen redesign from patient-applies-direct-to-agency to patient-files-one-request → CRMC verifies + endorses → agencies fund slices toward zero balance.

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 1.0 | Redesign plan document | `docs/redesign-plan.md` frozen | `df0ed19` |
| 1.1 | Co-funding milestone 4a/4b | Request model + patient submission | `ef8e4c0` |
| 1.2 | Co-funding 4c-1 | CRMC endorsement workspace | `581c7ce` |
| 1.3 | Co-funding 4c-2 | Close the funding loop on agency approval | `a8dc8b8` |
| 1.4 | Co-funding 4d | Slice cap on approval + co-funding-aware cooldown | `2cc6f0b` |
| 1.5 | Co-funding 4e-1 | Patient funding tracker | `585ce2b` |
| 1.6 | Document handling under co-funding | Upload inside request; agencies review (moved from CRMC); document view + re-upload in active request | `5d3dcf1`, `96728d7`, `b6fdc40` |
| 1.7 | Legacy cleanup cutover | Remove CRMC Doc Review page; remove My Documents page; retire per-agency apply flow | `0f60916`, `141eb57`, `d1341d0` |
| 1.8 | Request redesign R1 | Required documents per assistance type | `cb2bf36` |
| 1.9 | Request redesign R2 | Type-driven required documents | `c8e49a5` |
| 1.10 | Request redesign R3 | Patients land on Request Assistance | `559bd96` |
| 1.11 | Request redesign R4a | Agency procedure / instructions field | `f1f2721` |
| 1.12 | Request redesign R4b | Coverage plan + per-agency compliance | `ebeefe3` |
| 1.13 | Request redesign Proceed gate | Explicit Proceed step (patient accepts coverage plan) | `89477ba` |
| 1.14 | Post-redesign fixes | Handle 'endorsed' status + correct stale copy | `e9cf5fa` |
| 1.15 | Request form copy | Patient states amount needed, not coverage figures | `855faf5` |
| 1.16 | Request docs | Require only billing statement; drop per-type required docs | `56cf7fe` |
| 1.17 | Request: replace on-file billing | Patient can swap an existing billing statement | `ee55f1d` |
| 1.18 | Reframe agency announcements as program promotions | Aligned to co-funding model | `ec09d24` |
| 1.19 | Patient copy update | Co-funding language; drop dead screening strings | `5cede3a` |
| 1.20 | Co-funding breakdown on agency app view | Sibling slice visibility | `d75c136` |
| 1.21 | Retire per-agency Screening page | Co-funding doesn't need it | `8d3f4cd` |
| 1.22 | Redesign P1–P2 | New lifecycle states + document-type flags | `c4c9d0f` |
| 1.23 | Redesign P3 | Full document checklist + on-device OCR + selfie capture | `ed6487b` |
| 1.24 | Redesign P4 | CRMC request hub as guided stepper | `2f68dd6` |
| 1.25 | Redesign P4d | Relocate Unified Intake Sheet into CRMC hub | `6df8493` |
| 1.26 | Redesign P5 | Agency becomes funding-only | `453e600` |
| 1.27 | Redesign P6 | Agency dashboard reflects funding-only role | `71a037b` |
| 1.28 | Redesign P7 | Docs, rules, guide for the CRMC-gateway model | `a37c966` |
| 1.29 | Redesign P8 | Representative (filed-by) path | `15c3fc3` |
| 1.30 | Track co-funding request on My Application | Patient sees aggregate progress | `133bba1` |
| 1.31 | Point patient Interviews + Dashboard at the request | Co-funding shape | `ecde3c1` |
| 1.32 | Intake split | Patient fills facts; CRMC fills assessment | `4c715e8` |
| 1.33 | Elderly-friendly bilingual intake wizard | Multi-step large-text form | `82d33a3` |
| 1.34 | Patient active-request declutter | Compact view | `cc65c1c` |
| 1.35 | Patient request as 4-step wizard | Guided submission | `6ab03f2` |
| 1.36 | Standardize patient-side layout | Consistent widths, left-aligned, fix stale copy | `e014835`, `1de1f4a` |
| 1.37 | Mobile overflow fix on upload rows | Document + representative paths | `a80e790` |
| 1.38 | Document viewer hardening | No more blank PDF box; PDF via `<object>`; no auto-download | `aff2d63`, `ad34c07` |
| 1.39 | CRMC request detail rework | Full-page side-by-side workspace; single column + large viewer; in app shell | `df69f8d`, `65ca06b`, `a9aea0b` |
| 1.40 | Requests list rework | Searchable table + filter + stage chips | `feb967e` |
| 1.41 | Cross-slice coverage warnings | "Rejected — re-endorse", "Awaiting patient" chips | `6ec525b` |
| 1.42 | Polish CRMC admin surfaces | Requests list / detail, case assessment, dashboard | `56b1756` |
| 1.43 | Reconcile agency surfaces with co-funding | End-to-end review | `af51e33` |
| 1.44 | Close CRMC ↔ agency coordination loop | Messaging shortcuts | `c84c61a`, `c9b818a` |
| 1.45 | GL viewer behavior | Open in same tab; render inside app shell; hide shell during print | `ed4da10`, `ca35f5a` |
| 1.46 | Page review fixes | Two button issues | `e2d81f6` |
| 1.47 | Multi-agency split endorsement | One CRMC endorsement → N slice apps | `dc42836` |
| 1.48 | Per-applicant cap modeling | PCSO ₱25K, DSWD tiers; soft at endorse, hard at approve | `96df0b7` |
| 1.49 | Pure-selection endorsement | CRMC picks WHO; agencies decide HOW MUCH | `f9d4929` |
| 1.50 | Intake Sheet renamed | "Case Assessment" + when-to-fill banner; visible column headers; widened Age column | `14dfc45`, `5f5ee94`, `dcd02a4` |
| 1.51 | Interview scheduling | "Generate Meet" shortcut via meet.new | `c4aafc0` |

### B.2 — Infrastructure / rules / data backfills

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 2.1 | Documents agencyIds scoping | Agencies only read docs of requests they hold a slice for | `71e1950` |
| 2.2 | Documents backfill | Seed-page backfill for legacy `documents.agencyIds` | `001a247` |
| 2.3 | Rule cleanup | Removed `('agencyIds' in resource.data)` transitional fallback | `f497a79` |
| 2.4 | Daily slot reset reliability | Scheduled Cloud Function (Blaze-ready); mirror lazy reset on CRMC Requests page | `1fb6537`, `395cd15` |
| 2.5 | Slot-return race | Wrapped slot-restore paths in `runTransaction` | `1e9f4fb` |
| 2.6 | Patient Proceed atomicity | Single writeBatch for all endorsed slices; silenced best-effort catches logged | `0cd6b94` |
| 2.7 | Native dialogs replaced | `window.confirm` → in-app `ConfirmModal` everywhere | `d5914e0`, `c792357`, `7893e2d` |
| 2.8 | Signed GL scans to Storage | Lift 700KB PDF base64 ceiling | `b888fa9` |
| 2.9 | Storage reverted to base64 | Spark plan can't use Cloud Storage on post-Oct-2024 projects | `923a9e2` |
| 2.10 | Signed GL upload supports PDF | Not just JPG / PNG | `f0a41d3` |
| 2.11 | Approve flow diagnostics | + bell navigates on patient mobile | `4ca0b21` |

### B.3 — Read-pass review series: co-funding slice surfaces

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 3.1 | Patient TrackStatus slice stepper | 4-stage for slices; legacy 6-stage for direct apps | `2d9f549` |
| 3.2 | Patient TrackStatus slice banners | Endorsed / awaiting_info / reviewing banners with appropriate CTAs | `8dcdba4` |
| 3.3 | Patient request withdraw (pre-endorsement) | "Withdraw Application" button; notifies CRMC; gated to pre-endorsement statuses only | `c3949f8` |
| 3.4 | Agency ApplicationDetail Timeline | Derive from status; drop dead `stages:` writes everywhere | `50fc5ee` |
| 3.5 | Same-tab GL viewer + co-funding statuses on agency Logs | UX consistency | `90412db` |
| 3.6 | Co-funding statuses on admin tools | + console.error breadcrumbs across admin surfaces | `6d96ae3` |

### B.4 — Read-pass review series: real correctness / money bugs

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 4.1 | admin/Patients query missing `endorsed` | Added to active-applicant query | `6d96ae3` |
| 4.2 | 20 onSnapshot listeners hung silently on permission errors | Sweep added error callbacks everywhere | `cf81595` |
| 4.3 | Interview reminder dedup broken | Firestore rules denied writes; switched to localStorage | `3a71c71` |
| 4.4 | New-model interviews never reminded | Sweep over requests added (CRMC-conducted) | `3a71c71` |
| 4.5 | agency/Allocation budget overwrite race | Dotted-field updates; committed / disbursed never overwritten | `d1090a3` |
| 4.6 | admin/HospitalIDs revoke / delete non-atomic | `writeBatch` for atomicity | `3abed72` |
| 4.7 | Orphan Firebase Auth user on setDoc failure | `deleteUser` rollback in both Accounts + Team paths | `fa4f584` |
| 4.8 | patient/Interviews PH timezone bug | Today's interview mis-classified for 8h every morning | `a650eb1` |
| 4.9 | agency/ApplicationDetail.days legacy-data crash | Defensive `tsToDate()` | `65f7cb5` |
| 4.10 | agency/ApplicationDetail dead `endorsing` branch | Simplified | `65f7cb5` |
| 4.11 | patient/RequestAssistance pctBill NaN guard | `Number(amt) \|\| 0` | `4ebc330` |
| 4.12 | agency/ApplicationDetail patientDocs frozen | `getDoc` → `onSnapshot` | `65f7cb5` |
| 4.13 | agency/Inbox `days >= N` treats null as fresh | Explicit null branch | `54fa126` |
| 4.14 | admin/Requests stale committed reads | Use slice-derived `computeFunding()` everywhere | `f4f0670` |
| 4.15 | admin/Requests `allSlices` listener loaded everything | Scoped to active statuses + rejected | `f4f0670` |
| 4.16 | admin/Requests dead `sliceStages()` writes | Dropped at endorsement | `f4f0670` |

### B.5 — Read-pass review series: UX gaps closed

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 5.1 | Empty-state dead ends on 14 filterable lists | "Clear filters" CTAs (3 rounds) | `458cda9`, `e06cf62` |
| 5.2 | Pristine empty states on 4 creatable pages | "Create First X" CTAs | `adbb473` |
| 5.3 | Patient CTAs below 44 px touch floor | 7 buttons bumped + IntakeWizard + Interviews | `0cfdd2f`, `a650eb1`, `1c6f724` |
| 5.4 | admin/Requests document reject without reason | ConfirmModal with reason; reason → patient notification + persists | `f4f0670` |
| 5.5 | admin/Requests no un-verify path | "Reset to Pending" button on verified / rejected docs | `0d5e7b3` |
| 5.6 | admin/Requests no Message Patient on detail | Sub-header button | `be1ffb3` |
| 5.7 | admin/Requests interview outcome buttons quiet | Real button affordance (Completed primary / No-show destructive / Reschedule secondary) | `4a902f4` |
| 5.8 | patient/IntakeWizard validation didn't highlight missing field | Red ring + scroll-into-view | `16fca95` |
| 5.9 | patient/IntakeWizard no auto-save | Debounced 2s + immediate on step change + "Saved · 2:45 PM" indicator | `16790ba` |
| 5.10 | patient/IntakeWizard Review showed only 3 of 10 fields | All sections + per-section Edit link | `1c6f724` |
| 5.11 | patient/IntakeWizard Save-and-finish was hidden text link | Promoted to visible secondary button | `1c6f724` |
| 5.12 | patient/Interviews `conductedBy` invisible | "With {name}" subtitle | `a650eb1` |
| 5.13 | patient/RequestAssistance no copy-ID on active view | Clipboard button (mirrors success screen) | `4ebc330` |
| 5.14 | patient/RequestAssistance OCR-unreadable low contrast | Bumped gray → amber | `4ebc330` |
| 5.15 | patient/Dashboard docStats stale | `getDocs` → `onSnapshot` | `3a71c71` |
| 5.16 | agency/Funds invisible audit context | actor + payableTo via row tooltip | `e16eda5` |
| 5.17 | agency/Team + admin/AgencyDetail role-change double-click | Busy state + busy-guarded modal close | `af0477b`, `a159f82` |

### B.6 — Read-pass review series: code quality / consolidation

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 6.1 | STATUS_CONFIG drifted across 6 pages | Canonical at `utils/constants.js`; all via `<StatusBadge kind="…">` | `ba83b71`, `ff8a51e` |
| 6.2 | i18n orphan keys | 124 removed; en / fil parity maintained | `fbef147` |
| 6.3 | Dead admin/Funds.jsx | Deleted | `cf81595` |
| 6.4 | InterviewModal misplaced in `components/agency/` | Moved to `components/InterviewModal.jsx` | `c4eb21e` |
| 6.5 | admin/Accounts review batch | Fragment key, colSpan, missing catches, onSnapshot error, empty-state filter check | `fbef147` |
| 6.6 | admin/AgencyDetail self-delete inline → ConfirmModal | Unified with other destructive ops | `7379702` |
| 6.7 | agency/Inbox timestamp helpers consolidated | Single `tsToDate` + `daysSince`; `formatDate` routes through | `54fa126` |
| 6.8 | agency_admin badge color inconsistent | agency/Team → purple (matches admin convention) | `47f24a1` |
| 6.9 | Funds peso / helpers hoisted | Module-level | `65f7cb5` |
| 6.10 | admin/AgencyDetail empty catch + silent snapshot handlers | console.error added; busy state on promotion | `a159f82` |
| 6.11 | agency/Team empty catches + empty-state CTA + promotion busy | Three small fixes | `af0477b` |
| 6.12 | agency/Funds dead import + audit-log link | MdRefresh dropped, audit-log linked for agency_admin | `e16eda5` |
| 6.13 | admin/HospitalIDs filter chip toggle + search clear-X | UI consistency with sibling pages | `3abed72` |

### B.7 — Operator-throughput follow-up batch

Five focused operator productivity + data-integrity wins shipped after the read-pass series stabilized.

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 7.1 | `isGLExpired` duplicated in agency/Inbox + agency/ApplicationDetail | Consolidated to `utils/constants` so the canonical answer is shared across all GL surfaces | `591f688` |
| 7.2 | admin/Requests doc verification was one-at-a-time | "Verify all pending (N)" bulk action via single `writeBatch` for the common case where every doc looks fine | `01546dc` |
| 7.3 | GL state surfaced "Expired (action needed)" only AFTER lapse | Added `isGLExpiringSoon` + `glDaysRemaining` + amber "GL expires in Nd" chip on Inbox + ApplicationDetail header + urgency hint copy on action banner | `34c0a51` |
| 7.4 | admin/HospitalIDs had no print view despite codes being issued in person | "Print Available" — 4-up A4 cards with dashed cut lines, derived registration URL, audit-logged issuance | `7b48c95` |
| 7.5 | `tsToDate` defensive Firestore Timestamp converter duplicated in 6 files | Extracted to `utils/dates.js`; 6 files swapped to imports (start of the sweep finished in §B.10) | `d01a910` |

### B.8 — First-visit guided tour batch

DIY Canva-style tour on each role's dashboard so first-time users get a 4-step walkthrough of the key elements. Reusable `<Tour>` component, no library dependency.

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 8.1 | New users had no orientation on any of the three dashboards | `<Tour>` component (portal + dim overlay + pulsing spotlight + tooltip card); 4-step tours on patient / agency / admin dashboards; bilingual EN+FIL on patient; per-user localStorage dismiss flag | `e5e3ad8` |
| 8.2 | No way to re-watch the tour without DevTools | "Show welcome tour again" affordances: patient More → Settings; agency + admin dashboard footer link; `resetTourFlag()` helper | `784490a` |
| 8.3 | TrackStatus also dense (request + slice steppers) but had no tour | 3-step tour on patient TrackStatus; gracefully centers when slice cards don't exist yet (freshly-submitted state) | `4caa9c5` |
| 8.4 | Thesis doc didn't cover the tour feature | New §9.6 cross-cutting onboarding subsection + §11.2 test scenarios block + §5.3 components/utils tree updates | `ef68799` |

### B.9 — Demo accounts investigation + repair

Root-cause investigation of "some demo accounts vanished from the dev panel" surfaced the orphan-Auth pattern that drives §B.10 #29 below.

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 9.1 | Demo accounts on the Seed page couldn't be repaired after deletion | Root cause: admin/Accounts Delete only removes the Firestore profile; the Auth account stays orphaned, and Seed printed "Already exists" + skipped, so the email was permanently broken. Self-healing Seed: on `auth/email-already-in-use`, sign in with the demo password, check whether the Firestore profile exists, recreate it if not; failed sign-in (wrong password) surfaces a clear "delete from Firebase Console" message | `b528914` |

### B.10 — Full-system 46-page audit

Second audit pass — explicitly avoiding the subagent-skim that produced false positives the first time. Every page read directly against its actual source. Ran in three batches (Patient + Auth = 13 pages, Agency = 16 pages, Admin = 17 pages) and produced bugs #22 through #31 plus a thesis doc §6.2 schema realignment (#28).

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 10.1 | patient/MedicalPrograms agency-list sort crashed on null `name` | `(a.name ?? '').localeCompare(...)` — one corrupt agency doc no longer wipes the page | `f597044` |
| 10.2 | Notifications select-all toggled `notifications.length` but checkbox state used `filtered.length` | Scoped selectAll to `filtered` so what gets selected matches what's on screen | `f597044` |
| 10.3 | patient/Guide statuses section described the legacy direct-to-agency lifecycle | Rewrote with NEW "What is co-funding?" section, NEW Intake Wizard section, NEW request-lifecycle section, restructured statuses as per-slice journey. Bilingual EN+FIL. Plus a search box across the whole Guide | `1ee194a` |
| 10.4 | agency/GLViewer wrote to deprecated `applications.stages[]` field on Mark-as-Issued | Dropped the `stages:` field from the updateDoc | `02fcc9b` |
| 10.5 | agency/CertificateGenerator read `app.stages` to look up approvedStage.date | Removed dead lookup; reads `app.approvedAt` directly | `02fcc9b` |
| 10.6 | agency/Logs sort used `.seconds` (Firestore-only) | Switched to `tsToDate(b.submittedAt)?.getTime()`; also migrated inline formatDate to the shared helper | `91e7350` |
| 10.7 | Thesis §6.2 auditLog schema listed wrong field names (`actor`/`actorUid`/`at`) | Realigned to actual names from the writer (`actorName`/`actorId`/`createdAt`); §7.3 broad-write surfaces paragraph also updated | `c5609d1` |
| 10.8 | admin/Reports rendered an unreachable "Budget Request quick-facts callout" | Removed dead branch | `84ab693` |
| 10.9 | admin/Patients sort `.seconds` legacy break + no orphan-Auth delete warning | Same `tsToDate` sort fix + new amber callout in the permanent-delete modal | `12517ba` |
| 10.10 | admin/Accounts + admin/AgencyDetail Delete modals never explained the orphan-Auth constraint | Added explicit warning to both: "Firebase Auth can't be deleted from the browser — the email stays registered until you also remove it from Firebase Console" | `dc0c294` |
| 10.11 | admin/AddAgency: agency created BEFORE admin Auth + sign-out BEFORE setDoc | Reordered: create admin Auth + profile first (with `deleteUser` rollback on setDoc failure), then create agency with `deleteDocSafe` rollback on the admin profile if agency creation fails. Atomic-feeling outcome — either both succeed or neither does | `ee3807f` |
| 10.12 | Thesis doc didn't cover the audit batch | §11.3 expanded to describe the second pass; §11.4 11 new rows (bugs #21-31); §11.5 three new acknowledged items (orphan-Auth Cloud Function gap, AppLogs server-side search, AddAgency rare step-2 Auth leak) | `38d76f2` |
| 10.13 | Landing route inconsistency: signed-in patient sent to `/patient/request` from map but `/patient/dashboard` from fallback | Picked `/patient/dashboard` for consistency with the home-base pattern; also extracted `CRMC_GATEWAY_NAME/INITIALS/COLOR` constants used by patient/Interviews | `671dc86` |

### B.11 — Targeted UX wins + cross-cutting consolidation

Four focused improvements + one anti-drift refactor shipped after the audit.

| # | Item | Action Taken | Commit |
|---|---|---|---|
| 11.1 | Audit logs were COA-defense-grade but had no CSV export | Added Export CSV to both agency/AuditLog and admin/AuditLog. Exports the currently-filtered rows so an auditor's narrow request maps 1:1 to the file. Disabled while loading or when filtered is empty | `b795fd6` |
| 11.2 | admin/ExportPreview could thoughtlessly export 50K+ rows | Added `LARGE_EXPORT_THRESHOLD = 10000` ConfirmModal warning. Above the threshold the Download click prompts for confirmation explaining the cost; below, downloads fire immediately (unchanged) | `3cea7f0` |
| 11.3 | agency/CertificateGenerator had no aging cue on forgotten approved-but-unsigned GLs | Inline chip next to state label: hidden under 3 days, amber 3-6 days, red 7+ days. Drives operator triage on un-signed/un-uploaded GLs that hold committed budget hostage. Also migrated inline formatDate to the shared helper | `fc1c847` |
| 11.4 | agency/Inbox sorted newest-first only; backlog triage required scrolling | Sort toggle: "↓ Newest first" (default, arrival order) ↔ "↑ Oldest first" (triage view, brings overdue rows to top). Also fixed snapshot sort using `.toMillis?.()` which broke on legacy Date/ISO data | `e94fcd5` |
| 11.5 | Layout's live announcement banner and the admin/Announcements form preview used two separately-written JSX blocks with two config maps (drift risk) | Extracted `<AnnouncementBanner>` component as single source of truth. New `utils/announcements.js` owns `TYPE_CONFIG` (breaks the circular import from putting it in admin/Announcements). Layout + preview now render via the same code path | `5e41218` |

### B.12 — `tsToDate` consolidation sweep (finish)

Continuation of §B.7 #7.5. The inline `ts.toDate ? ts.toDate() : new Date(ts)` pattern was duplicated across 26 files; this batch eliminated the remaining 20 sites so the pattern now exists in exactly one place — `utils/dates.js`, where it belongs.

| # | Batch | Files | Commit |
|---|---|---|---|
| 12.1 | 5 high-touch files | Layout, NotificationModal, Notifications, patient/Dashboard, patient/TrackStatus | `4ba96c0` |
| 12.2 | Agency batch | agency/AuditLog (3 sites), Dashboard (2), Program, Team | `3b1e398` |
| 12.3 | Final batch (16 files, 27 sites) | All 12 admin pages with the pattern + agency/CertificateGenerator + agency/ApplicationDetail (4 cooldown sites) + agency/ApplicationModals + utils/intakeSheetHTML | `46a1196` |
| 12.4 | Thesis doc close | §11.4 #19 expanded to reflect full migration arc; §11.5 acknowledged item removed (no longer accurate) | `eb51812` |

### B.13 — Live-browser audit follow-ups (Playwright)

Findings from driving the system live via Playwright at mobile (375×667) and desktop (1280×800) viewports. Three were shipped same-day in commit `d891f64` (L1 RequestAssistance slices permission-denied, L2 bottom tab "Apply" misleading label, L3 Login vs Landing route inconsistency). The remaining four were triaged in this batch:

| # | Bug | Status | Resolution |
|---|---|---|---|
| 13.1 | **L4** admin avatar showed "U" instead of "SA" for super_admin | ✅ Shipped (`1afb7cd`) | Root cause: Firestore user doc for `admin@crmc.gov.ph` has `displayName` ("System Administrator") but no `name` field — likely an older seed or manual edit. Layout reads `user.name` everywhere → undefined → getInitials fallback "U". Defensive fix: `userDisplayName = user.name \|\| user.displayName \|\| ROLE_LABEL_SHORT[role]`, applied across all three Layout avatar/name call sites. getInitials also made null-safe |
| 13.2 | **L5** Tour Skip button delayed dismissal | ⏳ Deferred | Investigated `finish()` in components/Tour.jsx — `setActive(false)` logic is correct. The "delay" observed via Playwright is likely a test-harness artifact: the snapshot was taken in the same tick as the click, before React's re-render committed. In normal human use, the next paint reflects the dismissed state. To fix conclusively would need an isolated React Testing Library reproduction; not worth the time unless real users report it |
| 13.3 | **L6** notification bell badge inconsistent across patient pages | ⏳ Deferred | Investigated Layout.jsx — the unread-count subscription is correctly Layout-scoped, but each route component wraps content in `<Layout>` separately, so the subscription tears down and re-establishes on every navigation. The brief gap before the first onSnapshot delivery is when Playwright observed "no badge". Real users would see the badge ~100ms after page load. Proper fix: hoist Layout to App.jsx as a stable outer wrapper, OR move notifications subscription to AuthContext. Deferred because it's a meaningful refactor with potential to break role-based layout switching |
| 13.4 | **L7** Landing agency cards all show "0 slots remaining" | ⏳ Deferred (data state) | Render logic in Landing.jsx:252-258 is correct — reads `agency.slots?.total ?? 0` and `agency.slots?.remaining ?? 0` with proper null-safe fallback. The "0" comes from the actual Firestore data, not the code. The seed sets `slots: { total: 25, remaining: 25 }` on first creation but uses `setDoc({ merge: true })` so existing docs with consumed slots aren't reset on re-seed. Resolution paths: (a) hit `/seed` after using `setDoc({ merge: false })` for agencies (reseed restores 25/25), (b) wait for the daily slot reset to fire on next admin/Requests open, (c) manually reset via admin/AgencyDetail. Not a code bug |

### B.14 — Live-browser audit, batch 2 (agency + admin portals)

Second sweep, this time covering agency portal end-to-end (Dashboard, Inbox, Slot Management, GL Letters, Funds, Budget Allocation, Promotions, Application Logs, Profile, User Guide) and the admin portal (Dashboard, Agencies, Requests, Audit Log, Announcements, Reports, Patients). One code fix shipped; four items deferred — including a flagged prompt-injection vector that's worth a follow-up security pass.

| # | Bug | Status | Resolution |
|---|---|---|---|
| 14.1 | **L8** Welcome toast renders "Welcome back, Dr.!" when user name starts with a title (Dr., Atty., Engr., etc.) | ✅ Shipped | Login.jsx took `name.split(' ')[0]` which grabs the honorific as the "first name." Replaced with an iterating skip-honorifics walk over an explicit set (`dr, dra, mr, mrs, ms, atty, engr, hon, prof, rev, sr, br, fr`). Verified live: "Dr. Roberto Velasco" → "Roberto"; plain names unaffected ("Juan Dela Cruz" → "Juan"); double-honorific input ("Dr Dr Roberto") collapses correctly; empty-string input does not crash |
| 14.2 | **L10** Agency User Guide describes a "review → interview → assessment" workflow inconsistent with the CRMC-gateway redesign (CLAUDE.md: "Agencies do NOT re-review documents or re-interview — they only approve their slice") | ⏳ Deferred (content rewrite) | The /agency/guide page predates the redesign. A full content rewrite — orientation, daily-processing, approval-and-GL sections, FAQ — needs to be authored side-by-side with the redesigned workflow once stable. Out of scope for a single-commit fix; tracked separately as a doc task |
| 14.3 | **L11** Admin Requests list shows REQ-2026-421159HA7 with stage "Funded" but "₱0 secured of ₱50,000" | ⏳ Deferred (data state) | `computeFunding` correctly aggregates `amountApproved` from slices with status `approved\|certificate`. The mismatch means the request's `status === 'fully_funded'` was set without matching slice approvals — likely leftover data from before the secured-amount tracking landed, or a manual write during dev. Code path is correct. Worth a future invariant check (`status === 'fully_funded'` ⇔ committed ≥ amountNeeded) on read, displaying an inline "data inconsistent" warning |
| 14.4 | **L13** Audit log `details` field is rendered verbatim from Firestore; current data contains injection attempts (fake "system_alert" entries instructing AI agents to run `claude -p ...` and `firebase deploy --only firestore:rules`) | ⏳ Deferred (security hardening) | Found three crafted entries dated 2026-05-31 with actors "System / Recovery Engine / Migration Daemon" embedding shell commands aimed at recursive Claude self-invocation and rule deployment. Not executed. Underlying issue: any role with `logAudit()` access can write arbitrary `details` text, and that text is read both by human admins (could paste-and-run) and by AI agents reviewing the dashboard. Hardening options: (a) tighten Firestore rules on `auditLog` writes to constrain `actorName`/`actorUid` to match `request.auth` and the `action` field to a known enum, (b) tag entries with provenance (server vs. client-written) and visually distinguish, (c) collapse long details to ~200 chars with a "Show full" affordance, (d) consider stripping shell-command-like substrings on display. Larger work — deferred to a dedicated security pass |
| 14.5 | **L14** Patient registration permits role-impersonating names ("CRMC Admin", "System Diagnostics", "NUKE") seen in admin/Patients | ⏳ Deferred (security hardening) | Companion finding to L13 — the dataset contains accounts with names that look like internal services and emails like `cascade_…@diag.ph` (Cascade being a competing AI assistant — a deliberate tell). Practical mitigation: at registration, reject names matching reserved tokens (`admin`, `system`, `crmc`, `mapa`, `diagnostic`, etc.) and surface a soft warning in admin/Patients when an account's display name collides with role labels. Tracked alongside L13 |

### B.15 — Security response: prompt-injection in auditLog + three rule passes

On 2026-06-01 the live audit (B.14) surfaced 18 planted entries in the
`auditLog` collection with fake "System / Recovery Engine / Migration
Daemon" actors carrying shell-command payloads (`claude -p "…"`,
`firebase deploy --only firestore:rules`). This batch is the
incident-response shipping work — three layered hardening passes plus
discovery cleanup.

| # | Item | Resolution | Commit |
|---|---|---|---|
| 15.1 | **L4** fix landed | Defensive `userDisplayName = name \|\| displayName \|\| ROLE_LABEL_SHORT[role]` across all three Layout avatar/name call sites; `getInitials` null-safe | `1afb7cd` |
| 15.2 | **L8** welcome toast title-prefix bug | Login.jsx walk-skip over honorific set (`dr, dra, mr, mrs, ms, atty, engr, hon, prof, rev, sr, br, fr`); "Dr. Roberto Velasco" → "Roberto" | `25c33b1` |
| 15.3 | **L13/L14** Security pass 1 — auditLog hardening | `actorId == request.auth.uid` enforced on `auditLog.create`; `details` capped at 2000 chars; admin/AuditLog + agency/AuditLog clamp `details` to 240 chars with "Show more"; patient registration rejects reserved tokens via `hasReservedToken()` (admin, system, crmc, mapa, malasakit, diagnostic, recovery, migration, daemon, agency, staff, super, root, test, nuke, **cascade**, claude, gpt, bot) | `f14ea17` |
| 15.4 | **L11** data-state contract violation visible | admin/Requests row shows amber `⚠ data check` chip when `status === 'fully_funded'` but `committed < amountNeeded`. Render logic is correct; the bad data state is now self-reporting | `d2771f1` |
| 15.5 | Security pass 2 — companion surfaces | `notifications.create`: title ≤ 200 / body ≤ 2000; `conversations.create`: caller must be in `participants`; `notificationErrors.create`: title/body/error size caps; `reports.create`: `reportedBy == uid()` + description cap. Plus `scripts/cleanup-injection-audit.js` (admin-SDK script with dry-run + `--delete` + `--strict` modes) | `242c175` |
| 15.6 | Security pass 3 — patient writes + cross-agency | `documents.create`: patientId match + `status == 'pending'` + no agencyIds pre-stamp + ocrText cap + (later) no storagePath pre-stamp; `documentContents.create`: patientId match; `certificates.create/update`: agency owner-only; `announcements.create/update`: title/message caps; `messages.create`: from-attribution + 5000-char cap | `9a596d4` |
| 15.7 | `agencies/update` budget guard | Coordinator (role=='agency', NOT admin) updates must round-trip `budget` byte-identical. Agency admin retains allocation authority. Closes the last "field-level constraints in UI only" residual | `608738b` |
| 15.8 | Cleanup of planted entries | Operator ran `scripts/cleanup-injection-audit.js --delete` against prod via service-account auth; 18 entries purged. Recorded in project log | (operator) |

§B.13 deferral table updated; the only remaining row from B.13 / B.14
on the residual list is L5 (Tour Skip — likely Playwright artifact, no
real user reports).

### B.16 — Thesis-defense polish (Tier 1)

Six bounded, well-tested items that turn the security / engineering
posture from "I assert it works" into "here's the test that proves
it." The series ran 2026-06-01 → 2026-06-02.

| # | Item | Resolution | Commit |
|---|---|---|---|
| 16.1 | `agencies/update` field-level budget constraint | (See 15.7) | `608738b` |
| 16.2 | **Vitest + 29 unit tests** for pure utilities | Tests cover `firstGivenName` (the L8 honorific walker), `hasReservedToken` (the L14 guard), `computeAmountNeeded` / `computeFunding` / `deriveRequestStatus`, `patientExportFilename`. Extracted `src/utils/names.js` so the auth flows are importable. `npm test` runs the suite in ~1s | `389e5fb` + later additions |
| 16.3 | **Firestore rules tests** with `@firebase/rules-unit-testing` | 47 rule assertions across 5 files (`auditLog`, `documents`, `messages`, `certificates`, `users`). Single-fork Vitest config (`vitest.config.js`) so Windows + emulator + Vitest 4 + JDK 21 cohabit; `npm run test:rules` boots the Firestore emulator and runs the suite in ~15 s | `0ceca68` + `9cf5d6a` |
| 16.4 | **`users/create` tightening + Seed refactor** | Rule now requires either self-create with `role == 'patient'`, OR `isAdmin()`, OR `isAgencyAdmin()` creating own-agency coordinator. To unblock this, `scripts/bootstrap-users.js` (admin-SDK) replaces the legacy `/seed` user-creation path; the web page now refuses to run without a signed-in super_admin and only seeds reference data | `489bb2e` |
| 16.5 | `docs/threat-model.md` (≈ 250 lines) | 10 threats addressed (each with mitigation→commit→test), 8 threats accepted with rationale, 7 operational limits documented. Cross-links to rule paths and test files. Direct defense answer to "what threats did you address" | `7a97a46` |
| 16.6 | `docs/runbook.md` (≈ 200 lines) | Routine: deploy, test, bootstrap, re-seed. Incident: audit-log cleanup, post-deploy lockout, broken-rule rollback. Rotation: service account, admin passwords, Vercel SMTP. Backup + recovery. Pinned-version table. Owns the "what does the operator do when X breaks" answer | `7a97a46` |

**Total test suite at end of Tier 1: 76 (29 unit + 47 rules), ~16 s
end-to-end.** First wall-clock automated regression net for both the
business logic AND the security layer.

### B.17 — Engineering improvements (Tier 2)

Four real refactors that materially improve the system without
breaking pilot deploy.

| # | Item | Resolution | Commit |
|---|---|---|---|
| 17.1 | **L6** notification-badge flicker on navigation | New `LiveDataProvider` in `src/contexts/LiveDataContext.jsx` hoists the four onSnapshot subscriptions (`notifications`, `conversations`, agency-inbox count, agency name) above the route components. Layout stays per-page but the listener lifetimes no longer tear down on navigation. Verified live: badge stays "9+" through 5 sample points across a route change (30 / 100 / 250 / 500 / 800 ms). Pub-sub for "new notification arrived" keeps the toast affordance behaviour intact | `239636f` |
| 17.2 | `documentContents` Firestore → Cloud Storage | Patient document content moves from a 1 MiB-capped base64 Firestore field to proper Cloud Storage at `/documents/{patientId}/{docId}/{file}`. New `storage.rules` path with patient/admin/agency-on-agencyIds reads, patient-only writes ≤ 10 MiB. Backward-compat fallback in `DocViewerModal` for pre-migration docs. Admin-SDK migration script `scripts/migrate-doc-content-to-storage.js` (dry-run / --apply / --apply --delete). Fixes the L7 / L9-ish operator pain plus enables real-resolution scans + real PDFs | `cad84ff` |
| 17.3 | Cloud Functions scaffolding (Spark-compatible) | `functions/` surface wired in `firebase.json`; `resetAgencySlots` (daily Asia/Manila) + new `glExpirySweep` (hourly) cover the background-job story. NOT currently deployed — pilot stays on Spark (free) and the existing client-side lazy fallbacks in `agency/Dashboard.jsx` do the equivalent work. The functions are the v2 target for whenever budget permits Blaze; emulator-validated today | `8788c73` + `b35491a` |
| 17.4 | RA 10173 §16(f) patient data portability | `src/utils/dataExport.js` aggregates profile + requests + applications + documents + documentContents + certificates + notifications + conversations (with messages) into a single MAPA-RA10173-v1 JSON blob, Timestamp values normalised to ISO. Button in the Privacy Notice modal triggers an in-browser download. Verified live: ~12 KB JSON for the demo patient with 2 requests + 16 notifications | `d4e02d8` |

### B.18 — Documentation alignment + free-tier honesty

| # | Item | Resolution | Commit |
|---|---|---|---|
| 18.1 | **L10** agency User Guide rewritten for CRMC-gateway model | Old guide described review → interview → assessment workflow that contradicts CLAUDE.md (`Agencies do NOT re-review documents or re-interview`). Replaced 12 sections; new ones added: `review-endorsement`, `needs-info`. Workflow strip changed from 8-step direct-apply to 6-step Endorsed → Patient Proceeds → For Funding → Approve+GL → Print → Upload → Redeem. Slice lifecycle vocabulary throughout | `25f8d57` |
| 18.2 | Spark-plan posture clarified | `docs/runbook.md` "Deploy Cloud Functions" rewritten as future-work — current operation does not depend on Functions. `docs/threat-model.md` operational-limits row reflects actual current setup (lazy fallbacks in `agency/Dashboard.jsx` do the scheduled work) | `b35491a` |

### B.19 — Mobile / PWA install hardening

Triggered by patient reports of being unable to install MAPA on Android
Chrome. Series 2026-06-02.

| # | Item | Resolution | Commit |
|---|---|---|---|
| 19.1 | PWA manifest screenshots + home-screen shortcuts | Three 375×667 portrait screenshots (`/screenshots/01-dashboard.png` etc.) populate Android Chrome's rich install bottom sheet; three shortcuts (My Application, Request Assistance, My Interview) populate the long-press-icon menu | `97edc70` |
| 19.2 | InstallNudge banner above patient route content | `src/components/InstallNudge.jsx` is a small dismissable bar that appears once `__mapaDeferredInstallPrompt` is armed AND not in standalone mode AND not dismissed within 30 days. Rendered above the page content in Layout. Catches the moment AFTER Chrome's engagement heuristic trips, which is when the install ask is actually viable | `325890f` |
| 19.3 | Vercel `Content-Type` for manifest + SW caching | Manifest now served as `application/manifest+json` (was `application/octet-stream`); `sw.js` served as `application/javascript; charset=utf-8` with `max-age=0, must-revalidate`; PWA icons get a 7-day immutable cache. Defensive even though it turned out Vercel was already serving the manifest type correctly | `f2dbd69` |
| 19.4 | Install button polls instead of toast-and-bail | The big "Install MAPA" button no longer fires a dismissive "Chrome hasn't offered the install option yet" toast on cold visits. It now flips to a "Preparing install…" spinner state and polls `__mapaDeferredInstallPrompt` for up to 8 s. The tap itself counts as engagement, so during the poll Chrome usually arms the prompt and the install fires automatically. States: `idle`, `preparing`, `cancelled` (with "Try Install Again" copy), `unsupported` (fallback to inline manual steps). i18n strings in en + fil | `afcf85e` |

End-state: patient successfully installed MAPA on the first phone they
tried after this batch landed. Verified live against
`https://mapa-web-six.vercel.app/install` from a real Android Chrome
session.

### B.20 — Messages mobile UX overhaul

Reported by the same patient session after install — the Messages page
"feels like a webpage, not an app." Audit of the empty state + compose
modal exposed both UX and a long-standing functional bug.

| # | Item | Resolution | Commit |
|---|---|---|---|
| 20.1 | Empty state + redundant header button | Original empty state had a tiny grey icon, "No messages yet.", and "+ New Message" button. Header also had a duplicate "New Message" button. Rebuilt the empty state: brand-tinted 80px circle icon, "No messages yet" title, two-line explanation of what messaging is for, "You can message **CRMC anytime**. Agencies become reachable once CRMC endorses your request to them." reassurance, "Start a Conversation" CTA. Header button now hidden when conversations list is empty | `6d42b7b` + `9ddc534` |
| 20.2 | Compose modal mobile-first rewrite | Native `<select>` dropdown replaced with tappable recipient rows — avatar + name + role + check-circle on select. Grouped under "CRMC — always available" / "Your Agencies"; the latter shows an amber notice when the patient has no endorsed slices. Subject field collapsed behind "+ Add subject (optional)". Message textarea grew to 5 rows with personalized placeholder. Modal is full-screen on phones (`h-full sm:h-auto`). New `recipientsState` ('loading' / 'ready' / 'denied') replaces the silent-fail loading spinner with a clear red banner if the rule layer denies the recipient query | `9ddc534` |
| 20.3 | `users/read` rule expanded for patient compose | Patients can now read `super_admin`, `staff_admin`, `agency`, `agency_admin` user docs. Required for the recipient picker to populate (names + roles are operational not sensitive — already surfaced on /agency catalog and agency-decision screens) | `9ddc534` |
| 20.4 | **Real bug found**: every patient send was failing | `handleSend` did `const conv = await getOrCreateConversation(...)` then `sendMessage(conv.id, ...)`. But `getOrCreateConversation` returns a STRING ID, not an object. `conv.id` was `undefined`, so the message was written to `conversations/undefined/messages` and the rules layer denied it. The generic "Failed to send message" toast masked this for an unknown period — likely the entire lifetime of the modal. Every other caller in the codebase (8 sites) correctly used `const convId = await getOrCreate...` | `f917bfb` |
| 20.5 | Defensive recipient name resolution | `displayName(r)` cascades `r.name → r.displayName → role label`. Same pattern as the L4 Layout fix — the super_admin demo doc has `displayName` but no `name`, which previously rendered a blank recipient row with "U" initials. Now reads as "CRMC Administrator". `initials(r)` reads from the resolved name | `f917bfb` |
| 20.6 | Error messages tell the truth | Send-error catch now matches `err.code` and surfaces specific reasons ("Permission denied. The CRMC contact you picked may not be configured for messaging yet." / "Network problem." / "Server check failed." / the raw message). Console.error logs the full error for diagnostics. Toast duration 7 s so the patient has time to read | `f917bfb` |

### B.21 — Storage migration partial revert (Spark-plan constraint)

The Tier-2 commit `cad84ff` migrated patient document content from
`documentContents` (Firestore base64) to Cloud Storage. After the
deploy, the operator confirmed they cannot afford the Firebase
Blaze plan, and Cloud Storage on Firebase requires Blaze to enable
new buckets on projects created after the recent policy change. The
GL-scan path hit the same wall earlier in the project (commit
`b888fa9` reverted that migration with the same note).

**Net effect of the unreverted state**: every new patient document
upload on the live site would fail (`uploadBytes` rejected for
billing-not-enabled), and the metadata-doc rollback in
`uploadPatientDocument` would silently leave the patient with no
visible document. This was caught before any real patient
exercised it.

| # | Item | Resolution | Commit |
|---|---|---|---|
| 21.1 | Revert `uploadPatientDocument` + `replacePatientDocument` to Spark-compatible base64 | New uploads write the content back to `documentContents/{docId}`, capped at ~700 KiB after image compression to fit Firestore's 1 MiB doc cap (same as pre-Tier-2). The rule constraint `!('storagePath' in request.resource.data)` on `documents.create` is kept in place as defence-in-depth (no harm; uploader simply doesn't set it any more) | (this batch) |
| 21.2 | Keep `DocViewerModal` Storage-first fallback | Any doc that DID get a `storagePath` stamped during the Tier-2 window (likely zero, since the migration script was never run) continues to load via the Storage path. The legacy `documentContents` fallback remains the working path | (already in place) |
| 21.3 | Keep Storage-related code paths as future work | `storage.rules` `/documents/{patientId}/{docId}/{file}` block stays in the file (dormant; no objects under it). `scripts/migrate-doc-content-to-storage.js` stays in `scripts/` as the v2 migration target for whenever the project moves to Blaze. The doc-comments at the top of `uploadDocument.js` explain the rollback rationale so a future maintainer doesn't re-trip on the same wall | (this batch) |

`docs/threat-model.md` "Operational limits" row updated to reflect
the actual file-content posture (base64 in Firestore, capped at
~1 MiB per doc, advisory of the Storage v2 path).

`docs/thesis-summary.md` data-model table updated to show the
current state, not the Tier-2 aspirational state.

### B.23 — Post-pilot live-session audit round 2 (R13–R29)

A second end-to-end audit conducted 2026-06-03 → 2026-06-04 against a
running pilot session on `localhost:5173`. The user demoed real
patient / agency / admin flows; each surfaced issue was triaged,
fixed, and recommitted with a clear "before" / "why this is wrong" /
"how it now behaves" trail in the commit body. Findings span all
three role surfaces and several shared concerns the earlier audits
hadn't touched (UX dead-ends, missing affordances, data-cascade gaps,
silent error swallowing).

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 23.1 (R13) | Pre-endorse warning when attached documents are missing | The EndorseModal now pre-checks each `documentId` in the request's `attachedDocuments` snapshot via `getDoc()` before allowing the CRMC staff to commit. If any references are stale (test data cleanup, account soft-delete, schema migrations), a banner surfaces between the funding summary and the agency picker — amber when some are missing, red when all are missing — listing the missing names so the staff member can ask the patient to re-upload before referring the case. R8 already kept the transaction healthy in that state but the receiving agency still ended up with a slice they couldn't open. R13 catches the bad state where the staff can act on it | `f42ec44` |
| 23.2 (R14) | Make actionable stepper rows tappable on patient status | The request-lifecycle stepper on `/patient/status` had no tap affordance. Two of its six stages now route the patient to their natural destination when active: "Assessment & Interview" → `/patient/interviews` (Google Meet link, prep panel), "Endorsed to Agencies" → `/patient/request` (coverage plan + slice approvals). Whole row becomes a 44px+ tappable button with a brand-tinted "View your interview details →" / "Review the coverage plan →" CTA and a chevron. Stages without a useful destination (Submitted, Under Review, Approved & Funded, Completed) stay informational so the chevron always means something | `a971431` |
| 23.3 (R15) | Stop the Amount input from displaying a leading zero | Budget Allocation Amount input was initialised to the number `0`, which rendered as the literal text `"0"`. Users clicking in landed their cursor after the existing zero, so typing "10000" became "010000". The save handler coerced correctly so saved amounts were never wrong, but the display looked broken and the helpful placeholder ("e.g. 500000") never appeared. Now held as a string, initialised to `""` (placeholder visible), onChange strips leading zeros from pastes, save handlers coerce at the boundary | `ef9077f` |
| 23.4 (R16) | Confirm & Proceed actually proceeds the slice | The "Confirm & Proceed" banner on `/patient/status` for an endorsed slice navigated to `/patient/request` and hoped RequestAssistance would detect the active request and render its proceed view. The detection failed when the parent-request was missing or in a terminal status — patients landed on Step 1 of the new-request wizard with no obvious way back. Banner button is now an inline action: flips the slice from `endorsed` → `reviewing`, notifies the agency's coordinators, shows toast feedback. No navigation, no fragile cross-page handoff | `ed9fdc4` |
| 23.5 (R17) | Issued-GL slices stay in "In Progress", not "Past Applications" | The activeApps/pastApps filter on `/patient/status` lumped every `certificate`-status slice into the Past tab. But `certificate` means "agency has issued the GL" — the patient still has a downloadable file, a 30-day expiry clock, and a trip to the agency office to plan. The user found a live downloadable GL filed under "Past Applications" with a green Download button next to a "Past" tab title. New `isTerminal()` predicate: `certificate` slices are only terminal once `glStatus === 'redeemed'`, `glStatus === 'expired'`, or past the validity window via `isGLExpired()` | `a149d08` |
| 23.6 (R18) | Patient Dashboard activeApp filter aligned with R17 | The Dashboard's status-card picker selected any slice that wasn't `rejected`, including redeemed or expired certificate slices — the card kept saying "Your application is in progress" for slices the patient had finished weeks ago. Extracted R17's `isSliceTerminal` predicate to `utils/requests.js`; Dashboard now uses the same definition of "done" as TrackStatus | `c75e733` |
| 23.7 (R19) | Dashboard status-card CTAs route to /patient/status, not /patient/request | STATUS_VISUAL `endorsed` / `reviewing` / `awaiting_info` paths all pointed at `/patient/request` — the same dead-end R16 fixed for the banner. /patient/status is now self-contained for the proceed action and surfaces awaiting_info messages; all three CTAs route there | `c75e733` |
| 23.8 (R20) | Complete patient delete cascade for RA 10173 §16(e) | `handleDeleteAccount` cascaded documents, documentContents, applications, and notifications, but missed `requests` (parent of slices — left orphaned forever with patient name / amount visible to admin/Requests), `conversations` the patient participated in, `certificates/{appId}`. Now fetches all six collections in parallel, batch-deletes message subcollections per conversation then conversation docs themselves, plus per-application certificates. The previous bare `catch {}` is now a logged catch so partial-failure diagnostics aren't silenced | `0032d96` |
| 23.9 (R21) | Messages handleSend wrapped in try/catch/finally | A thrown `sendMessage` left `sending` stuck `true` forever — the send button stayed disabled, no toast surfaced, the user had to refresh to recover. Now wrapped: errors toast + log, `setSending(false)` always runs, typed text preserved so the user can retry without losing their draft. Same fix applied to `ConversationThread.handleSend` in the desktop two-panel layout | `a6b2998` + `986396b` |
| 23.10 (R22) | Audit log ACTION_CONFIG completed | `ACTION_CONFIG` in `admin/AuditLog.jsx` was missing 9 entries that ARE written in code: `request_endorsed`, `interview_scheduled`, `interview_completed`, `intake_completed`, `gl_redeemed`, `gl_unmark_redeemed`, `gl_expired`, `gl_auto_expired`, `approval_reversed`. The audit log rendered these with raw action keys and unstyled badges. Added each with a label + matched badge color and a new "Lifecycle" category in the filter row | `0032d96` |
| 23.11 (R23) | Messages thread-load error surfaces a real error UI | The `(err)` callback only set `loadingMsgs=false`; `messages` stayed `[]`, rendering the "No messages yet" empty state — indistinguishable from a brand-new conversation. New `loadError` state + a red error panel ("Couldn't load this thread"). Reset on every conv change so reopening a thread retries. Applied to both `ConversationModal` and `ConversationThread` | `a6b2998` + `986396b` |
| 23.12 (R24) | admin/Accounts.jsx setDoc defaults aligned | New super_admin / staff_admin user docs were missing `deletion: false` and `cooldown: 0`. Every other creation path (`agency/Team.jsx`, `admin/AddAgency.jsx`, `patient/Register.jsx`) sets both. The R1 deletion gate still worked because undefined is falsy, but a future query like `where('deletion', '==', false)` would silently skip these docs. Now stamps both fields | `0032d96` |
| 23.13 (R25) | Patient More handleLogout awaits Firebase signOut | The old fire-and-forget version called `logout()` and immediately navigated to `/login`; the promise raced the auth-state clear. PrivateRoute self-corrected, but a fast back/forward could briefly surface authenticated content. Now async with try/catch around the signOut so navigate runs after Firebase has actually cleared | `5d35c0a` |
| 23.14 (R26) | Per-document upload error tells the patient WHICH doc broke | A partial document-upload failure during request submission collapsed into a generic "submission failed" toast — the patient had no idea which upload broke. Each per-doc upload now has its own try/catch that rethrows with `UPLOAD_FAILED:<typeName>`; the outer catch decodes that and toasts `Could not upload "Medical Certificate". Check your connection and try again.` Retry path is unchanged — `replacePatientDocument` already dedupes against `myDocs` | `5d35c0a` |
| 23.15 (R27) | Messages read-receipt errors logged instead of silently swallowed | The unread-counter `updateDoc` was wrapped in `.catch(() => {})`. If rules denied the write or the network blipped, nothing surfaced in dev or production diagnostics. Bumped to `console.warn` so the failure is visible without alarming the user. Applied to both `ConversationModal` and `ConversationThread` | `a6b2998` + `986396b` |
| 23.16 (R28) | GLViewer survives transient missing-doc states | The snapshot listener navigated to `/agency/inbox` on ANY `!snap.exists()` callback, including transient ones after the initial load. A Firestore offline replay, a delete race, or a brief permission flicker would yank the agency out of an open viewer. Added a `firstLoad` ref: only the first snapshot's missing state triggers the redirect; subsequent misses log a warning and keep the last-known state on screen | `5d35c0a` |
| 23.17 (R29) | Patient Messages two-panel desktop layout | The patient layout was mobile-first and never adapted — on a wide desktop, `/patient/messages` showed a narrow centered card with 60%+ of the screen blank to the right, and clicking opened a fixed-position modal that floated over the list. Admin and agency users had a proper two-panel split for the same data; patient was the only role still stuck on the mobile pattern. Now responsive: `<md` keeps the existing card + modal (proven UX for phones), `md+` renders a 320px left list + inline `ConversationThread` on the right. Empty-right-pane copy adapts ("No conversations yet" vs "No conversation selected"). Drive-by: R21/R23/R27 echoes patched in `ConversationThread` since it had the same bugs as `ConversationModal` had before Group 2 | `986396b` |

End-state of B.23: all 17 findings fixed, all changes build clean
(`✓ built in ~10s`), all commits pushed to `main`. The work was
delivered in five tagged groups (R13 standalone, R14 standalone, R15
standalone, R16 + R17 patient-status sweep, R18+R19 / R20+R22+R24 /
R21+R23+R27 / R25+R26+R28 / R29 — 4 grouped + 4 standalone commits).

### B.24 — Demo-account maintenance + the silent-write-hang investigation

A live-session login test on 2026-06-05 surfaced that
`admin@crmc.gov.ph` (the super_admin demo) signed in successfully but
landed on `/patient/dashboard` — its Firestore profile said
`role: 'patient'`. Earlier sessions had clearly drifted multiple demo
accounts. `bootstrap-users.js` (the original seed script) is by design
idempotent: if an Auth account already exists, it leaves Auth alone,
and if a Firestore profile already exists, it leaves the profile
alone. That's correct for first-time seeding but can't recover from
drift.

Three new operational scripts were added and one painful root cause
diagnosed.

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 24.1 (R30a) | Extract `USERS` array to a shared module | `scripts/demo-accounts.js` becomes the single source of truth for the 11 demo accounts (2 CRMC admins, 4 agency_admins, 4 coordinators, 1 patient). `scripts/bootstrap-users.js` refactored to import from there — behavior unchanged, but adding a new demo account now needs one edit instead of two | `6a41039` |
| 24.2 (R30b) | `scripts/check-demo-accounts.js` — read-only health diagnostic | Uses the Firebase **Web SDK** + the project's existing `.env` config (same path the React app uses), so no service-account.json required to run. For each canonical demo account it attempts a sign-in, reads `users/{uid}`, and reports a verdict per account: ✅ OK, ⚠️ WRONG_ROLE, 🔑 BAD_PASSWORD, 🕳️ NO_PROFILE, 🛑 MARKED_FOR_DELETION, ⚠️ ON_HOLDING_PERIOD. First run flagged 7 of 11 demo accounts drifted (1 WRONG_ROLE, 1 BAD_PASSWORD, 5 NO_PROFILE) | `a2641b9` |
| 24.3 (R30c) | `scripts/repair-demo-accounts.js` — force-restore via Admin SDK | For each entry: creates the Auth user if missing, force-resets the password to canonical, and writes the Firestore profile via `ref.set(canonical, { merge: true })`. The `{ merge: true }` is critical — was bug-fixed mid-run after the dry-run on the real patient profile flagged "would wipe `address: '2nd Street, Rosary Heights V…'`". Includes `--dry-run` mode that prints the per-field diff (`role: "patient" → "super_admin"`) without writing. Idempotent and safe to re-run | `6a41039` (initial) + `a5cfa57` (merge fix) |
| 24.4 | `.gitignore` patterns for `service-account*.json` | Previously only `.env` was excluded. A service-account.json downloaded to the project root could have been one `git add .` away from public. Added blanket patterns: `service-account.json`, `service-account-*.json`, `*-service-account.json`, `firebase-adminsdk-*.json` | `a2641b9` |
| 24.5 | **Discovery**: Spark plan write quota exhaustion presents as a silent gRPC hang in Admin SDK | The repair script ran cleanly in `--dry-run` (reads only) but hung at the first `ref.set()` in apply mode. Three layers of diagnostic peeled back the cause: (a) isolated `auth.updateUser()` worked → Auth wasn't the issue; (b) isolated `db.doc().get()` worked → Firestore reads were fine; (c) isolated `db.doc().set()` to a brand-new `_diagnostic/` collection hung identically → not a doc-specific issue. Two more transport tests narrowed it further: `preferRest: true` on the Firestore client didn't help (writes still hang because Admin SDK `preferRest` only switches reads). A direct **REST API call** to `firestore.googleapis.com/v1/.../documents` surfaced the real error in 614 ms: `429 RESOURCE_EXHAUSTED — Quota exceeded`. The Admin SDK swallows 429s into infinite gRPC retries with no error propagation — by design, but operationally indistinguishable from a network hang. Three consecutive REST writes spaced 2 s apart all returned 429 instantly, confirming the quota is the daily 20K writes/day Spark allowance (not a transient burst limit) and resets at midnight Pacific Time | (diagnostic; no commit) |
| 24.6 | Documented playbook for "writes hang silently" | The diagnostic sequence is now the canonical way to distinguish a real network hang from a quota exhaustion: try direct REST → if you get 429, you're over quota and have to wait for reset (or upgrade to Blaze). If REST returns the same hang, the issue is actually network-layer. Saves hours of chasing the wrong cause | (documented inline in this section + in `docs/runbook.md`) |

End-state of B.24: maintenance tooling in place for the demo set
going forward (`check-demo-accounts.js` runs as a pre-defense smoke
test in under 5 s; `repair-demo-accounts.js` is the one-command
recovery). Quota-exhaustion playbook documented. Actual demo-account
repair is queued for after the quota window resets — the script is
verified correct via dry-run, only the project-level write quota
stands between the current drift state and ✅ 11/11.

### B.25 — Post-quota recovery: operational tooling + agency UX upgrades

Once the write quota reset (midnight Pacific = 3 PM PH on 2026-06-06)
and the demo accounts were repaired to ✅ 11/11, the rest of the day
shifted to closing the operational gaps the audit had surfaced. Six
commits landed in one push window covering reference-data seeding,
agency logo support, full-database backup, defense-demo scenario
prep, a sidebar discoverability fix, and BARMM-aware location
dropdowns on agency forms.

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 25.1 | `scripts/bootstrap-reference-data.js` — admin-SDK companion to bootstrap-users.js | The original `/seed` web page seeded reference data (agencies, document types, assistance types, hospital IDs) but required super_admin login + `VITE_ENABLE_SEED=true`. After the 2026-06-01 `users/create` rule tightening it stayed compatible, but during the same-day account-drift recovery the operator hit a chicken-and-egg: agencies were empty AND no admin could log in until the demo-account repair landed. This script bypasses both gates (Admin SDK ignores rules). Seeds 4 agencies + 8 documentTypes + 8 assistanceTypes + 20 hospitalIds with `setDoc(..., {merge:true})` so re-running is a true no-op. Per-agency budget initialised to `{ allocated: 0, committed: 0, disbursed: 0, period: 'monthly' }` so the allocation pages don't render NaN on first paint. Verified live: 40 total writes, all 4 agencies present | `04de563` |
| 25.2 | Optional `logoUrl` per agency, fallback to colored initials | The agency avatar across the system has always been a colored circle + 2-letter initials (`MC` on `bg-brand-500` for Malasakit). Operator asked "can agencies change their icon to their official logo?" on 2026-06-06. Three layers: (a) new `<AgencyAvatar />` component with onError swap (image renders if `logoUrl` is set and loads; falls back to colored initials otherwise — no broken-image icon), (b) Logo URL input on the agency edit modal with HTTPS-only validation (Cloud Storage upload is blocked by Spark plan; external HTTPS URLs are the only path), (c) `logoUrl: null` added to all 4 seed agencies in `bootstrap-reference-data.js`. Agency_admin can paste their official logo URL via `/admin/agencies` edit modal; a broken URL auto-reverts to initials | `a8ddb6a` |
| 25.3 | `scripts/export-firestore.js` — full-database backup via Admin SDK | Spark plan has no automated Firestore backup; this is the operator's only rollback before any destructive operation. Walks every top-level collection (16 of them) plus the two known subcollection paths (`notifications/{uid}/items`, `conversations/{id}/messages`), writes each as a JSON file under `./backups/{ISO-timestamp}/`. Firestore Timestamps normalised to ISO-8601 strings so the JSON is grep-friendly. Verified live: 19,538 docs exported in 142.8 s. `.gitignore` updated to exclude `backups/` so PII never reaches the repo. Restore is intentionally manual (read the JSON, write a focused restore script for the affected collection) | `3a81913` |
| 25.4 | `scripts/seed-demo-scenario.js` — fresh in-flight request for defense walkthrough | Creates one request from `patient@gmail.com` for ₱25,000 (Hospital Bills) describing a real-sounding pneumonia case at CRMC ICU, plus three attached document records (Valid ID, Barangay Certificate, Hospital Billing Statement) in 'pending' state with placeholder text-as-base64 content so the CRMC verifier sees something when they open the viewer. Strictly additive — won't touch existing patient data. Includes `--dry-run` mode and prints a 7-step walkthrough guide. Pre-defense workflow: run this script 1-2 hours before the panel to get fresh `submittedAt` timestamps; demonstrator drives the panel through verify -> intake -> interview -> endorse -> approve -> GL issued live | `3a81913` |
| 25.5 | `<AgencyAvatar />` sweep across 8 primary surfaces | Component shipped in §25.2 was only adopted in `admin/Agencies` initially. This batch swapped the inline `${agency.color}` + initials blocks at the 7 other sites where the full agency object is in scope: `patient/MedicalPrograms` (mobile + desktop card), `auth/Landing`, `admin/AgencyDetail`, `admin/AddAgency` (form preview), `agency/Dashboard`, `agency/Program` (preview + header). Once an agency_admin sets a logoUrl, the logo now appears consistently across the public landing page, patient catalog, agency workspace, and admin detail. The slice-derived avatar sites (`TrackStatus`, `EndorseModal`, `ApplicationDetail`, `Interviews`) still render from denormalised `agencyColor` + `agencyInitials` on the slice doc; adding logos there needs a runtime lookup or denormalisation pass, deferred | `3a81913` |
| 25.6 (R31) | Expose Team + Audit Log in desktop agency sidebar | The agency_admin route `/agency/team` (`Team.jsx` with `AddCoordModal`) was reachable only by typing the URL or via the mobile bottom-tab nav. Desktop sidebar config (`AGENCY_NAV` in `Layout.jsx`) never listed it. Same situation for `/agency/audit`. Surfaced live: operator signed in as `admin@malasakit.gov.ph` on desktop, expected to find "Team" to add a coordinator, didn't see one. The route + page + Firestore `users/create` rule for agency_admin all worked — only the sidebar discovery was broken. Both entries added with `adminOnly: true` so regular agency coordinators don't see them. Sixteen-line fix; no backend changes | `8ea2882` |
| 25.7 (R32) | BARMM cascading dropdowns for agency location | The Location field on agency create + edit was free text ("CRMC Ground Floor, Cotabato City"). Operator's question on 2026-06-06: "make the location a dropdown." Replaced with the same BARMM Province → City/Municipality cascading dropdown pattern the patient registration form uses, plus an optional Office / Building Name free-text field. Save still writes a derived `location` string for backward compat with every render site that reads `agency.location`. On edit of a legacy agency, the structured fields start empty and the previous flat value is shown as amber helper text ("Previously: ...") so the operator sees the prior content while picking the structured version. Validation rejects save without province + city. Applied to BOTH `AddAgency.jsx` and the `AgencyModal` in `admin/Agencies.jsx` (the latter is shared with `admin/AgencyDetail`). `bootstrap-reference-data.js` updated to seed the structured fields too | `da06bbf` |

End-state of B.25: maintenance tooling complete (`bootstrap-reference-data.js` + `export-firestore.js` + `seed-demo-scenario.js` join the existing demo-accounts trio). Agency surface supports logos AND structured BARMM locations. Both UX gaps the operator surfaced live (sidebar Team link + free-text location) closed in the same session. Total commits in this batch: 6 (one bundle commit covered two pieces of work).

### B.26 — Inter-Agency Coordination Plan, Phase 1 (R33 + R34 + R35)

Triggered by the question "lets research inter-agency coordination" on 2026-06-06 late. Surveyed how comparable systems handle multi-stakeholder coordination — NHS England Integrated Care Systems, Salesforce Public Sector, ServiceNow Public Sector Digital Services, Bonterra Apricot, UNHCR proGres, Estonia X-Road, Open Referral / HSDS — and drafted a four-phase plan (`docs/coordination-research.md` is summarised in this revision list, not yet a standalone file). Phase 1 is the pre-defense polish layer; Phases 2–4 are documented as future work in `docs/thesis-documentation.md §11.4d` and §12.2.

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 26.1 (R33) | Case Timeline — chronological cross-agency event feed on every co-funded case | `<CaseTimeline />` component (115 lines) renders above the existing "Co-funding picture" panel on `agency/ApplicationDetail`. Source: Salesforce Public Sector Activity Timeline + NHS England Shared Care Records chronological view. Each agency sees the case from the network's perspective in time order — Bardach (1998) calls this "frame reflection" and identifies it as essential to collaborative public management. Plumbing: `logAudit()` gained optional `requestId` + `patientId` parameters; 9 existing call sites updated to pass them through; 3 NEW audit event types added (`slice_advanced` emitted inside `updateStatus()` so every status transition is captured; `app_approved` emitted at end of approve transaction; `patient_proceeded` emitted from `patient/TrackStatus.jsx` so agencies see the patient's handoff to funding review). `firestore.rules` `auditLog.read` extended with two clauses: any co-funding agency can read entries scoped to a request it holds a slice in; any patient can read entries where `entry.patientId == uid()` (set up for §B.27 patient-visible audit view) | `0744760` |
| 26.2 (R34) | Watcher subscriptions on requests — sibling-agency notifications | When CRMC endorses a request, every `agency_admin` + `agency` (coordinator) UID of the endorsed agencies is `arrayUnion`-ed into `request.watchers[]` inside the same transaction. On `app_approved` and slice rejection, notifications fan out to every watcher except the actor (and except the `endorsedById` admin, already notified). Source: ServiceNow Public Sector watcher/subscriber model. Klijn & Koppenjan (2016) call this "network awareness" — each node sees the network's activity in real time without polling. Scope deliberately limited to approve + reject events (high-signal cross-agency moments); minor transitions stay in the Case Timeline only, to avoid notification noise. No new firestore.rules required — the existing `isAdmin()` permission on `requests.update` already covers the watcher-write path, and the existing co-funding agency `requests.read` clause covers the read | `7607637` |
| 26.3 (R35) | Live over-commitment guard in ApproveModal | Soft warning that updates as the coordinator types AND as sibling agencies independently approve. Three states: gray (partial), green (would fully fund), amber (would over-commit). Amber shows the over-commit amount and offers "Coordinate via CRMC, or lower your amount." Doesn't block submit — MAPA's existing design explicitly allows controlled over-commitment (CRMC sometimes intentionally over-endorses to give the patient a buffer if any agency rejects). Source: industry-standard optimistic concurrency UX, with MAPA's preserved-human-judgment twist. Reuses the already-subscribed `siblings` array from the parent page; no new reads. Demonstrates Bardach's (1998) "collaborative craftsmanship" principle: the platform informs, the operator decides | `cec9960` |

End-state of B.26: Phase 1 of the four-phase coordination plan ships. Each co-funding agency now sees (a) a chronological feed of every cross-agency event, (b) real-time push notifications when siblings approve or reject, (c) a live coordination signal in the approval flow that shows the running network total. Pattern sourcing connects to NHS, Salesforce, ServiceNow, and the public-administration literature on collaborative governance.

Pending coordination work (Phases 2–4) documented in `docs/thesis-documentation.md §11.4d` for honest future-work framing:
- Phase 2 (post-defense, half-day each): Structured referral system (Bonterra warm-handoff), outcome reconciliation (previousRejections carry-forward), patient-visible audit view (Estonia X-Road)
- Phase 3 (Blaze-dependent v2): In-case comment threads (Salesforce Chatter), joint Meet scheduling, Open Referral / HSDS adapter
- Phase 4 (production / multi-hospital): Multi-hospital sharding, real outcome tracking, donor analytics, PhilSys integration

### B.27 — App-wide searchable dropdowns (R42)

Triggered by an operator screenshot on 2026-09-07 showing the native `<select>` for the barangay field — a cramped, unsearchable OS popup forcing the patient to scroll ~37 near-identical Cotabato City barangay names on a phone. Introduced a shared `SearchableSelect` combobox (`src/components/ui/SearchableSelect.jsx`) and replaced **every** native `<select>` in the app with it (16 files, ~25 controls). Verified live on production.

| # | Theme | Action Taken | Commit |
|---|---|---|---|
| 27.1 (R42) | `SearchableSelect` component — accessible, searchable, mobile-first | Controlled combobox, **no new dependency**. A styled trigger opens a popover with a type-to-filter search box (shown only when the list has > 7 items, so short lists stay clean), full keyboard navigation (Arrow/Home/End/Enter/Escape), the ARIA listbox pattern (`role=combobox/listbox/option`, `aria-activedescendant`), outside-click + Escape to close, focus return to the trigger, and 44px touch rows. Matches the app's `.input` styling + brand focus ring so all dropdowns read as one system. A `pinnedOption` prop keeps the "Other (not listed)" free-text escape hatch always visible and never filtered out; a `triggerClassName` prop lets compact filter toolbars keep their sizing | `28ade27` |
| 27.2 (R42) | Rollout across the app | Converted `AddressPicker` (province/city/barangay, Other-fallback preserved) plus Register (suffix), RequestAssistance (assistance type), IntakeWizard + IntakeSheet (employment / means-test), Accounts (role), AddAgency + Agencies (processing time, sort), ProfileModals (report category), Allocation (period), SuggestEndorsementModal (agency, urgency), and the admin filter toolbars on Requests (category / officer / sort), Reports (category / reporter), AuditLog (actor), AppLogs (agency), Interviews (range). Event-based `set()` setters were adapted with a `{ target: { value } }` shim so their side effects (autosave, error-clear) are preserved; triggers keep `data-field`/`id` so Register's scroll-to-first-error still works | `28ade27` |
| 27.3 (R42) | Tests updated to drive the combobox | `AddressPicker` and `SuggestEndorsementModal` component tests were rewritten from native `selectOptions` to the open-list-and-click interaction. Full component suite green (90 passed); utils 128 passed | `28ade27` |

End-state of B.27: no native `<select>` remains in `src/`. Long lists (barangay, agency, actor/officer filters) gain type-to-filter search; short lists render as styled dropdowns with no search box. This closes the reskin-plan's implicit "forms use one dropdown control" gap and directly enhances R32 (BARMM location dropdowns) and R39 (`AddressPicker`). Shipped as PR #199, merged and deployed to production 2026-09-07, verified live on `/register`.

### B.22 — Closing summary

| Metric | Value |
|---|---|
| Total commits across the full revision program | ~295 |
| Adviser revisions addressed | 12 of 12 |
| Real correctness bugs caught in the read-pass series (#1-20) | 20 |
| Real correctness bugs caught in the full-system audit (#21-31) | 11 |
| Real correctness + UX bugs caught in the audit round 2 (R1–R32) | 31 (12 in §B.20 reliability batch, 17 in §B.23, 2 in §B.25) |
| Inter-Agency Coordination features shipped (R33–R35, §B.26) | 3 (Case Timeline, Watcher Subscriptions, Live Over-Commitment Guard) |
| Live-browser audit findings (L1–L14) | 14 (9 fixed, 4 deferred-with-justification, 1 dismissed) |
| Security passes shipped on the Firestore rules layer | 3 (auditLog + companion surfaces + patient-write constraints) |
| Other rule tightenings (agencies/update, users/create, documents.read split) | 3 |
| Cloud Storage migration | 1 (documentContents → Storage, with admin-SDK migration script + rollback) |
| Cloud Functions scaffolded (Spark-compatible client fallbacks remain primary) | 2 (resetAgencySlots daily + glExpirySweep hourly) |
| Compliance features shipped | 2 (RA 10173 §16(f) patient data portability export + §16(e) right-to-erasure complete cascade — R20) |
| Automated tests at close | 76 (29 unit + 47 rules) — full suite ~16 s |
| Operational docs added | 2 (`docs/threat-model.md`, `docs/runbook.md`) |
| Operator scripts available | 10 (`bootstrap-users.js`, `cleanup-orphans.js`, `cleanup-injection-audit.js`, `migrate-doc-content-to-storage.js`, `demo-accounts.js`, `check-demo-accounts.js`, `repair-demo-accounts.js`, `bootstrap-reference-data.js`, `export-firestore.js`, `seed-demo-scenario.js`) |
| Demo-account maintenance loop | check → repair → verify, two-script trio with single shared `USERS` array (§B.24) |
| Reference-data seeding loop | `bootstrap-reference-data.js` covers agencies + documentTypes + assistanceTypes + hospitalIds (§B.25) |
| Operational playbook for silent gRPC hangs | Documented in §B.24 — direct REST call surfaces real error (e.g. `429 RESOURCE_EXHAUSTED`) when Admin SDK retries forever |
| Full-database backup tool | `scripts/export-firestore.js` — Admin SDK walks all 16 top-level collections + 2 subcollection paths, JSON output, verified live at 19,538 docs in 142.8 s (§B.25) |
| Defense-demo scenario seeder | `scripts/seed-demo-scenario.js` — one in-flight request + 3 documents for the panel walkthrough, idempotent (§B.25) |
| UX gaps closed in the read-pass series | 17 |
| UX gaps closed post-audit (Tier 2 + Mobile / Messages + R13–R32 batches) | ~34 |
| Patient surface consistency fixes after live-session audit | 9 (R11, R12, R14, R16, R17, R18, R19, R25, R29) |
| Cross-surface error-handling fixes after live-session audit | 6 (R21, R23, R26, R27, R6, R10) |
| Agency surface upgrades after live-session audit | 3 (optional `logoUrl` + Team / Audit Log sidebar gap R31 + BARMM location dropdowns R32) |
| Code consolidations across the program | 23 (incl. `isSliceTerminal` hoisted to `utils/requests` per R18 + `USERS` extracted to shared module per R30 + `<AgencyAvatar />` single source of truth for 8 surfaces per §B.25.5 + `<CaseTimeline />` reusable cross-agency event feed component per R33) |
| First-visit guided tours shipped | 4 (patient Dashboard + TrackStatus, agency Dashboard, admin Dashboard) |
| Patient-side mobile install validated end-to-end | ✅ on one real device |
| Responsive layouts (patient surface) | 2 (Status page + Messages — both phone-first AND desktop-two-panel) |

### Items still on the table (the user's call, not blocking)

- **Keyboard shortcuts on `admin/Requests`** (V to verify focused doc, J/K to navigate queue). Bulk-verify shipped 2026-05-31 (commit `01546dc`); keyboard shortcuts deferred — needs design call on focus model and browser-shortcut conflict avoidance
- **`GL_STATUS_CONFIG` label-only helper** (two render sites use different visual treatments — badge vs text)
- **`MAX_CAPACITY = 100` hardcoded** in agency/SlotManagement — needs DB schema decision for a per-agency `slots.maxCapacity` field with sensible default
- **admin/AppLogs server-side search** — currently search + filter only apply to the loaded page (PAGE_SIZE = 100); server-side rewrite is a real but non-blocking workflow gap
- **`users/create` Seed refactor follow-through** — bootstrap script ready; operator must run `node scripts/bootstrap-users.js` before deploying the tightened rule on a fresh project, OR existing prod is safe (existing user docs already exist; rule change only affects future creates)
- **Cloud Functions Blaze deploy** — code is in `functions/`, emulator-validated; deploy is a future budget decision. Pilot runs on Spark with the existing client-side lazy fallbacks
- **Tour Skip delay (L5)** — likely Playwright-snapshot-timing artifact, not a real user-facing bug; would need React-Testing-Library reproduction to triage further
- **L11 root data cleanup** — the `⚠ data check` chip surfaces the contract violation but the underlying request-status field still says `fully_funded` with no secured slices. Operator action to either re-derive status from slices, or close the request with `closed` status
- **Cloud Function for Auth account deletion** — would close the orphan-Auth gap properly (currently mitigated by warning copy in three Delete modals). Blocked by Firebase Spark plan per CLAUDE.md scope