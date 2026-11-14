# Multi-Hospital Network Plan — one MAPA gateway for many BARMM hospitals

**Status:** 🚧 **IN PROGRESS** — owner chose **Option B (true multi-tenancy)**
over one-deployment-per-hospital, to match the capstone title *"a multi-agency
co-funding gateway for hospitals in BARMM."* Decisions D1–D8 **locked 2026-11-13**
(owner accepted the recommended defaults). Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 script ✅ · Phase 4 ✅ (flag off) · Phase 5 ✅ · Phase 6 ✅ · Phase 7 ✅ · Phase 8 ✅
(local branch `docs/multi-hospital-phase0`, not yet merged or deployed). Phase 9 next.
**Merge/deploy:** Phases 0–4 are safe to ship as-is. **Phases 5–8 ship together,
only in the coordinated rollout** described under Phase 5 — their rules depend on
the backfills, and Phase 6's client already moves agency management to the
platform admin (merged alone, hospital super admins would lose the agency UI
before a platform admin exists).
**Supersedes:** the CLAUDE.md *Out Of Scope* line "Multi-hospital network (one host
facility per deployment)" — that line must change in Phase 0 before any code lands.
**Principle (same as de-crmc-genericization-plan.md):** one accurate,
independently-shippable step at a time. Every phase is one PR that builds, passes
`lint:i18n` + `npm run test:all`, and is verified on a Vercel preview before merge.
We optimize for *zero regressions and zero cross-hospital leaks*, not speed.

---

## 1. The model in one picture

```
                    ┌──────────── MAPA network (one deployment) ────────────┐
                    │                                                        │
   Hospital A ──┐   │   hospitals/{A}  ── gateway staff (super/staff admin)  │
   (tenant)     ├──►│                     patients, requests, intake sheets  │
   Hospital B ──┘   │   hospitals/{B}  ── its own gateway staff + patients   │
                    │                                                        │
                    │   agencies/{DSWD, PCSO, PhilHealth, MOH-BARMM, …}      │
                    │      SHARED across hospitals; partner with many        │
                    └────────────────────────────────────────────────────────┘
```

- A **hospital is the tenant.** It owns its gateway staff, patients, access codes,
  requests, documents, intake sheets, conversations, certificates, reports,
  announcements and audit trail. Every one of those docs gets a `tenantId`.
- **Agencies are network-level, not tenant-level.** A funder like DSWD or PCSO
  co-funds patients from *several* hospitals; that is the point of the title. An
  agency **partners** with a set of hospitals and sees only slices endorsed to it,
  from any partner hospital.
- **Slices (`applications`) carry both** `tenantId` (who endorsed) and `agencyId`
  (who funds).

### Key finding from the current code (2026-11-13)
Agency access is **already** keyed on `agencyId` / `requests.agencyIds`
(`firestore.rules` `requests` + `applications` read rules), so agencies need almost
no change. The leak surface is **`isAdmin()`**: today every gateway admin reads
*every* request, user, document and slice. Multi-tenancy is mostly about scoping the
gateway roles and the `users` read rule ("admins and agencies can read all users").

---

## 2. Owner decisions — 🔒 locked 2026-11-13 (recommended defaults accepted)

| # | Decision | Locked answer |
|---|---|---|
| D1 | Network-level operator role | New role **`platform_admin`** (onboards hospitals + agencies, sees network analytics, no patient PII). Existing `super_admin` / `staff_admin` become **hospital-scoped**. |
| D2 | Can a patient belong to two hospitals? | **No (v1).** A patient registers with one hospital's access code and is bound to it. A transfer is an admin action. |
| D3 | Agency budget | **One budget per agency** (as today) for v1. Per-hospital sub-allocations are Phase 9 / future work. |
| D4 | Who sets up agency ↔ hospital partnerships? | `platform_admin` creates the link; the agency_admin can see (not edit) its partner list. |
| D5 | Access-code prefixes | **Per hospital** (e.g. `CRMC-2026-00001`, `BGH-2026-00001`). The code decides which hospital the patient joins. Prefixes must be globally unique. |
| D6 | Reference data (assistance types, required docs, thresholds) | **Network defaults** from `src/data/referenceData.js` + optional **per-hospital overrides** (Phase 8). |
| D7 | Existing production data | Backfilled to **hospital #1** (the current host) in Phase 3. |
| D8 | Capstone scope | Update Ch1 Scope/Delimitations + CLAUDE.md to say "multi-hospital"; decide which phases must ship before defense. |

---

## 3. Phases (each one PR, each shippable on its own)

### Phase 0 — Decisions + docs (no code) ✅ 2026-11-13
- Record D1–D8 answers in this file.
- CLAUDE.md: remove "Multi-hospital network" from *Out Of Scope*; add a
  "Tenancy" section pointing here; add `hospitals` to the collections list.

### Phase 1 — `hospitals` collection + runtime org config (no behavior change)
- New collection `hospitals/{tenantId}`: `name`, `shortName`, `gatewayName`,
  `gatewayInitials`, `facilityName`, `accessCodePrefix`, `contactEmail`, `address`,
  `logoUrl`, `enabled`, `createdAt`.
- Seed **hospital #1** from today's `VITE_ORG_*` values (script, Admin SDK).
- `src/config/org.js`: `ORG` stays as the **env fallback**; add a
  `useHospital()` context that loads the signed-in user's hospital doc and exposes
  the same shape. Staff pages + i18n tokens (`{{gateway}}`, `{{facility}}`) read
  from it. Until Phase 2 every user resolves to hospital #1, so nothing visibly
  changes.
- Rules: `hospitals` readable by any auth user (public fields only), writable by
  `platform_admin` (and by the hospital's own `super_admin` for branding fields).

### Phase 2 — Dual-write `tenantId` on every new doc ✅ 2026-11-14
- **Field name is `tenantId`, not `hospitalId`.** `hospitalId` already means the
  patient's *access code* (`users.hospitalId = 'MAPA-2026-00001'`, the
  `hospitalIds` collection) and the rules, Register, Patients and the GL read it
  that way. Phase 1's `hospitalIdFor()` had read that access code as the tenant
  (harmless — the lookup missed and fell back — but wrong); fixed here.
- `src/utils/hospitals.js`: `tenantIdFor(user)` (patients + gateway staff →
  `user.tenantId` or hospital #1; **agency users → null**, they are network-level),
  `currentTenantId()` (set at sign-in), `withTenant(data, id?)` (adds the field only
  when there is a tenant — never `tenantId: null`). `ORG` is branding-only now, so a
  hospital doc that fails to load can't mis-stamp data.
- Stamped on create: `users` (Register — copied from the access code's tenantId;
  Accounts — the admin's), `hospitalIds`, `requests`, `applications` (the
  request's tenant), `documents` + `documentContents`, `conversations`
  (gateway-started), `certificates` + `referralSuggestions` (the slice's / case's
  tenant, even though an agency writes them), `reports`, `announcements` (gateway),
  `auditLog` (gateway/patient actors).
- **Not stamped (by design):** agency-only docs (agency announcements, budget
  requests, agency users, agency-started conversations); `notifications/{uid}` —
  already scoped by recipient uid; Cloud Function writes → Phase 9; `/seed`.
- Nothing *reads* it yet → zero behavior change.
- Rules: `users.tenantId` is **pinned on self-update** (patients and agency
  admins can't set or change it; a transfer is a gateway-admin action, D2).
  Create-time equality checks (`tenantId == the writer's tenant`) are deferred to
  **Phase 5**: until the Phase 3 backfill, users carry no tenantId, so an equality
  rule would have nothing to compare against. Patient/agency updates on
  requests/documents are already key-allowlisted, so tenantId is immutable there.
- Tests: `tests/utils/hospitals.test.js`, `tests/rules/tenancy.rules.test.js`.

### Phase 3 — Backfill existing data ✅ script ready 2026-11-14 (not yet run on production)
- `scripts/backfill-tenant-id.mjs` (Admin SDK). **Dry run by default**; writes only
  with `--apply`. Idempotent: touches only docs with no `tenantId` and writes only
  that one field (no `updatedAt` bump). Reads via `select()` so the large
  `documentContents` files are never downloaded. Paged (500) + batched (400).
- Which docs get stamped lives in `scripts/lib/tenant-backfill-plan.mjs` (unit-tested
  in `tests/utils/tenantBackfillPlan.test.js`) and mirrors Phase 2's create-time
  stamping: patient/gateway records yes; agency users, agency-only conversations,
  budget requests, agency announcements and agency-actor audit entries no.
- Triggers fire on the updates; all are no-ops for a tenantId-only change except
  `syncRequestFinancials`, which re-derives each slice's request totals (only
  changes a request that had drifted — that trigger's job).
- Verified end to end on the emulator (613 seeded docs incl. 601 requests across
  pages: dry run → apply → re-run reports 0 to stamp).
- **Run order on production:** (1) Phases 1–2 merged + deployed, (2)
  `seed-default-hospital.mjs`, (3) backfill dry run, review counts, (4) `--apply`,
  (5) dry run again → expect 0 to stamp. The script refuses `--apply` if
  `hospitals/<tenant>` doesn't exist.

### Phase 4 — Tenant-scoped queries (client) ✅ 2026-11-14 — dormant behind a flag
- **`VITE_TENANT_SCOPING` (default `false`).** Turning it on before the Phase 3
  backfill would hide every record without a `tenantId`, so the code ships dormant.
- Helpers in `src/utils/hospitals.js` (unit-tested):
  - `tenantWhere()` → `[where('tenantId','==',tid)]` (or `[]` when off / agency user),
    spread into ~30 gateway queries across Dashboard, Requests, Patients, AppLogs,
    AuditLog, Analytics, Reports, HospitalIDs, Accounts, Agencies, AgencyDetail,
    AddAgency, ProfileModals (admin notify).
  - `getUsersInScope(db, roles?)` → own hospital's users **plus** agency users (two
    queries; one can't say "tenant X or no tenant"). Used by the message composers
    and the announcement broadcasts.
  - `inMyTenant(doc)` → client-side filter for announcements (small, readable by
    all): own hospital's + network-wide (no tenantId) ones.
- **Unchanged by design:** queries already narrowed by `patientId`, `requestId`,
  `participants`, or `agencyId` (agency users, agency inbox); reference data
  (agencies, assistance/document types); `notificationErrors`; `/seed`.
- Indexes added to `firestore.indexes.json` for every tenant + orderBy query
  (users, documents, applications, reports, auditLog, referralSuggestions).
  Equality-only combinations use Firestore index merging.
- **Enable order:** (1) deploy indexes (`firebase deploy --only firestore:indexes`)
  and wait until they finish building, (2) backfill verified 0 left, (3) set
  `VITE_TENANT_SCOPING=true` in Vercel and redeploy, (4) preview-test every staff
  page.
- **Follow-ups:**
  - ~~Agency-side Hospital column + filter~~ — done in Phase 7 (Inbox: hospital
    label per row + a filter once slices come from more than one hospital).
  - Audit entries by **agency** actors carry no tenant (Phase 2: agencies are
    network-level), so with scoping on they leave the gateway Audit Log page; they
    stay on each request's timeline (queried by `requestId`). Phase 9: a Cloud
    Function stamps the case's tenant from `requestId`.

### Phase 5 — Rules enforce the boundary ✅ 2026-11-14 (not deployed)
- Helpers in `firestore.rules`: `defaultTenant()` (= `'hospital-1'`, must equal
  `VITE_DEFAULT_HOSPITAL_ID`), `userTenantId()`, `isHospitalAdmin(data)`,
  `isHospitalSuperAdmin(data)`, `createsInOwnHospital()`, `hospitalAdminWrite()`.
- Every gateway `isAdmin()` on tenant data is now hospital-scoped: users, requests,
  applications, documents, documentContents, certificates, reports, auditLog,
  hospitalIds (+ privateInfo), referralSuggestions, announcements (gateway ones),
  conversation/message deletes, hospitals (own doc only).
- Writes stay in the writer's hospital: patients file requests/documents and
  register (via the access code's tenant) only in their hospital; admins can't
  create in or move records/users to another hospital (transfers → Phase 6);
  agency-written GLs and referral suggestions must carry the **case's** tenant.
- Unchanged by design: agencies keep agencyId-based access across hospitals;
  network config (agencies, agenciesPublic, documentTypes, assistanceTypes),
  notificationErrors, docReviewPresence; hospitalIds single-doc `get` stays open to
  signed-in users (registration verifies a code before the patient has a hospital).
- **Leak found and fixed during testing.** The first version defaulted a missing
  doc `tenantId` to hospital #1. Rules are evaluated against a query's *filters*,
  where an unfiltered field reads as absent — so every **unfiltered** admin query
  passed and returned other hospitals' docs (reproduced on the emulator: hospital
  A's admin listed hospital B's request). Gateway access to existing docs is now
  **strict** (`resource.data.tenantId == userTenantId()`, no default); the default
  survives only for the signed-in user's doc and for new docs.
- Client: the remaining admin lookups keyed only by patient/request
  (Patients, Requests detail) now also carry `tenantWhere()` — required, since an
  admin query without a tenant filter is denied.
- Tests: `tests/rules/tenantBoundary.rules.test.js` (54) — every tenant collection
  cross-hospital read/update/delete denied, own-hospital and other-hospital
  queries, unfiltered queries denied, agency cross-hospital access kept,
  registration/creates/moves. Older rules-test fixtures now model the
  post-backfill state (`tenantId: 'hospital-1'`). 308/308 rules tests pass.
- **Rollout is one coordinated step — never deploy these rules on their own:**
  (1) Phases 1–4 deployed, (2) seed hospital #1, (3) backfill `--apply` and
  re-verify 0 left, (3b) **Phase 7:** `scripts/backfill-partnerships.mjs --apply`
  and re-verify 0 left (agency partner lists + patients' `agencyIds` — without
  it agencies lose the patient profile on in-flight cases),
  (4) deploy indexes and wait for them to build,
  (4b) **Phase 6:** create the network operator with
  `scripts/create-platform-admin.mjs --apply` (once these rules are live, only a
  platform_admin can manage agencies), (5) set
  `VITE_TENANT_SCOPING=true` + redeploy the app **and** deploy these rules
  together. Rules without the flag → every gateway list query is denied; rules
  before the backfill → untagged records unreachable by staff.
- Accepted gaps (follow-ups):
  - ~~Agencies can still read every `users` doc~~ — closed in Phase 7 (only
    patients endorsed to the agency, via `users.agencyIds`).
  - ~~Any hospital's admin can still edit network config~~ — closed in Phase 6.
- Note: each `get(users/uid)` in rules is a billed read (cached within one
  evaluation, so role + tenant cost one). If rule cost becomes a problem, move
  `role`, `tenantId`, `agencyId` into **custom claims** (set by a Cloud Function) —
  tracked as a follow-up, not v1.

### Phase 6 — Roles: `platform_admin` + hospital-scoped admins ✅ 2026-11-14 (not deployed)
- **Role.** `ROLES.PLATFORM_ADMIN` (`'platform_admin'`, shown as "Network Admin"):
  no tenant (`tenantIdFor` → null, like agency users), **no patient data** — it is
  not in `isAdmin()`, so every hospital-scoped rule denies it. MFA + idle timeout
  apply as for other staff. Created only by `scripts/create-platform-admin.mjs`
  (Admin SDK, dry run by default, refuses an email that already has another role,
  prints a one-time password link); a demo account is in `scripts/demo-accounts.js`.
- **Pages.**
  - `/platform/hospitals` (`src/pages/platform/Hospitals.jsx`): list hospitals with
    their admin counts, **add** a hospital (id, name, gateway office, access-code
    prefix, contact), **edit** it, and **add its first administrator** (secondary
    Auth app, `src/utils/staffAccounts.js`). Form rules in
    `src/utils/hospitalConfig.js` (unit-tested): slug ids, prefixes `[A-Z][A-Z0-9]{1,9}`
    (they go into the access-code regex), **prefix unique across hospitals** (D5).
  - Agencies: the existing `/admin/agencies` pages, now managed by the platform
    admin (add, edit, enable/disable, slots, team, public resync). Hospital admins
    keep a read-only directory. The platform view shows no case counts and no
    messaging; disabling an agency **holds** its in-flight slices (the platform
    admin can't read or reject them) and each hospital re-endorses.
- **Rules.**
  - `users`: hospital admins create/edit only gateway staff (+ their own patients'
    non-role fields) in their own hospital — a **role allowlist**; before it, an
    admin could mint any role, which would have included `platform_admin`. They can
    no longer create/edit/delete agency users or touch a platform admin (whose
    missing tenantId would otherwise default to hospital #1). The platform admin
    creates staff into an **existing** hospital, agency users with no tenant,
    transfers staff between hospitals (D2), and never touches patients or other
    platform admins.
  - `hospitals`: platform admin creates + edits; a hospital's super admin edits only
    its own **branding** (not `accessCodePrefix`, not `enabled`).
  - `agencies`: create/delete/edit → platform admin. Hospital admins keep only
    `slots.remaining` + `lastResetDate` (the endorse decrement and the daily-reset
    fallback); `slots.total` pinned. `agenciesPublic` delete → platform admin.
  - `documentTypes`, `assistanceTypes` → platform admin only.
- Tests: `tests/rules/platformAdmin.rules.test.js` (44: no PII reachable, onboarding,
  user management bounds, agency/reference-data ownership, slot paths kept),
  role-escalation cases in `users.rules.test.js`, `tests/utils/hospitalConfig.test.js`.
  356/356 rules tests pass.
- Deferred, by design:
  - **Network analytics** — Firestore counts need read access to the counted docs,
    and the platform admin must not read patient records, so aggregates come from
    a Cloud Function-maintained stats doc (Phase 9).
  - **Partnerships** → Phase 7. **`enabled` enforcement** (a disabled hospital's
    codes stop registering) and a server-side prefix-uniqueness guarantee → Phase 8
    with per-hospital access codes; until then the platform admin is the only
    writer and the form checks uniqueness.
  - **Patient transfer** between hospitals moves every record they own — an Admin
    SDK script, not a client action (future).
  - A platform audit view: its entries are untagged and readable by no one yet
    (Phase 9).
  - The dev `/seed` page can no longer run end to end under the Phase 5/6 rules
    (network config vs. access codes need different roles); use the Admin SDK
    bootstrap scripts.

### Phase 7 — Agency ↔ hospital partnerships ✅ 2026-11-14 (not deployed)
- **Data.** `agencies/{id}.partnerHospitalIds: [tenantId]` — the hospitals whose
  gateways may endorse to the agency (a `partnerships` collection only if per-pair
  terms are ever needed). An agency with **no list** (onboarded before Phase 7)
  partners with **hospital #1 only** — in the rules (`agencyPartners()`, a default
  on one concrete doc fetched with `get()`, never a query shape) and in the client
  (`partnerHospitalIdsOf` / `agencyPartnersWith`, src/utils/hospitals.js).
- **Who sets it (D4).** The platform admin: a partner picker on Add Agency
  (required; preselected in a one-hospital network) and a **Partner hospitals** card
  on the agency page (`src/components/admin/PartnerHospitals.jsx`). Agency staff and
  hospital admins see it read-only (agency Profile page) and can't change it (rules).
  The Hospitals page shows each hospital's partner-agency count (flags "None").
- **Endorsement.** The gateway's endorse modal and the agencies' Suggest-another-
  agency modal list **only partners of the case's hospital**; the rules deny a slice
  (`applications` create) or a referral suggestion to any other agency. The
  patient's Find Programs page lists only their hospital's partners.
- **Agencies read only their own patients** (closes the Phase 5 gap). `users` read
  for agency roles: `userAgencyId() in resource.data.agencyIds` (+ staff/agency docs,
  as before). The endorse flow adds the endorsed agencies to the patient's
  `users.agencyIds` (after commit, best-effort — like the document `agencyIds`
  stamps). Patients can't change it. Agency composers use `getUsersInScope(db,
  roles, viewer)` → staff + agency users + `agencyIds array-contains <agency>`
  (rules-provable; an unfiltered or `role == patient` query is denied).
- **Agency inbox.** Hospital label per row; a hospital filter once slices come from
  more than one hospital (`src/hooks/useHospitals.js`).
- **Backfill:** `scripts/backfill-partnerships.mjs` (dry run by default, additive,
  idempotent; plan in `scripts/lib/partnership-backfill-plan.mjs`, unit-tested):
  agencies without a list → `[hospital #1]`; each patient's `agencyIds` ← every
  agency holding one of their slices. Verified on the emulator (dry run → apply →
  re-run reports 0; existing lists and ids untouched).
- Tests: `tests/rules/partnerships.rules.test.js` (16) — partner-only endorse and
  suggestion, legacy default, missing agency denied, list ownership, agency patient
  reads (single doc, array-contains query, broad queries denied), who writes
  `agencyIds`. Older fixtures seed the agencies their slices name. 372/372 rules
  tests pass.
- **Decision — `agenciesPublic` stays network-wide.** The public Landing teaser has
  no hospital context before sign-in, so it lists the network's programs; the
  signed-in patient's Find Programs page is the per-hospital view.
- Follow-ups: the Agencies-page quick "Add agency" modal (not the full Add Agency
  page) doesn't ask for partners — such an agency defaults to hospital #1; the
  platform admin sets partners on its page. Per-hospital agency budgets stay D3
  future work.

### Phase 8 — Per-hospital access codes + configuration ✅ 2026-11-14 (not deployed)
- **Each hospital issues codes under its own prefix.** `accessCodePrefix` joined the
  hospital branding fields (`applyHospital`), so a gateway's Access Codes page
  issues `<its prefix>-YYYY-NNNNN`. Rules: a code may be created only under the
  issuing hospital's prefix (`hospitalIds` create), so hospitals can never collide
  in the single `hospitalIds/{code}` namespace.
- **Registration accepts any hospital's code.** Web (`accessCodeRe()`) and the
  `verifyAccessCode` function check the prefix *format* (`[A-Z][A-Z0-9]{1,9}`); the
  code doc decides whether it exists and which hospital the patient joins
  (`users.tenantId` ← the code's `tenantId`, since Phase 2). Register's input mask
  no longer snaps back to the deployment prefix, the keypad is text until the
  prefix + year are in, and after verifying it tells the patient which hospital
  they're joining (bilingual).
- **Prefixes are unique server-side (D5).** New collection
  `accessCodePrefixes/{PREFIX}` = `{ tenantId }`: created once by the platform admin
  in the same batch as the hospital (rules: `prefixHeldBy` via `getAfter`), never
  changed or deleted — a retired prefix stays reserved because its codes still
  exist. A hospital may carry only a prefix it holds. `seed-default-hospital.mjs`
  claims hospital #1's prefix (also when the hospital doc already exists).
- **`enabled` = new sign-ups open.** Platform admin: "Pause / Resume sign-ups" on the
  Hospitals page. A paused hospital's codes are refused by Register, by
  `verifyAccessCode` (`hospitalClosed: true`), and by the rules (patient
  self-create checks `hospitalOpen`). Its staff and existing patients are
  unaffected.
- **Documents carry the case hospital's identity.** `brandingFor(hospital)` (pure,
  `src/config/org.js`) + `fetchHospitalBranding(tenantId)` (cached) +
  `useHospitalBranding`. The Guarantee Letter (`GuaranteeLetter` `org` prop, GL
  viewer) and the intake sheet (`buildIntakeSheetHTML({ org })`, whose seal was a
  module-level constant frozen at first load) print the CASE's hospital — an agency
  user used to get hospital #1's name and seal on every hospital's letter. The
  hospital address prints in the header when set.
- **Emails:** the footer names the sender's hospital; agency and platform senders
  (no hospital) sign with the network brand only, never hospital #1's name.
- **Hospital Settings** (`/admin/settings`, super admin): name, short name, gateway
  office, seal initials, contact email, address — applied live after saving. The
  prefix and sign-up status show read-only (network decisions).
- Tests: `tests/rules/accessCodes.rules.test.js` (13) — claims (batch, taken,
  retired, re-use own, malformed, permanent, platform-only), own-prefix issuance,
  paused-hospital sign-up; function tests for any prefix / unknown prefix / paused
  hospital; unit tests for `brandingFor`, `accessCodeRe`, `fetchHospitalBranding`
  and the intake sheet's case branding. 385/385 rules, 402 unit, 96 function, 133
  component tests pass.
- Deferred, by design:
  - **Per-hospital reference-data overrides** (document sets, thresholds) — the
    per-type checklist itself is still flag-off (`VITE_PER_TYPE_DOCS`) pending the
    gateway's confirmation of the real lists; overriding unconfirmed defaults per
    hospital would multiply guesses. Revisit when the flag goes on.
  - **Logo upload** (`logoUrl` is allowed by the rules; no Storage upload UI yet).
  - The Landing page's example code shows hospital #1's prefix (no hospital before
    sign-in). `buildCertificateHTML` in agency/CertificateGenerator.jsx is unused
    (the page opens the GL viewer) and still reads `ORG` — delete in a cleanup.

### Phase 9 — Functions + analytics + polish
- Cloud Functions: stamp/propagate `tenantId` where they create docs
  (notifications, `onRequestWritten`, `syncRequestFinancials`, `glExpirySweep`).
- Admin analytics scoped per hospital; platform analytics across hospitals.
- Optional: per-hospital agency sub-budgets (D3 follow-up).

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| A missed rule leaks one hospital's patients to another | Phase 5 tenancy test suite covers every collection; rules ship *after* data and queries are ready, never before |
| A missed query returns empty lists after rules tighten | Phase 4 ships before Phase 5; preview-test every staff page as a hospital-#2 admin |
| Missing composite index breaks a page in prod | Deploy indexes before the merge |
| Rule `get()` cost / 10-get limit | Custom-claims follow-up (Phase 5 note) |
| Scope creep before defense | D8: pick the minimum phase set for defense (suggested: 0–5 + 7) |

## 5. Definition of done
Two hospitals run on one deployment; each one's staff sees only its own patients;
a shared agency sees and funds slices from both partner hospitals; the tenancy rules
tests prove every cross-hospital access is denied.
