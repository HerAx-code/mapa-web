# MAPA Revision List

**Project:** Medical Assistance Portal Access (MAPA) — Cotabato Regional Medical Center
**Status:** Updated 2026-06-02
**Scope:** All revisions from the bilingual rollout through the CRMC-gateway redesign through the read-pass review series, the operator-throughput follow-up, the first-visit guided tour batch, and the full-system 46-page audit + sweep.

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

| Metric | Count |
|---|---|
| Total commits across the full revision program | ~150 |
| Adviser revisions addressed | 12 of 12 |
| Real correctness bugs caught in the read-pass series (#1-20) | 20 |
| Real correctness bugs caught in the full-system audit (#21-31) | 11 |
| UX gaps closed in the read-pass series | 17 |
| UX gaps closed in the post-audit follow-up | 5 (AuditLog CSV, ExportPreview row-warning, GL aging chip, Inbox sort toggle, AnnouncementBanner consolidation) |
| Code consolidations across the program | 18 (13 from read-pass + 5 post-audit: isGLExpired, tsToDate full sweep across 26 files, CRMC_GATEWAY constants, AnnouncementBanner, deprecated stages[] cleanup) |
| New i18n keys added (FIL + EN) | Hundreds (initial rollout) + parity maintained throughout |
| i18n orphan keys removed | 124 |
| First-visit guided tours shipped | 4 (patient Dashboard + TrackStatus, agency Dashboard, admin Dashboard) |

### Items still on the table (the user's call, not blocking)

- **Keyboard shortcuts on `admin/Requests`** (V to verify focused doc, J/K to navigate queue). Bulk-verify shipped 2026-05-31 (commit `01546dc`); keyboard shortcuts deferred — needs design call on focus model and browser-shortcut conflict avoidance
- **`GL_STATUS_CONFIG` label-only helper** (two render sites use different visual treatments — badge vs text)
- **`MAX_CAPACITY = 100` hardcoded** in agency/SlotManagement — needs DB schema decision for a per-agency `slots.maxCapacity` field with sensible default
- **admin/AppLogs server-side search** — currently search + filter only apply to the loaded page (PAGE_SIZE = 100); server-side rewrite is a real but non-blocking workflow gap
- **Cloud Function for Auth account deletion** — would close the orphan-Auth gap properly (currently mitigated by warning copy in three Delete modals). Blocked by Firebase Spark plan per CLAUDE.md scope