# Phase 5 plan — cleanup (T7) and two-factor stage 2

Status: **plan accepted 2026-11-22 (P5-A to P5-D); PR 5.1 merged and deployed (#427); PR 5.2 merged and deployed (#428); PR 5.3 merged (#429); PR 5.4 built on `feat/staff-mfa-stage2`.** Phases 1–4 are shipped (docs/phase1-messages-accounts-plan.md, docs/phase2-money-plan.md, docs/phase3-evidence-codes-plan.md, docs/phase4-case-endings-plan.md). Source: the MAPA process-logic gap map, theme T7 (N3–N6, R5–R8, R10), plus the leftovers found while building Phases 2–4. Each item was re-checked against `main` after #426.

## What is left

### Still open from the gap map

| Gap | Summary | Today |
|---|---|---|
| N3 | The patient display ID `PAT-NNNNNN` is the last six digits of the clock, so two sign-ups can get the same one | `Register.jsx:581`. Production has 20 patients and **no repeats yet** (read-only check, 2026-11-22), so only the generator needs fixing. |
| N4 | Some admin actions write no audit entry | The Super Admin's "reset slots" and the staff password-reset emails (`AgencyDetail.jsx`, `Accounts.jsx`) |
| N6 | The rules let the Super Admin open sign-ups at a hospital still in onboarding; only the hidden button prevents it | `firestore.rules` hospitals update. CLAUDE.md: only the go-live step may open an onboarding hospital. |
| R10 | The public hospital listing (`hospitalsPublic`) is written from the browser in 5 places | The rules pin every field to the hospital doc, so it can't lie, but it can be left stale if a page fails after saving. The training hospital's exclusion lives in the browser helper. Agencies moved to a trigger in Phase 1. |

### Found while building Phases 2–4

| # | Summary |
|---|---|
| L1 | **A patient's Proceed writes its audit entry from the browser** (`utils/proceed.js`), which the Phase 3 PR 3.5 rules now refuse. The entry is silently lost, so the case timeline no longer shows when the patient accepted. `onSliceProceeded` already runs on the server for every Proceed. |
| L2 | **10 staff profiles have no sign-in account** (read-only check: 31 active staff profiles, 21 with an account). They are leftovers of deleted or demo accounts. They still appear in team lists and email lookups, and the hospital they name still counts them. |
| L3 | **CLAUDE.md has statements the phases made untrue.** Agency coordinators "write budget usage and slots" (Phase 2); claiming "checked by the rules" and "in one transaction in `src/utils/accessCodes.js`" (Phase 3 PR 3.4); `approvalMarks` "30-day cooldown" (now the per-agency repeat limit). The Phase 3 and 4 plans also still mark their last PRs "built". |
| L4 | **Dead code for removed statuses and names.** Display labels for `pending` / `interview`; the alias `isRequestClosedByGateway`; the old name `APPROVAL_COOLDOWN_DAYS`. |

Already fixed by earlier phases, so not in this plan: **N5** (the agency Dashboard's browser slot reset is gone), **R5** (Track Status no longer notifies from the browser), **R6** (the document owns its status, Phase 3 PR 3.1), **R7** (one amount field), **R8** (Mark issued is one server action).

### Two-factor stage 2
- **Stage 1 has been live since 2026-11-22.** Staff without two-factor are sent to set it up at sign-in.
- **Stage 2 is planned:** the rules and the callable functions refuse a staff session without a second factor, so a stolen password alone is useless even outside the app.
- **Nobody is enrolled yet.** The read-only check found **0 of 21 active staff sign-ins enrolled.** Stage 2 today would lock every staff member out.

---

## Decisions (all four accepted, 2026-11-22)

### P5-A. Patient display IDs (N3)
**Recommendation:**
- The server assigns the display ID when a patient account is created: `PAT-000021`, `PAT-000022` and so on, taken from a counter in a transaction by the existing `onPatientIdentityWritten` path, or a small `onUserCreated` trigger.
- Registration stops making one up.
- Existing IDs stay as they are (none repeat); the counter starts above the highest.

Why: the ID is printed and read out at the desk, so it must be unique. Renumbering existing patients would break what staff already wrote down.

### P5-B. The public hospital listing (R10)
**Recommendation:**
- Make it like the agencies: one trigger, `onHospitalWritten`, writes `hospitalsPublic`, skips the training hospital, and removes the listing when a hospital is deleted.
- The rules refuse browser writes. The five browser calls go.
- A one-off resync, report first, makes the listing equal the hospitals now.

Why: one writer can't be left half-done, and the training-hospital rule is then enforced by the server, not by a helper every page must remember.

### P5-C. Staff profiles without a sign-in account (L2)
**Recommendation:**
- A report-first script lists them: name, role, hospital or agency, last activity.
- On your OK, it marks each `active: false` with `orphaned: true`, which takes it out of team lists and email lookups.
- It never deletes them: audit entries and case history name these people, and the profiles keep those names readable.

### P5-D. When two-factor stage 2 ships
**Recommendation:**
- Build stage 2 now, behind a switch that is **off**: a rules function `staffHasSecondFactor()` reading `request.auth.token.firebase.sign_in_second_factor`, a check in every staff callable, and an "enforce" flag in a config document only the Super Admin can set.
- Turn it on only when both are true:
  1. a report shows every active staff sign-in enrolled;
  2. it is at least two weeks after stage 1 (from 2026-12-06).
- The same report lists who still needs to enrol, so each hospital can chase its own staff.

Why: enforcement is the point, but switching it on before enrolment locks the offices out of live cases. A switch also gives a one-step rollback if a hospital reports a problem.

---

## PR 5.1 — Small correctness fixes (N4, N6, L1)
1. **N4:** audit entries for the Super Admin's slot reset (`agency_slots_reset`) and for staff password-reset emails (`password_reset_sent`, written by the staff member who sent it).
2. **N6:** the hospitals rule refuses `enabled: true` on a hospital whose `onboarding.stage` isn't `live` (training hospital excepted), unless the same write sets the stage to `live`. That is the go-live step.
3. **L1:** `onSliceProceeded` writes the `patient_proceeded` audit entry on the server. The browser call in `utils/proceed.js` is removed, and `patient_proceeded` joins the server-only audit actions.
4. **Tests:** rules tests for the onboarding guard and the audit entries; a function test for the proceed audit entry.
5. **As built:**
   - **The rules function `onboardingOpenOk()`** refuses only the opening move (`enabled` false → true) on a hospital whose stage isn't `live`. Closing, the go-live write itself, live hospitals and the training hospital are unaffected.
   - **The Proceed audit entry** is written by `onSliceProceeded`, even when the agency has no coordinators.

## PR 5.2 — Patient IDs and the hospital listing (P5-A, P5-B)
1. Server-assigned `patientId` from `counters/patientIds`, with a one-off script that seeds the counter above the highest existing ID (report first).
2. `onHospitalWritten` plus the rules refusing browser writes to `hospitalsPublic`. The browser calls are removed. A resync script, report first.
3. **Tests:** trigger tests (training hospital skipped, deletion), and a registration test that the browser no longer sets `patientId`.
4. **As built:**
   - **Patient IDs.** `assignPatientId` (functions/src/patientIds.js), `onDocumentCreated users/{uid}`, retried on failure. It **seeds itself**: with no counter it starts one above the highest `PAT-` number in use, inside the same transaction. So the planned seed script wasn't needed.
   - **The hospital listing.** `onHospitalWritten` with the shared projection in `src/shared/hospitalPublic.js`. The browser helper `syncHospitalPublic` is gone.
   - **The resync script (`scripts/resync-hospitals-public.mjs`).** Its report run (2026-11-22) found the 2 published listings already current and nothing to remove, so no write was needed.

## PR 5.3 — Records and docs (P5-C, L3, L4)
1. `scripts/report-orphan-staff.mjs`: report, then `--write` on your OK (`active: false`, `orphaned: true`).
2. Remove the dead labels and aliases (L4).
3. Bring CLAUDE.md and the phase plans up to date (L3).
4. **As built:**
   - **Orphan profiles.** `scripts/report-orphan-staff.mjs` found 12 agency staff profiles with no sign-in account (10 still active) at Malasakit, PCSO, AMBAG, DOH, PhilHealth and DSWD. On the owner's OK (2026-11-22) all 12 were marked `active: false, orphaned: true`; none was deleted. A re-run shows none left.
   - **Dead code.** The legacy filters (`pending`, `interview`) are gone from App Logs, the agency Logs, Export and the agency queue, along with the aliases `isRequestClosedByGateway` and `APPROVAL_COOLDOWN_DAYS`. Display code that renders old records is kept.
   - **A bug found while doing it.** The agency Dashboard's "Review" opened the removed `pending` queue, so the case page's previous/next found nothing; it now opens `reviewing`.

## PR 5.4 — Two-factor stage 2, switched off (P5-D)
1. The rules function and the callable checks, behind `config/security.enforceStaffMfa` (default off; Super Admin only).
2. `scripts/report-staff-mfa.mjs`: who is enrolled, per hospital and agency.
3. The switch is turned on separately, on your OK, once the report shows everyone enrolled and the date has passed.
4. **Tests:** rules tests with and without a second factor, the switch on and off.
5. **As built — the switch is code, not a config document.** The plan said `config/security.enforceStaffMfa`. Instead it is `enforceStaffMfa()` in firestore.rules plus `ENFORCE_STAFF_MFA` in functions/src/mfaPolicy.js, and a test checks the two agree. Why:
   - no extra document read in every rule check;
   - turning it on needs a reviewed rules + functions deploy, which a stolen Super Admin session can't do;
   - turning it off again is the same one-line change.

   Where the check runs:
   - **Rules:** `staffMfaOk()` is added to the five staff-role helpers. A staff member's own profile stays readable, so MfaGate can send them to enrol, and patients are exempt.
   - **Callables:** `assertStaffMfa` runs in every staff callable — the account, case, slice, code, amendment, conversation, flag-clearing, agency-count and resync callables.
   - **Readiness report (2026-11-22):** 0 of 21 active staff sign-ins enrolled.

## Deploy order (each PR)
1. Regenerate the bundle; deploy the functions.
2. Merge; Vercel deploys the pages.
3. Deploy the rules after the web change is live.
4. PR 5.2 and PR 5.3 scripts run report-first, written on your OK.

## Not in Phase 5
- Anything new. Phase 5 only finishes and tidies what Phases 1–4 changed.
