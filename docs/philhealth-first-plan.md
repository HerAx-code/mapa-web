# PhilHealth-First Funding — Implementation Plan (Option 1)

**Status:** ✅ EXECUTED 2026-08-27 (code + production migration applied; docs reframed)
**Date:** 2026-08-26 (planned) · 2026-08-27 (executed)
**Owner:** Capstone Project Group
**Scope decision on file:** "Investigate a real model change" (2026-08-25)

> **Execution note (2026-08-27).** Local code shipped across `utils/requests.js`,
> `patient/RequestAssistance.jsx`, `admin/Requests.jsx`, `auth/Login.jsx`, seed +
> tests (build ✓, lint:i18n ✓, utils 39/39, components 64/64). Production
> migration `scripts/migrate-philhealth-first.js --apply` backfilled 6 requests
> (non-destructive), disabled the `philhealth` agency + its 2 logins; backup at
> `backups/2026-08-27T01-06-58-828Z/`. Docs reframed: this file,
> `defense-cheat-sheet.md`, `malasakit-center-research-2026-07-23.md` (ADDENDUM 2).
> Bonus finding: the i18n keys (`billLabel` etc.) already existed — the feature
> had been scaffolded and abandoned alongside the dead `computeAmountNeeded`.
> **Left for the author (thesis prose):** `thesis-summary.md`,
> `thesis-documentation.md` still describe PhilHealth as a funding partner.
> **Not committed to git** (project rule: commit only on request).

> This plan wires **PhilHealth-first as a bill deduction** so that MAPA's data
> model matches the Malasakit **Order of Charging** (JAO 2020-0001): PhilHealth/
> NHIF is drawn **first and reduces the bill**, and the remaining agencies
> co-fund the **residual**. It supersedes the current flat-slice treatment where
> PhilHealth is modelled as one of five equal endorsable agencies.
>
> Related: `docs/malasakit-center-research-2026-07-23.md` (the PhilHealth caveat),
> `docs/redesign-plan.md` (the CRMC-gateway model this extends).

---

## 1. Why this exists — the contradiction being resolved

Two incompatible PhilHealth designs currently coexist in the codebase:

| | Design A (vestigial) | Design B (live) |
|---|---|---|
| Source | `src/utils/requests.js:24` `computeAmountNeeded()` + header comment | 2026-07-24 agencies migration + the actual UI |
| PhilHealth is… | a **deduction on the request**, applied first, reducing the balance — *"not an endorsable agency"* | **one of five flat co-funding agencies**, endorsed like any other |
| Status | **`computeAmountNeeded` is never called — dead code** | This is what runs in production |

The statute-faithful "PhilHealth applies first" logic was **written but never wired**.
`computeAmountNeeded` is even unit-tested (`tests/utils/requests.test.js:13-33`)
yet has zero call sites. A later decision took the opposite path. This plan
activates Design A and retires PhilHealth-as-agency.

**Live behaviour today:** the patient types one free number, `amountNeeded`
(`src/pages/patient/RequestAssistance.jsx:786`); funding is a flat sum of
approved slices (`src/utils/requests.js:57-79`); PhilHealth is an enabled,
endorsable agency.

---

## 2. The model change (one paragraph)

`requests` gains three fields: **`totalBill`** (the Statement-of-Account total),
**`philhealthCovered`** and **`otherCovered`** (prior coverage). `amountNeeded`
stops being a number the patient types and becomes **derived and stored**:

```
amountNeeded = computeAmountNeeded({ totalBill, philhealthCovered, otherCovered })
             = max(0, totalBill − philhealthCovered − otherCovered)
```

PhilHealth stops being an endorsable agency and becomes a **coverage line on the
request**. Everything downstream keeps reading `amountNeeded` exactly as before,
so the endorsement/approval engine never moves.

**Data-entry split (matches reality):**
- Patient enters **`totalBill`** at submission (they have the bill). Coverage is
  unknown at this point, so `amountNeeded` initialises `= totalBill`.
- **CRMC** enters **`philhealthCovered`** (+ `otherCovered`) during the
  **assessment step**, because PhilHealth is computed at the center ("PhilHealth
  desk first"). `amountNeeded` is then re-derived to the residual **before**
  endorsement.

---

## 3. Pages & files that CHANGE

| File | Change | Where |
|---|---|---|
| `src/pages/patient/RequestAssistance.jsx` | Patient enters **`totalBill`** instead of a raw net figure. `amountNeeded` initialised `= totalBill`. Update create payload, validation, review summary, notify copy. | L64, L360-366, L426-443, L456, L744, L783-788, L994 |
| `src/pages/admin/Requests.jsx` | Assessment step ②: add a **"Coverage applied"** block — CRMC enters `philhealthCovered` + `otherCovered`; recompute + persist `amountNeeded`; show `bill − coverage = residual`. Gate editing to **pre-endorsement** states only. | assessment block L923-980; displays L334, L783 |
| `src/utils/requests.js` | No math change (`computeAmountNeeded` is already correct). Add a thin `deriveAmountNeeded(req)` wrapper + a display helper. | L24-27 |
| Agency data | Set `philhealth.enabled = false` (same mechanism as `malasakit`). Endorse picker filters `where('enabled','==',true)`, so it drops out automatically. | endorse loaders L1188, L1289 |
| `src/pages/auth/Login.jsx` | **Demo-integrity fix (found in the 2026-08-26 double-check).** Remove or relabel the **PhilHealth · Admin** / **PhilHealth · Coordinator** quick-login buttons + the "PhilHealth is an RA 11463 funder" comment. Otherwise the defense demo shows a PhilHealth agency portal that can no longer be endorsed to. | L293-297 |
| Seed / demo | Add `totalBill` + `philhealthCovered` to seeded requests so the demo shows the breakdown. | `scripts/seed-demo-scenario.js:226`, `scripts/demo-accounts.js` |
| Display (optional polish) | Add a `bill → PhilHealth → residual` line on request views. Not required — they already show `amountNeeded` (now the residual). | TrackStatus, agency ApplicationDetail/Dashboard/Modals |
| Docs | Reframe PhilHealth from "funder" → "first-charge coverage." | `docs/thesis-summary.md`, `docs/thesis-documentation.md`, `docs/defense-cheat-sheet.md`, `docs/malasakit-center-research-2026-07-23.md` |

## 4. Files that DON'T change (why it's low-risk)

- **`functions/src/syncRequestFinancials.js`** — reads `req.amountNeeded`; the
  field still exists (now derived), so the trigger is untouched.
- **The endorse / approve transaction, slice model, GL issuance** — the residual
  is baked into `amountNeeded` *before* endorsement, so the money path is
  unchanged.
- **`computeFunding` / `deriveRequestStatus` / `deriveRequestFinancials`** — unchanged.
- **`firestore.rules`** — no change *required*: `requests.create` pins
  (`status`, `agencyIds`, `amountCommitted`) don't touch `totalBill`; the
  `requests.update` **admin** branch is unrestricted; the **agency** branch
  (`hasOnly(['amountCommitted','status','updatedAt'])`) is unaffected. Optional
  later hardening: pin `amountNeeded <= totalBill`.
- **Login, Register, Patients, and all other pages** — untouched.

---

## 5. Migration (must run before deploy)

1. **Backfill** every existing request: `totalBill = amountNeeded`,
   `philhealthCovered = 0`, `otherCovered = 0`. Idempotent, **dry-run first,
   full backup first**. Keeps `amountNeeded` identical, so nothing shifts.
2. **Audit `philhealth` slices**: query `applications where agencyId ==
   'philhealth'`. Likely demo-only (the completed GL was reassigned to PCSO on
   2026-08-25). Decide leave-as-history vs reassign. **Blocking for risk #1.**
2a. **Audit `philhealth` user accounts**: `admin@philhealth.gov.ph` +
   `coordinator@philhealth.gov.ph` back the Login demo quick-login buttons.
   Decide their fate alongside the Login.jsx demo-panel fix (keep as a
   coverage-only login, relabel, or drop). Found in the 2026-08-26 double-check.
3. **Check `philhealth` allocation** before disabling — if it holds budget,
   redistribute (same open item as the ₱5M stranded on `malasakit`).

---

## 6. Tests

- `tests/utils/requests.test.js` — `computeAmountNeeded` already covered; add the
  `deriveAmountNeeded` wrapper case.
- New component tests: patient `totalBill` capture; CRMC coverage-recompute.
- `tests/rules/writeSinks.rules.test.js` — only if the optional
  `amountNeeded <= totalBill` pin is added.
- Seed / demo parity check.

---

## 7. Issues this change WILL introduce (honest risk list)

1. **Double-counting PhilHealth (highest risk).** If `philhealth` is disabled as
   an agency but old `philhealth` slices still count as `committed`, *and* we
   also deduct `philhealthCovered`, PhilHealth is subtracted twice. **Must**
   clear/reassign those slices in the same migration — the two representations
   must be mutually exclusive.
2. **Existing requests look broken without the backfill** — blank bill, empty
   breakdown. Mitigation: run migration first + display fallback
   `totalBill ?? amountNeeded`.
3. **`amountNeeded` becomes mutable after submission.** Today write-once; now
   CRMC edits it at assessment. If edited *after* endorsement,
   `syncRequestFinancials` could silently flip a request's status (lower residual
   → `fully_funded`; higher → reopened). Mitigation: hard-gate coverage editing
   to `under_review`/`assessment` states only.
4. **PhilHealth coverage unknown at submission** — realistic (computed at the
   center). So `amountNeeded == totalBill` until assessment, and the funding bar
   shows full need / 0% briefly. Acceptable behaviour change to explain.
5. **Patient's `totalBill` may be an interim bill** — bills grow during
   confinement. Mitigation: treat as *declared*, CRMC-verifiable (the code
   comment at `RequestAssistance.jsx:780-782` already says CRMC verifies against
   the SOA).
6. **Thesis/defense narrative must move in lockstep** — "five funders including
   PhilHealth" becomes "four GL-issuing funders + PhilHealth first-charge
   coverage + AMBaG." If docs lag, the feature sheet and the system disagree —
   the exact inconsistency this change removes.
7. **Partial fidelity — be honest in the defense.** This makes *PhilHealth-first*
   true, but the remaining PCSO → DSWD → DOH residual **sequencing stays flat**
   (parallel co-funders). That matches operational reality (centers route to
   remaining agencies in parallel by leftover balance), but do not overclaim full
   Order-of-Charging — that is Option 2.

---

## 8. Build order (green after each phase)

1. Backfill migration (dry-run) + audit philhealth slices/allocation.
2. Disable `philhealth` agency.
3. Patient `totalBill` capture + derive `amountNeeded = totalBill`.
4. CRMC coverage entry in assessment step + recompute (gated pre-endorsement).
   NB: the endorse transaction freezes `amountRequested = amountNeeded` onto each
   slice (`admin/Requests.jsx:211`), so the pre-endorsement gate is load-bearing,
   not optional — verified in the 2026-08-26 double-check. Each slice reserves
   the FULL residual (no per-agency split); Option 1 leaves that logic untouched.
4a. Reconcile the Login.jsx demo panel (see §3 change table + §5 step 2a).
5. Seed / demo update + tests.
6. Optional breakdown display polish.
7. Docs reframe (thesis / cheat-sheet / memo).

**Discipline:** build green after every phase; no commit/push until reviewed
locally (matches `docs/redesign-plan.md` §11).

---

## 9. Not in scope (Option 2, explicitly deferred)

Full Order-of-Charging sequencing — modelling PhilHealth → PCSO → DSWD → DOH →
LGU as ordered stages each computing on the running residual, enforcing
endorsement order, rendering a waterfall. Heavier, sits on the money path
(highest-risk code), and over-models reality. Revisit only if a panelist
specifically requires strict charging-order enforcement.
