# MAPA — Assistance-Model Remediation Plan

**Status:** partially shipped · **Owner:** proponent + CRMC · **Created:** 2026-10-08 · **Updated:** 2026-10-12

This plan fixes a specific structural problem found while tracing how "type of
assistance", document types, and agency configuration actually work. It is written
to be executed incrementally — each item is its own small, reversible, CI-gated PR —
and it deliberately parks the hard real-world questions in **Phase 0** so no code is
built on an assumption.

---

## Shipped — coverage-model redesign (2026-10-12, PR #287)

Owner decisions (2026-10-12): scope = **inpatient hospital bills**; PhilHealth =
**optional coverage line** (not mandatory/first); documents = **per-assistance-type
checklists**; catalogs = **seeded config, CRUD pages removed**. Delivered behind
`VITE_PER_TYPE_DOCS` (default **off** — production unchanged until CRMC confirms the
real lists). Design grounded in Stripe requirement tiers, GOV.UK task lists, and IBM
Cúram externalized thresholds (decision-table-lite, not a rules engine).

- **`src/data/referenceData.js`** — single source of truth for the assistance-type
  catalog + requirement records `{ docId, when, quantity?, appliesIf? }`:
  `CORE_REQUIREMENTS` + per-type + `CONDITIONAL_REQUIREMENTS` (pure predicates),
  two timing tiers (`when`), externalized `THRESHOLDS` (Social Case Study Report
  above `socialCaseStudyPhp`), `resolveRequirements()` / `requiredDocsFor()`.
- **Patient checklist** (`RequestAssistance` + `DocChecklist`) reads per-type when the
  flag is on, recomputing as the patient picks a type + enters the bill; GOV.UK
  task-list polish (status tags + hint text + "N needed").
- **PhilHealth** demoted to an optional prior-coverage line in the admin coverage
  editor + patient copy. **No money-math change** — `amountNeeded = totalBill −
  philhealthCovered − otherCovered` is identical; `syncRequestFinancials`,
  `computeFunding`, `PathToZeroBalance` untouched.
- **Removed** the Assistance Types + Document Types admin CRUD pages; `Seed.jsx` +
  `scripts/bootstrap-reference-data.js` now import the catalogs from `referenceData.js`
  (kills the 3-way duplication for these two) and no longer emit `CRMC-` codes.
- **Gate before prod go-live:** CRMC confirms the real per-type document sets +
  thresholds via `docs/crmc-document-requirements-checklist.md`, then flip the flag.

Still open from the original plan below: single-source the **agency** list (1.1),
eligibility/capacity/charging-order (Phase 2), per-agency intake (Phase 3), and the
Phase 0 stakeholder answers.

---

## The diagnosis (why this plan exists)

MAPA invests heavily in **describing** a case (what category of help, what each agency
nominally offers, what documents each nominally needs) and lightly in **deciding** a
case (who is eligible, who has budget, in what order funders charge, which program
fits the condition).

- **Over-modeled** — structure that gates no decision: a required single-pick patient
  "assistance type" treated as precise routing; `agency.requirements` shown to patients
  but never collected or enforced (zero logic references in code); `agency.assistanceTypes`
  used as a "match" signal even though every agency funds the same overlapping buckets;
  the agency reference list duplicated in **three** places (`src/pages/Seed.jsx`,
  `scripts/bootstrap-reference-data.js`, `src/utils/constants.js`) — guaranteeing drift.
- **Under-modeled** — the constraints that actually gate funding: **eligibility**
  (esp. residency — AMBaG funds Bangsamoro residents; the BARMM address is collected but
  never used to route), **live budget/slot capacity at endorsement**, the **Order of
  Charging** sequence (PhilHealth-first is narrative + a workaround, not structured), and
  the **condition→funder** mapping (the intake has the diagnosis; nothing connects it to
  the right program).

**Root cause:** modeling effort tracked *what is easy to enumerate*, not *what gates a
decision*. Taxonomy is finite and feels complete; eligibility/capacity/sequencing are
dynamic, externally-defined, and site-specific, so they were left to manual judgment.

**Guiding principle for every change below:**
> Be precise about the few things that decide a case — eligibility, the charging order,
> live capacity, and a verifiable-but-inclusive identity check — and be ruthlessly simple
> about everything else, because every gram of unnecessary process falls on the person
> least able to carry it.

### Guardrails (bind every phase)
- **No hard gate that can lock out** a low-literacy / poor-phone / no-ID patient.
  Everything advisory + human-overridable (the "use anyway" principle).
- **Every field must gate a real decision.** Default to subtraction.
- **Don't model an external fact without an owner or a refresh path** — or you recreate
  the staleness this plan is cleaning up.
- One reversible PR per change; bilingual; mobile-first; CI-gated.
- **Prefer configurable data over hard-coded rules** for anything not in public law or
  owner-confirmed; default such rules to **off/unverified** and list them for validation.

> **Reconciled with the workflow audit (2026-10-08, `docs/workflow-audit/`).** That audit —
> against JAO 2020-0001 + RA 11463 + owner answers — reprioritizes this plan: the biggest real
> levers are **sequential residual endorsement** and **a CRMC bill-verification stage** (new
> **Phase 2.0** below, outranking the type work), and several current rules are owner-confirmed
> **invented** and should be *removed*, not modeled: the patient "accept coverage plan" step,
> daily **slots**, and the **per-applicant cap**; PhilHealth must be disabled as a funding
> agency (it's a deduction). See `docs/workflow-audit/03-gaps.md` + `04-cleanup-and-fixes.md`.

---

## Phase 0 — Establish ground truth (stakeholder; do first, no code)

**What.** Answer four factual questions only CRMC/the agencies can answer, and record
them in this doc (checklist at the end).

**Why.** Phases 1–3 reshape depending on the answers. Building first would bake in the
same assumption-driven modeling that caused the problem.

**How.** One working session with the CRMC Malasakit social workers + a short note to
each agency desk. Capture:

1. **Re-assessment reality.** At CRMC, when a case is endorsed to PCSO / DSWD / DOH /
   AMBaG, does that desk **fund off the shared Unified Intake Sheet + verified docs**, or
   **pull out its own forms / run its own assessment**? Answer per agency.
   → *Decides whether documents stay global (Phase 1) or need a per-agency layer (Phase 3),
   and whether `agency.requirements` is real or dead.*
2. **Eligibility rules per agency.** Residency (AMBaG = Bangsamoro resident? others
   nationwide?), income/means thresholds, any program-specific criteria.
   → *Feeds Phase 2 eligibility.*
3. **Order of Charging.** The exact funder sequence used at CRMC (PhilHealth first, then
   …?) and any per-funder caps / co-pay rules.
   → *Feeds Phase 2 charging order.*
4. **Config ownership.** Who, in practice, knows and should maintain "what each agency
   funds/requires", and how often does it change?
   → *Decides who edits coverage going forward (CRMC vs. agency self-service).*

**Acceptance.** The checklist at the bottom is filled in and dated.

---

## Phase 1 — Pay down the description layer (cheap, low-risk, mostly deletion)

Three independent PRs. None changes the money flow.

### 1.1 Single source of truth for agency reference data
- **What.** Collapse the three duplicated agency definitions into one module that
  `Seed.jsx` and `bootstrap-reference-data.js` both import; delete the stale copy in
  `src/utils/constants.js` (or make it re-export the one source).
- **Why.** Three copies drift — we already shipped #276 and left `constants.js` stale.
  A single source removes a whole class of "which one is right?" bugs.
- **How.** Create `src/data/agencies.seed.js` (or `scripts/_data/agencies.js`) exporting
  the canonical array; update the three consumers to import it; verify nothing else reads
  the old `constants.js` export (grep `assistanceTypes` / agency ids). Add a tiny unit
  test asserting the exported set matches expectations.
- **Effort** S · **Risk** Low · **Acceptance** one definition; grep finds no second copy.

### 1.2 Stop presenting `agency.requirements` as "requirements"
- **What.** Remove (or honestly relabel) the per-agency `requirements` list from
  patient-facing surfaces (`MedicalPrograms.jsx`, `RequestAssistance.jsx` agency info).
  Keep the **global** `documentTypes` checklist as the single source of what to upload.
- **Why.** `agency.requirements` is never collected or enforced (confirmed: zero
  non-display references). Showing a patient in crisis "PCSO requires Medical Certificate"
  when the form never asks for it is actively misleading.
- **How.** Delete the display blocks, or relabel to "Typically needs (handled by CRMC)".
  If Phase 0 says agencies genuinely need extra docs, that becomes Phase 3 (collected),
  not a display string. Also drop the `selectedReqs` editor from `AddAgency`/`Agencies`
  **only if** we decide the field is dead; otherwise leave the admin field and just stop
  showing it to patients.
- **Effort** S · **Risk** Low (display-only) · **Acceptance** no patient-facing screen
  shows an uncollected per-agency requirement.

### 1.3 Demote the patient "assistance type" to honest-advisory
- **What.** Make the request's assistance type **optional** (drop the
  `if (!form.assistanceType) …` gate) and **retire or soften** the "does not list [type]"
  endorsement warning. Keep the catalog + the field for reporting and for the agency's
  purpose-of-assistance at approval.
- **Why.** It's a low-literacy user's one-word guess that changes no money, no documents,
  no routing, and duplicates the intake sheet's richer diagnosis/recommendation. Required +
  "matched" dresses a casual label as precise machinery. Keeping it *optional* preserves
  the comprehensible "what do you need help with?" framing without the friction or the
  false precision.
- **How.** `RequestAssistance.jsx`: remove the required check; label the field "(optional)".
  `admin/Requests.jsx`: remove the `matches`/"does not list" amber warning (line ~129/444)
  or downgrade to a muted note. `utils/analytics.js` already buckets empty as
  "Unspecified" — no change needed. Keep the Admin → Assistance Types catalog and the
  ApproveModal purpose options (that use is real — it's on the GL).
- **Effort** S–M · **Risk** Low (analytics tolerates blanks; warning is advisory) ·
  **Acceptance** a patient can submit without picking a type; no screen implies the type
  routes funding.

---

## Phase 1b — Remove owner-confirmed invented steps (deletion, their own PRs)
From the workflow audit (owner-confirmed INVENTED; not in RA 11463 / JAO 2020-0001):
- **Disable PhilHealth as a funding agency** in all seeds (it's a first-charge *deduction*).
  Delete the dead duplicate agency list in `src/utils/constants.js`.
- **Remove the patient "accept coverage plan" step** — slice goes `endorsed →` straight to the
  agency (drop the patient gate + `onSliceProceeded`). *Touches rules → rules test.*
- **Remove the daily-slots gate** (`resetAgencySlots`, `SlotManagement`, the endorse-modal
  slot filter) and surface **budget headroom** instead. *Touches rules → rules test.*
- **Make the per-applicant cap optional + visible** (never a hidden block).
- **Make the cooldown per-agency + configurable, default off** (current hard 30-day global is
  owner-flagged inexact — ~3 months at MSSD/B-CARES; research each program). *Touches rules.*

## Phase 2.0 — Make the money match the law (highest value; do alone, test-heavy)
- **Sequential residual endorsement.** Endorse to one agency for the residual; if partial,
  endorse the **remainder** (`amountNeeded − already approved`) to the next, per the Order of
  Charging — instead of the current parallel full-amount endorsement with over-commit "by
  design". *Money + rules; ship behind "existing totals unchanged" + no-over-commit tests.*
- **CRMC bill-verification first stage.** Add a gate where CRMC confirms the self-reported
  `totalBill` (against the hospital billing office) before/at assessment — the real process
  starts with billing verification. *Stage-machine + rules test.*

## Phase 2 — Model the few things that actually gate a case

Do each **minimally**. The failure mode to avoid is rebuilding taxonomy. Order by
value-per-effort: eligibility → capacity → charging order.

### 2.1 Eligibility v1 = residency (highest signal, data already collected)
- **What.** Give each agency a residency scope, and at **endorsement** flag/sort agencies
  by whether the patient qualifies. Advisory, never a hard block.
- **Why.** AMBaG funds **Bangsamoro** residents; endorsing a non-BARMM patient to AMBaG
  wastes the clock. Residency is a *real* routing signal; "type" is not. The BARMM address
  is already captured at registration and on the request — currently unused for routing.
- **How.**
  - **Data:** add `agency.eligibility = { residencyScope: 'barmm' | 'nationwide' | <region/province codes> }`. Default existing agencies to `'nationwide'`; set AMBaG to `'barmm'` (confirm in Phase 0). Admin sets it in `AddAgency`/`Agencies`.
  - **Compute:** `utils/eligibility.js` → `isResidencyEligible(patientAddress, agency)` using the structured address already stored (verify the exact `users`/`request` address fields first).
  - **UI:** in `EndorseModal` (`admin/Requests.jsx`), show an "eligible / out-of-area" chip per agency and sort eligible first. Do **not** disable — CRMC may override with reason.
  - **Tests:** pure `isResidencyEligible` unit tests + rules bound for the new field.
- **Effort** M · **Risk** Low–Med (advisory UI; new optional field) · **Depends on** Phase 0 Q2.
- **Acceptance** EndorseModal flags out-of-area agencies; no patient is hard-blocked.

### 2.2 Capacity surfaced at endorsement
- **What.** When CRMC picks agencies to endorse to, show **live remaining budget** and
  **remaining slots** per agency, and a "can cover ₱X?" indicator — replacing the
  type-match warning removed in 1.3.
- **Why.** "Who can actually fund ₱X right now?" is the question CRMC actually has. Budget
  and slots already exist (`agency.budget {allocated, committed, disbursed}`, `slots
  {total, remaining}`) and are enforced at *approval* — surfacing them at *endorsement*
  prevents sending a case to a funder with no headroom.
- **How.** `EndorseModal`: compute `remaining = allocated - committed`; render headroom +
  slots + a green/amber "covers ₱X / partial / none" chip per agency; sort by headroom.
  Reuse `computeFunding`. No new data model.
- **Effort** S–M · **Risk** Low (read-only surfacing) ·
  **Acceptance** CRMC sees budget headroom + slots before endorsing.

### 2.3 Order of Charging as structured sequence
- **What.** Make funder priority explicit data and visualize the charging waterfall
  (PhilHealth-first → residual to co-funders → toward zero balance), instead of narrative
  + the PhilHealth-as-fake-agency workaround.
- **Why.** RA 11463 mandates the sequence; getting it wrong wastes public funds or leaves
  a residual the patient can't pay. Today it's implicit (`amountNeeded = bill − coverage`,
  slices tracked by amount) but the *order and per-funder rules* aren't structured.
- **How.** Add `agency.chargeOrder` (int; PhilHealth = 1, others after per Phase 0 Q3);
  optionally per-funder caps. On the request view, render the waterfall (bill → PhilHealth →
  each slice → residual). Keep it visual + advisory first; enforce caps later only if
  Phase 0 confirms them. Touches the request detail view + `analytics`.
- **Effort** M–L · **Risk** Med (touches the money view; must not change existing totals) ·
  **Depends on** Phase 0 Q3 · **Acceptance** the charging order is data-driven and visible;
  existing amounts unchanged.

---

## Phase 3 — Honest per-agency intake (CONDITIONAL on Phase 0 Q1)

- **What.** *Only if* Phase 0 shows an agency (likely PCSO/DSWD) genuinely re-assesses or
  needs its own documents, add a **minimal per-agency supplemental requirement that is
  actually collected** — attached to the endorsed slice, surfaced to the patient only when
  that agency is involved.
- **Why.** If agencies re-assess, `agency.requirements` isn't dead — it's a real need the
  model currently can't express. But building it speculatively would re-create the
  over-modeling. Build only what Phase 0 proves is real.
- **How (sketch).** `agency.supplementalDocs = [typeName…]`; when a slice is endorsed to
  that agency, the patient gets a small "one more document for <agency>" ask on the slice
  (not the whole request); CRMC/agency verifies it. Keep it off the critical path for
  agencies that don't need it.
- **If Phase 0 says agencies DO accept the shared packet:** do the opposite — **delete**
  `agency.requirements` entirely and lean fully into "upload once."
- **Effort** M · **Risk** Med · **Decision gate:** Phase 0 Q1.

---

## Sequencing & effort summary

| Phase | Item | Effort | Risk | Depends on |
|---|---|---|---|---|
| 0 | Ground-truth questions | — | — | — |
| 1.1 | Single-source agency data | S | Low | — |
| 1.2 | Drop misleading `requirements` display | S | Low | — |
| 1.3 | Optional/advisory assistance type | S–M | Low | — |
| 2.1 | Residency eligibility | M | Low–Med | 0.Q2 |
| 2.2 | Capacity at endorsement | S–M | Low | 1.3 (replaces warning) |
| 2.3 | Order of Charging structure | M–L | Med | 0.Q3 |
| 3 | Per-agency intake (conditional) | M | Med | 0.Q1 |

**Recommended path:** Phase 0 now → Phase 1 (three quick PRs) while answers come in →
Phase 2.1 (residency) as the first real-weight change → 2.2 → 2.3 → Phase 3 only if needed.

## Success metrics
- **Time-to-coverage** unchanged or lower (no step added for the patient).
- **Mis-endorsements fall** (fewer cases sent to ineligible / zero-headroom agencies).
- **Zero over-commitment surprises**; **zero patient lockouts**.
- Everything a social worker sees is **decision-bearing** — nothing shown that isn't used.

## Risks & rollback
- Every item is its own PR behind CI; revert is one merge. Phase 1 is deletion/relabel
  (trivially reversible). Phase 2.3 is the only one touching money math — gate it hard on
  "existing totals unchanged" tests before merge.

---

## Phase 0 question sheet (fill in, then date)

| # | Question | Answer | Who confirmed | Date |
|---|---|---|---|---|
| 1 | Does **PCSO** re-assess at CRMC or accept the shared intake? | | | |
| 1 | Does **DSWD** re-assess or accept the shared intake? | | | |
| 1 | Does **DOH-MAIFIP** re-assess or accept the shared intake? | | | |
| 1 | Does **AMBaG** re-assess or accept the shared intake? | | | |
| 2 | **AMBaG** residency rule (Bangsamoro only?) | | | |
| 2 | Any income/means thresholds per agency? | | | |
| 3 | Exact **Order of Charging** sequence at CRMC | | | |
| 3 | Any per-funder caps / co-pay rules? | | | |
| 4 | Who should own + maintain agency coverage config? | | | |
