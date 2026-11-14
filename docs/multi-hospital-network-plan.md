# Multi-Hospital Network Plan — one MAPA gateway for many BARMM hospitals

**Status:** 🚧 **IN PROGRESS** — owner chose **Option B (true multi-tenancy)**
over one-deployment-per-hospital, to match the capstone title *"a multi-agency
co-funding gateway for hospitals in BARMM."* Decisions D1–D8 **locked 2026-11-13**
(owner accepted the recommended defaults). Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 script ✅ · Phase 4 ✅ (flag off)
(local branch `docs/multi-hospital-phase0`, not yet merged). Phase 5 next.
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
  - Agency-side Hospital column + filter (Inbox / Dashboard) moves to Phase 7, where
    agencies get partner hospitals to list.
  - Audit entries by **agency** actors carry no tenant (Phase 2: agencies are
    network-level), so with scoping on they leave the gateway Audit Log page; they
    stay on each request's timeline (queried by `requestId`). Phase 9: a Cloud
    Function stamps the case's tenant from `requestId`.

### Phase 5 — Rules enforce the boundary (the real security line)
- Helpers: `userTenantId()`; `isHospitalAdmin(hid)` =
  `isAdmin() && userTenantId() == tid`; `isPlatformAdmin()`.
- Replace every bare `isAdmin()` on tenant data with
  `isHospitalAdmin(resource.data.tenantId)`.
- `users` read rule: staff may read users **of their own hospital**; agencies may
  read only patients who have a request endorsed to them (today: all users).
- `hospitalIds` (access codes): admin of the owning hospital only.
- **Tests first:** `tests/rules/tenancy.test.js` — for every tenant collection,
  Hospital B's admin is DENIED read/write on Hospital A's doc; agency of a
  non-partner hospital is denied; patient sees only own data. This PR does not
  merge unless every cross-tenant case is denied.
- Note: each `get(users/uid)` in rules is a billed read and counts toward the
  10-gets-per-request limit. If rule cost becomes a problem, move `role`,
  `tenantId`, `agencyId` into **custom claims** (set by a Cloud Function) — tracked
  as a follow-up, not v1.

### Phase 6 — Roles: `platform_admin` + hospital-scoped admins
- Add `ROLES.PLATFORM_ADMIN`; new `/platform/*` pages: Hospitals list, Add Hospital,
  Agencies (network-wide), Partnerships, Network analytics (aggregates, no PII).
- `admin/Accounts.jsx`: hospital admins create staff only in their own hospital.
- MFA required for `platform_admin` (same as other staff roles).

### Phase 7 — Agency ↔ hospital partnerships
- `agencies/{id}.partnerHospitalIds: []` (or a `partnerships` collection if
  per-pair terms are needed later).
- Endorse / SuggestEndorsement modals list **only agencies partnered with the
  endorsing hospital**.
- Rules: an endorse write must target a partner agency.
- `agenciesPublic` (landing-page teaser) filtered per hospital.

### Phase 8 — Per-hospital access codes + configuration
- `verifyAccessCode` + `orgConfig.js`: accept any **enabled hospital's** prefix;
  the matched prefix's hospital sets `users.tenantId` at registration
  (Register already copies `hospitalIds/{code}.tenantId` since Phase 2).
- Guarantee Letter, intake sheet (`intakeSheetHTML.js`), emails (`api/send-email.js`)
  render the **endorsing hospital's** name/logo/address.
- Optional per-hospital overrides of `referenceData.js` (document sets,
  thresholds) stored on the hospital doc.
- Hospital Settings page for the hospital `super_admin` (branding + contact).

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
