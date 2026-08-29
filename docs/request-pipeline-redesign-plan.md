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
byte-for-byte the same — only their presentation changes).

- **Phase 0 — Refactor for safety (no visible change).** Extract `RequestDetail`'s
  sections into components (`VerifyDocsPanel`, `AssessPanel`, `InterviewPanel`,
  `EndorsePanel`) and lift the derived state (`allVerified`, `intakeComplete`,
  `interviewOutcome`, `canEndorse`) into a small stage model. Pure structural
  refactor — same DOM, same behavior — but it tames the 1,700-line file and is
  the scaffold everything else builds on. *Verified by: existing behavior +
  screenshots identical.*

- **Phase 1 — The staged workspace (core redesign).** Add the header band +
  stage rail + focused work area + explicit blocker list. Same actions, same
  transactions; the change is *information architecture and flow*, not logic.

- **Phase 2 — Queue triage.** Rebuild the list around the stage buckets and the
  scannable row. Wire the queue chips to the same stage model.

- **Phase 3 — Reskin.** The visual polish pass on the new structure: header band,
  stage-rail styling, spacing/hierarchy, loading + empty states, and consistency
  with the app's design system (`.stat-tile`, `.eyebrow`, `.card`, brand tokens).

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
