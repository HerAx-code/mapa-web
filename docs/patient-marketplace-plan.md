# Patient Marketplace Plan — the patient chooses the hospital

**Status:** 🚧 IN PROGRESS (owner decisions locked 2026-11-14). Builds on
docs/multi-hospital-network-plan.md and **supersedes its decision D2** ("a patient
belongs to one hospital, decided by the access code").

## 1. Decisions (owner, 2026-11-14)

| # | Decision | Answer |
|---|---|---|
| M1 | Patient account | **Network account.** Registers once, belongs to no hospital. Each request is filed at a hospital the patient chooses; that hospital's gateway sees that request and the patient's profile — nothing from other hospitals. |
| M2 | Patient Access Code | **One code per request.** Registration needs no code. To file at a hospital the patient enters a code issued by THAT hospital (proof of an in-person visit there). Each code backs exactly one request. |
| M3 | What the patient compares | Partner agencies · programs (assistance types) + today's open slots · location + contact · typical turnaround. |

Why per-request codes: assistance pays a specific hospital bill, and the hospital's
social-services office must verify + assess the case. The code keeps that
in-person gate exactly where it matters (filing), while the patient chooses.

## 2. Data model

| Field | Meaning |
|---|---|
| `users/{patient}.tenantId` | The patient's **current** hospital — the one they are filing at / were last verified at. Drives branding and the `tenantId` stamped on new uploads + the request (so the existing `createsInOwnHospital()` checks keep working). |
| `users/{patient}.tenantIds` | **Every** hospital the patient has filed at. A hospital's gateway may read/maintain the patient's profile only when its id is in here (the patient-side twin of agencies' `users.agencyIds`). |
| `users/{patient}.hospitalId` | The patient's **current** access code (unchanged meaning). |
| `hospitalIds/{code}.requestId` | The request this code backed — set in the same batch as the request; a code backs one request only. |
| `patientCooldowns/{patientId}` | The 30-day post-approval cooldown, **per patient** (was stored on the patient's single access code; with a code per request a patient could dodge it at another hospital). |
| `hospitalsPublicStats/{hospitalId}` | Public counts for the marketplace: typical days from filing to first endorsement (`turnaroundDays`, published only when based on ≥ 5 requests). Admin-SDK written; no patient data. |

## 3. Flows

**Register:** personal info → account. No access code step. Patient doc carries no
hospital yet.

**Choose a hospital** (`/patient/hospitals`, also step 0 of Request Assistance):
cards per participating hospital (hospitalsPublic) — location + contact, partner
agencies and the assistance types they fund, today's open slots, typical turnaround.

**File a request at the chosen hospital:**
1. Patient enters the hospital's access code → checked (exists, available, issued
   by THIS hospital, hospital taking sign-ups).
2. One transaction claims it: `hospitalIds/{code}` available → used (`patId`), the
   patient's `tenantId` = the hospital, `tenantIds` ∪= {hospital}, `hospitalId` = code.
3. Branding switches to that hospital; the existing request steps run; uploads and the
   request carry that hospital's `tenantId`; the request write also sets
   `hospitalIds/{code}.requestId`.
4. A code already backing a request can't back another — a new request needs a new
   code (from the same or another hospital). A claimed-but-unused code (patient
   abandoned the flow) is reused on return.

**Gateway:** the Patients page lists patients whose `tenantIds` include the
hospital; everything request-scoped is unchanged (requests are already tenant-tagged).

**Agencies:** cooldown read/written on `patientCooldowns/{patientId}` (the legacy
code-level cooldown is still honoured when present).

## 4. Rules (summary)
- Patient self-create: no access code required; no `tenantId` / `tenantIds` /
  `hospitalId` at creation.
- Patient self-update: may move `tenantId`, add ONE hospital to `tenantIds` and
  change `hospitalId` only together, proving (getAfter) the new code is claimed by
  this patient, was issued by that hospital, and the hospital is open.
- Gateway read of a patient: `userTenantId() in tenantIds` (array-contains provable)
  or the legacy `tenantId` match. Gateway edits never move a patient's hospitals.
- Request create: the code (`patientHospitalId`) must be the patient's, issued by the
  request's hospital, and getAfter(code).requestId == this request.
- `patientCooldowns`: agencies holding the patient's case read/write; the patient and
  their hospitals read.
- `hospitalsPublicStats`: world-readable, no client writes.

## 5. Rollout (data → client+rules, one coordinated merge)
1. `scripts/backfill-marketplace.mjs --apply` (dry run first): patients get
   `tenantIds = [tenantId]`; existing code cooldowns are copied to
   `patientCooldowns`; codes already backing a request get `requestId`. Re-run → 0.
2. Deploy indexes (users `tenantIds` array-contains + role).
3. Merge the PR → rules deploy + app rebuild together.
4. `node scripts/compute-network-stats.mjs --apply` → turnaround published.

## 6. Out of scope / follow-ups
- Moving an *existing* request to another hospital (a request stays where filed).
- Per-hospital document requirements (still network defaults, see D6).
- Push/SMS when a chosen hospital's sign-ups are paused mid-flow (the code check
  and rules already refuse it).
