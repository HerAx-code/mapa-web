# 03 — MAPA UX improvement plan

*An intricate, phased, prioritized plan. Each initiative states the **problem**
(grounded in the code), the **evidence**, the **benchmark** it draws on
([02](02-external-benchmarks.md)), the **change**, **effort** (S/M/L), **risk**, and a
**definition of done**. Sequenced so high-value / low-risk work lands first. Nothing
here re-opens a settled `CLAUDE.md` decision — see §Guardrails.*

Effort key: **S** ≈ ≤1 day · **M** ≈ 2–4 days · **L** ≈ ≥1 week. Risk = chance of
regressing a working production flow.

> **This document is the "why + what".** The verified, build-ready "exactly how"
> (data shapes, component contracts, i18n key migration, per-file edits, back-compat
> rules, tests, acceptance criteria, risk register) lives in
> **[04-build-spec.md](04-build-spec.md)** — read that before writing code.

---

## Guardrails (what this plan will NOT propose)
Per `CLAUDE.md` and prior decisions: no PhilSys / automated biometric adverse decisions
(human-in-the-loop stays); no custom video (Google Meet on demand); no interview
booking (remote/async assessment); staff surfaces stay **English-only desktop**; patient
surfaces stay **bilingual mobile-first**; no new npm deps without discussion. Every
patient-facing string change must keep `npm run lint:i18n` green.

---

## Phase 0 — Prune the residue (foundation, do first)
*Small, safe deletions that remove confusion and shrink the surface the rest of the plan
touches. Do these before the bigger work so we're not redesigning around dead code.*

### 0.1 Remove interview-flow residue — **S, low risk**
- **Problem/evidence:** `TrackStatus.buildStages` still carries a legacy 6-stage
  direct-to-agency path with an `interview` stage + note; the Dashboard "Application
  Steps" step-3 done-check includes `'interview'`; stray "interview" copy remains.
  Interview scheduling was removed (`docs/remove-interview-scheduling-plan.md`).
- **Change:** delete the legacy `interview` stage/branch and the `'interview'` status
  checks; keep only the co-funding slice stepper + request lifecycle.
- **DoD:** no `interview` token in patient status code; tests + `lint:i18n` green.

### 0.2 Align/remove the shell `ComposeModal` for patients — **S, low risk**
- **Problem/evidence:** `Layout.jsx` `ComposeModal` still fetches **all users** and
  builds a patient recipient picker (filtered to staff/agency) — unreachable after
  reply-only messaging (#2) but present, and it re-introduces the staff-directory fetch
  that #2 removed elsewhere.
- **Change:** for `role==='patient'`, do not render the composer / directory fetch; the
  patient Messages entry points already route to the reply-only thread view.
- **DoD:** no patient code path fetches the user directory; matches firestore rules.

### 0.3 Consolidate shared formatters/config — **S, low risk**
- **Problem/evidence:** `peso()` re-defined in ≥5 pages; status→label/color logic in
  ≥4 places (`APP_STATUS_CONFIG`, `STATUS_VISUAL`, `buildStages`, `JourneyStrip`).
- **Change:** one `utils/format.js` `peso()` (fixed `en-PH`); fold `STATUS_VISUAL` and
  the stepper maps into `utils/constants` so status semantics have **one** source.
- **DoD:** single import used everywhere; a util test pins peso + status-map output.

---

## Phase 1 — One patient journey (the highest-value initiative)
*Directly resolves finding #1. Benchmark B/A: one model, 3–7 steps, consistent, from a
single source; keep the patient journey strictly linear (low-literacy §C).*

### 1.1 A single canonical journey model — **M, medium risk**
- **Problem:** the patient sees 4–5 progress models across Dashboard + TrackStatus.
- **Change:** define **one** model in `utils/journey.js`: the 6-stage request lifecycle
  (Submitted → Under review → Assessment → Endorsed → Funding → Complete), each stage
  carrying `{ icon, plainLabel (FIL/EN), whatHappensNow, whatsNext, cta? }`. Render it at
  **three fidelities from the same data**: **glance** (`JourneyStrip`), **summary**
  (Dashboard), **detail** (TrackStatus vertical stepper). Retire `TimelineCard` and the
  separate "Application Steps" guide as *progress* surfaces (keep a short *how-it-works*
  explainer in the Guide only).
- **Benchmark:** progress-tracker consensus (one model, 3–7 steps); GDS "received /
  decided / next + when" made explicit per stage.
- **Risk:** touches the two most-used patient pages → land behind screenshots on a
  preview URL; component tests for the shared stepper.
- **DoD:** one journey source; Dashboard + TrackStatus render from it; no page defines
  its own stage list; each stage answers "what now / what's next".

### 1.2 Collapse the Dashboard hero branches — **M, medium risk**
- **Problem:** six hero branches (`StatusHero` / `BalanceHero` / slice card / rejected /
  welcome / compact) — heavy conditionals, inconsistent visual language.
- **Change:** one `PatientHero` that takes journey-state + funding and renders a single
  consistent card whose emphasis shifts (pre-funding → next action; funding → balance;
  terminal → outcome). First-run welcome becomes a **dismissible strip**, not a hero
  branch.
- **DoD:** one hero component; the conditional tree in `Dashboard.jsx` is a single
  state→prop mapping.

### 1.3 Make co-funding legible to the patient — **S, low risk**
- **Problem:** "many agencies, one bill" is subtle for a low-literacy user.
- **Change:** a **stacked "path to zero balance"** bar on the patient status surface
  (mirror the admin `PathToZeroBalance`): segments = each agency's committed/pending
  amount toward ₱needed, with plain labels.
- **Benchmark:** F (surface the running total to the goal).
- **DoD:** patient sees one glanceable "who covers what toward ₱X" visual.

---

## Phase 2 — Reduce patient text density & keep it linear (low-literacy)
*Benchmark C. These are refinements on top of Phase 1's single model.*

### 2.1 Icon-led, one-line status everywhere — **S, low risk**
Lead each stage/hero with an icon + **one** plain-language line; move detail to a
"more" expander. Cut multi-sentence status copy on the hero.

### 2.2 Strictly linear active-request home = an explicit task list — **M, low risk**
- **Problem:** the active-request view (RequestAssistance) is an implicit checklist
  (intake, coverage plan, docs, proceed) mixing states.
- **Change:** render it as a **GOV.UK-style task list** — each row *Completed / In
  progress / Not started / Action needed*, resumable, one clear next action at top.
- **Benchmark:** B (task-list after simplification; preserve work).
- **DoD:** active request = one ordered task list; "what do I do now" is unambiguous.

### 2.3 Robust image upload on weak networks — **M, medium risk**
- **Problem:** doc/selfie images are base64-in-Firestore with a ~650 KB cap; large
  phone photos on 2G/3G can fail slowly.
- **Change:** client-side **downscale/compress** before write (canvas, no new dep) to a
  target size; explicit "uploading…/retry" state; keep the cap as a backstop.
- **DoD:** a 4 MB phone photo uploads reliably on a throttled connection; retry is clear.

---

## Phase 3 — A shared staff queue spine (both operators)
*Benchmark D. CRMC and agency queues converge on one triage vocabulary.*

### 3.1 Unify aging/SLA language — **S, low risk**
One `utils/sla` vocabulary used by **both** queues (CRMC 48h SLA and agency "days
waiting" become one on-track/due-soon/overdue scale with consistent color). Overdue-first
triage sort available in both.

### 3.2 Shared queue components + optional stage board — **L, medium risk**
- **Change:** extract the CRMC `RequestsTable`/`QueueTabs` and the agency Inbox table
  into a shared `QueueTable` + `QueueFilters` (columns/filters configured per role).
  Add an **optional board/kanban view** of the CRMC queue by stage (verify → assess →
  endorse) with **urgency color** on cards.
- **Benchmark:** D (board-with-stages + urgency color; open-vs-overdue at a glance).
- **Risk:** touches both operational queues → phase behind a feature flag; rules tests
  unaffected (read-only view change).
- **DoD:** one queue component powers both surfaces; CRMC can toggle table/board.

### 3.3 First-class case claiming — **S, low risk**
`requests.assignee` exists but isn't a real action. Add a one-click **Claim / assigned
to me** on the CRMC queue + a "mine / unassigned / all" filter, so the async queue has
clear ownership (benchmark D routing/ownership).

---

## Phase 4 — Verification capture & reviewer console
*Benchmark E. Stays advisory / on-device / human-confirmed — no automated decisions.*

### 4.1 Capture assistance on the ID photo — **M, medium risk**
- **Problem:** the selfie has an oval guide + liveness; the **ID** photo has only the
  post-hoc "not an ID" nudge — no capture-time quality help.
- **Change:** add a framing rectangle + a lightweight **glare/blur/edge pre-check** and
  a "hold steady / better light" retake hint on ID capture (on-device, advisory,
  never blocks — same posture as liveness).
- **DoD:** blurry/cropped ID gets a soft in-the-moment hint; still allowed to proceed.

### 4.2 Stronger reviewer console — **M, low risk**
- **Problem:** `CompareFacesModal` is side-by-side only; the OCR field cross-check and
  advisory scores live elsewhere in `VerifyDocsPanel`.
- **Change:** one reviewer view combining ID↔selfie compare + OCR name cross-check +
  advisory match/liveness scores + **verify/reject-with-reason in the same modal**, so
  the social worker decides without hunting. All signals remain advisory.
- **DoD:** a doc can be judged and actioned from one screen; decision still human.

---

## Phase 5 — Shared vocabulary, notifications, accessibility polish

### 5.1 Consistent entity vocabulary — **S, low risk**
Pick user-facing words and apply them everywhere: patient sees **"request"** (their
one thing) and **"coverage from agencies"** (never "slice"/"application"); staff share a
**"case"** lens. A short glossary in `CLAUDE.md` + copy pass.

### 5.2 Notification grouping — **S/M, low risk**
Group the ~30 notification types by the existing `NOTIF_CATEGORY` in the bell + "see
all" page (Applications / Documents / Messages / System), collapse repeats, so the
patient isn't scrolling a flat list. (Server model unchanged.)

### 5.3 Accessibility audit pass — **M, low risk**
Systematic pass for WCAG contrast (esp. the amber/gray small text), visible focus on all
interactive rows, aria-labels on icon-only buttons, and keyboard operability of the
queues + modals. Benchmark: healthcare-portal accessibility (fewer abandoned tasks).

---

## Quick wins (can land anytime, each **S**, low risk)
- Kill dead `interview` code (0.1) and the patient `ComposeModal` branch (0.2).
- Single `peso()` + fixed `en-PH` grouping (0.3).
- Overdue-first sort default when the agency Inbox has any red/amber rows (3.1 preview).
- "Received — we'll message you here" confirmation line on request submit success
  (GDS confirmation pattern; reduces "did it go through?" anxiety).
- GL expiry: surface the amber "expires in N days" on the **Dashboard** hero too, not
  only TrackStatus (patients live on the dashboard).

---

## Sequencing rationale
- **Phase 0** shrinks and de-risks the surface everything else touches (do first).
- **Phase 1** is the single highest-value initiative — it fixes the product's core
  question ("where am I?") for its primary user, and every later patient change inherits
  the one model.
- **Phase 2** compounds Phase 1 for the low-literacy audience.
- **Phase 3–4** are staff-efficiency and trust/verification; independent of 1–2, can run
  in parallel by a different track.
- **Phase 5** is the consistency/quality sweep that closes drift.

## How to validate each change (per `reference_deploy_and_verify`)
Land on a branch → verify on the **Vercel preview URL** (never prod) → screenshots at
phone width for patient work → component/rules/utils suites green → merge → CI deploys.
For patient-flow changes, walk the demo patient (patient@gmail.com) through submit →
status end-to-end on the preview.

---

## Appendix — traceability
Findings → initiatives: #1 (progress fragmentation) → **1.1/1.2** · #2 (terminology) →
**5.1** · #3 (interview residue) → **0.1** · #4 (two messaging systems) → **0.2** ·
#5 (divergent queues) → **3.1/3.2** · #6 (verification console) → **4.1/4.2** ·
#7 (micro-inconsistency) → **0.3/3.1/5.x**. Co-funding legibility (benchmark F) →
**1.3**. Low-literacy (benchmark C) → **Phase 2**.
