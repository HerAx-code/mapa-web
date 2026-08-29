# CRMC Request-Processing Redesign Plan

*Scope: the **CRMC/admin** side of the request pipeline — the `/admin/requests`
queue and the request **processing** surface (`RequestDetail` in
`src/pages/admin/Requests.jsx`). Approach: **redesign the flow/IA first, then
reskin.** Direction proposed here for review. Patient-apply and agency-funding
surfaces are out of scope for this plan (separate efforts).*

---

## Why this needs redesign

The CRMC processing surface is a **single long scroll that stacks every task at
once**. A request detail today is, top to bottom:

- Summary (amount needed, funding bar, contact, submitted)
- ① Verify documents (list + verify/reject/OCR)
- ② "Interview & assessment" — three different sub-tasks lumped together:
  the Unified Intake Sheet link, the coverage inputs (PhilHealth/other), and
  interview scheduling
- ③ Endorsed slices
- Actions (Reject / Close / **Endorse**)

Concrete problems:

1. **No sense of progress.** CRMC processing is really a *staged workflow*
   (verify → assess → interview → endorse), but nothing in the UI reflects
   "where am I / what's next." The operator scrolls a wall of controls.
2. **The endorse gate is opaque.** Endorse is blocked until *all docs verified*
   **and** *intake complete* **and** *interview outcome recorded* — but the UI
   only says so in one vague amber line. The operator can't see **which**
   prerequisite is missing without scrolling up and hunting.
3. **Unrelated tasks share a section.** Coverage (a financial calc), the intake
   sheet (a form), and the interview (a scheduled event) are three jobs jammed
   under one "②".
4. **The queue triages by status, not by "what needs my action."** An operator's
   real question is "what's waiting on me right now?" — verify these, interview
   those, endorse the ready ones.
5. **Maintainability.** `Requests.jsx` is ~1,700 lines in one file, which makes
   any change risky (it holds the money-path endorsement transaction).

---

## Target UX — a staged processing workspace

Replace "one scroll of everything" with **a guided, stage-focused workspace**.

### The lifecycle, made explicit

Four CRMC stages, each with a clear done/current/blocked state:

| # | Stage | Done when |
|---|-------|-----------|
| 1 | **Verify documents** | every attached document is verified |
| 2 | **Assess** | Unified Intake Sheet complete + coverage applied |
| 3 | **Interview** | assessment interview scheduled and **outcome recorded** |
| 4 | **Endorse** | (enabled only after 1–3) split the balance to agencies |

Terminal states (funded / partially-funded-closed / rejected) end the flow.

### Redesigned request detail

- **Persistent header band** (sticky): ← back to queue · patient name ·
  `requestId` · assistance type · **request status** · a compact **funding
  summary** (needed / secured / remaining mini-bar) · **Message patient**.
- **Stage rail** (a stepper under the header on desktop; a horizontal scroller
  on mobile): the four stages with status icons — ✓ done · ● current · 🔒
  blocked — and a one-line status each ("3/5 verified", "Intake incomplete",
  "Outcome recorded"). Clicking a stage focuses its work area.
- **Focused work area** — shows **only the selected stage's controls**, not all
  of them:
  - *Verify* → the document list (verify / reject / reset, OCR advisory).
  - *Assess* → intake-sheet status + open, and the coverage panel
    (bill → PhilHealth → other → **remaining to agencies**).
  - *Interview* → schedule (date / time / Google Meet link) + record outcome.
  - *Endorse* → the endorse action, the endorsed-slice list, funding progress.
- **Explicit blockers.** The Endorse stage, when locked, lists exactly what
  remains — "Documents: 3/5 verified", "Intake sheet: incomplete", "Interview:
  outcome not recorded" — each a jump link to that stage. This replaces the
  single vague warning line.

Result: the operator always knows the stage they're on, what's left, and why
they can't endorse yet — one task in view at a time.

### Redesigned queue — triage by action needed

Reframe the list around **"what's waiting on CRMC"**, using the same stage model
as filters/segments:

- **Needs verification** · **Needs assessment** · **Needs interview** ·
  **Ready to endorse** · **Endorsed (awaiting agencies)** · **Funded / closed**
- Each row: patient · `requestId` · assistance type · amount needed · **current
  stage chip** · age · a funding mini-bar. Scannable at a glance.
- Default view surfaces the actionable buckets first.

Staff surfaces are desktop-primary and English-only (per `CLAUDE.md`), so this
is designed desktop-first; mobile degrades gracefully.

---

## Phased delivery (redesign → reskin)

Each phase is incremental, CI-green, and **never touches the money-path**
(the endorsement / coverage / slice transactions and their Firestore writes stay
byte-for-byte the same — only their presentation changes). ✅ = shipped.

- **Phase 0 — Refactor for safety (no visible change).**
  - ✅ Lifted the derived gate (`allVerified` / `intakeComplete` /
    `interviewOutcome` / `canEndorse`) into a pure, tested `requestStage` model
    (PR #69) — the single source of truth for the rail, the queue chips, and the
    endorse gate.
  - ⬜ Still to extract `RequestDetail`'s sections into `VerifyDocsPanel` /
    `AssessPanel` / `InterviewPanel` / `EndorsePanel` (pure move — same DOM), so
    the 1,700-line file is decomposed before the work-area restructure lands.

- **Phase 1 — The staged workspace (core redesign).**
  - ✅ **Stage rail + explicit blockers** (PR #70) — the at-a-glance
    verify → assess → interview → endorse progress, and the exact remaining
    prerequisites as chips (replacing the vague warning). Additive.
  - ⬜ **Header band + focused work area** — the summary/status/funding band and
    the one-stage-at-a-time work area that replaces the long scroll. **This is
    the primary Magic Patterns adoption point** (layout + interactions) and the
    step that most needs live screenshot verification.

- **Phase 2 — Queue triage.** Rebuild the list around the stage buckets and the
  scannable row (the second MP-adoption point). Wire the queue chips to the
  `requestStage` model.

- **Phase 3 — Reskin.** The visual polish pass on the new structure, reconciling
  the Magic Patterns look with the app's design system (`.stat-tile`,
  `.eyebrow`, `.card`, brand tokens) — spacing/hierarchy, loading + empty states.

---

## Adopting a Magic Patterns reference

A Magic Patterns export gives us a polished **visual + interaction** reference.
MAPA translates it through a fixed discipline so we take the *design*, not the
mismatch — the same keep/adapt/reject approach used across the pilot (login,
register, install, dashboards). **The mockup supplies the shell; MAPA supplies
the wiring.**

### Translation rules (non-negotiable)

- **MAPA's design system, not the mockup's tokens.** Remap MP's colours,
  spacing, and radii to MAPA tokens — brand pine-teal, Inter, `.card` /
  `.stat-tile` / `.eyebrow` / `.badge`, 44px touch, `shadow-sm`. The MP palette
  and type are a suggestion; the system wins. (See the MAPA Design System guide.)
- **`react-icons/md`, not lucide.** MP exports ship lucide icons — swap to the
  Material set the app already uses. No new icon dependency.
- **JSX, not TSX.** Port MP's TypeScript components to the app's JS + existing
  component patterns.
- **Keep MAPA's logic; take MP's layout.** The mockup contributes structure,
  hierarchy, states, and micro-interactions — never business logic. The
  endorse/coverage/slice transactions, the `requestStage` model, and the
  document/interview flows stay MAPA's, wired into the new shell.
- **Staff = English-only.** No i18n on this surface (unlike the patient MP
  adoptions, which are bilingual).
- **Additive + behaviour-preserving.** Adopt into the component seams (rail,
  panels, work area) so the money-path is untouched and each step is
  screenshot-verifiable against a seeded request.

### Keep / Adapt / Reject

Every element in the reference is classified before a line is written:

- **Keep** — layout, visual hierarchy, empty/loading states, micro-interactions,
  the progress/stepper metaphor, scannable list rows. *Take as-is, remapped to
  tokens + Material icons.*
- **Adapt** — anything assuming a different data model or flow: an MP "approve"
  affordance must route through MAPA's coverage → endorse gate; an MP status set
  must map onto MAPA's lifecycle (`submitted … endorsed … fully_funded`); an MP
  card must bind to `computeFunding` / `requestStage`.
- **Reject** — anything that fights the CRMC model (a self-service action where
  CRMC must gate; an agency re-review step that doesn't exist; a field CRMC
  doesn't collect) or the constraints (lucide, TypeScript, a new dependency, a
  dark-mode split).

### Component map — where the reference plugs in

The staged workspace is a fixed component set. An MP mockup contributes the
*look* of each cell; the right column is the wiring that stays MAPA's.

| Component | What the MP reference contributes | MAPA reconciliation |
|---|---|---|
| **Queue list + row** | scannable row, stage chips, filters, empty state | rows bind to `requestStage` buckets; figures from `computeFunding`; co-funding model kept |
| **Header band** | summary + status + funding presentation | funding from `computeFunding`; status from the lifecycle; Message-patient action kept |
| **Stage rail** ✅ | stepper visual (refined at reskin) | already built from `requestStage` |
| **Work area · Verify** | doc-review list, verify/reject affordances, OCR advisory | wired to the existing verify/reject/reset + OCR logic |
| **Work area · Assess** | intake summary + coverage calculator layout | coverage math + intake completeness stay MAPA's |
| **Work area · Interview** | schedule / record-outcome layout | Google-Meet link + outcome logic kept |
| **Work area · Endorse** | endorse action + slice/funding presentation | the endorse transaction + blocker gate untouched |
| **Blocker list** ✅ | — (MAPA-specific) | already built from `stage.blockers` |

### The process, per mockup

1. Drop the Magic Patterns export in a `Downloads` folder (as before).
2. I run a **keep/adapt/reject** pass against this map and flag anything that
   fights the CRMC model — before building.
3. Implement **additively** into the seams above, remapped to MAPA's system.
4. **Screenshot-verify** each stage against the Design System + a seeded demo
   request (`scripts/demo-data.mjs`).

> Net: when a mockup lands, the work is *classify → remap → wire into the seams*,
> not a from-scratch build. The seams (rail, blocker list, the `requestStage`
> model) already exist.

---

## Constraints & risks

- **Money-path is sacred.** The endorse/coverage/slice logic in
  `Requests.jsx` (and the deployed `syncRequestFinancials` trigger it feeds)
  must not change behavior. The refactor moves code, it doesn't rewrite the
  transaction.
- **Big-file risk.** `Requests.jsx` is ~1,700 lines; Phase 0 de-risks the rest by
  splitting it first.
- **No new dependencies** without discussion; the stage rail / charts are hand-
  rolled with existing components + Tailwind.
- **Verification.** Each phase is screenshot-verified (Playwright) against a
  seeded request in each stage, plus the existing rules/component/E2E suites.
  A demo request in every stage can be seeded via `scripts/demo-data.mjs`.
- **Staff-only + English-only** — no i18n work here (staff surfaces are English
  by design).

---

## Success criteria

1. An operator can tell, at a glance, **what stage a request is in and what's
   blocking the next step**.
2. Endorsement is never a mystery — the exact remaining prerequisites are shown.
3. The queue answers **"what needs me now?"** without reading every row.
4. Zero change to the endorsement/coverage money-path behavior.
5. `Requests.jsx` is decomposed into reviewable, testable components.
