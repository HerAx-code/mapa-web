# MAPA Manuscript — Sync Delta (system vs. manuscript)

**Generated:** 2026-10-16 · **Audited against:** `MAPA_Manuscript_Complete_Oct2026.docx` (newest, ~40,250 words) and the live `main` branch after PRs #296/#297/#300/#301.

This is the material-first step the rebuild brief (`MAPA_Manuscript_Remaining_Work_Brief.md`, §5) calls for: produce the corrections here, then fold them into the `.docx` via the generator — do **not** hand-edit the `.docx` structurally.

---

## TL;DR — the manuscript is mostly current

The Oct 16 manuscript **already** reflects the big system change (scheduled interview → remote/async assessment). It says *"The assessment is conducted remotely and asynchronously,"* *"Remote asynchronous assessment, no appointment,"* and *"Removing the appointment, rather than scheduling it better, is what addresses a cost borne disproportionately by the poorest patients."* No references to the deleted booking code remain (`onInterviewSlotWritten` 0, `interviewSlots` 0, "schedule an interview" 0). The ~13 "appointment" mentions are all **correct** (they describe the removal, its rationale, or the RRL).

So the required changes are **small and concrete**. One is critical.

---

## Delta 1 — Test counts are stale ⚠️ CRITICAL (affects Table 9, Table 10, Abstract, Conclusion Summary, Revision Report §4.1)

The manuscript states, verbatim:
> Unit test suite — **35** tests … utils … · Component test suite — **64** tests … · Cloud Function test suite — **49** tests over the **seven** server-side handlers · Security rules test suite — **138** tests … (**286** total).

Current `main` (verified 2026-10-16 by running each suite):

| Suite | Manuscript | Current | Command |
|---|---|---|---|
| Unit (utils) | 35 | **256** | `npm test` |
| Component | 64 | **131** | `npm run test:components` |
| Cloud Function | 49 (7 handlers) | **94** (10 handlers) | `npm run test:functions` |
| Security rules | 138 | **209** | `npm run test:rules` |
| **Total** | **286** | **690** | `npm run test:all` |

**Action:** replace every occurrence of `286` and the four per-suite figures with the current numbers above. Also update "seven server-side handlers" → "**ten** server-side handlers" (see Delta 2). These figures are cited in at least: the Abstract, Table 9 (test summary), Table 10, the Conclusion "Summary", and Revision Report §4.1 — change them together so they agree.

*(e2e/Playwright is reported separately and not part of the 690.)*

---

## Delta 2 — Cloud Function handler count 7 → 10

`onInterviewSlotWritten.js` was deleted with the booking removal. The current handler set (`functions/src/`, 10 handlers wired in `functions/index.js`):

`deleteAuthUser` · `glExpirySweep` · `onAgencyWritten` · `onDocumentCountChanged` · `onRequestWritten` · `onSliceProceeded` · `purgeSelfieOnClose` · `resetAgencySlots` · `syncRequestFinancials` · `verifyAccessCode`

**Action:** wherever the manuscript enumerates or counts the handlers ("seven server-side handlers"), update to ten and this list. If any prose names `onInterviewSlotWritten` or an interview-slot sync, remove it.

---

## Delta 3 — New endorsement features (optional additions to Implementation Results)

Two advisory features shipped this cycle (#296, #297) that the manuscript predates. Both are **read-only/advisory at endorsement — no money-math or rules change**. Worth one short paragraph in *Implementation Results* if you want the manuscript to match the deployed build; skippable if you're freezing scope.

Suggested text:
> *Two advisory aids were added to the endorsement screen. A **residency-eligibility** flag marks each agency as in-area, out-of-area, or unknown for the patient's province (e.g., AMBaG serves Bangsamoro residents), sorting out-of-area funders last without blocking them. A **capacity** indicator shows, per agency, whether its live budget headroom and per-applicant cap can cover the remaining balance ("covers ₱X", "partial", or "no headroom"). Both are advisory: the social worker may override, and the authoritative budget check still runs at approval.*

---

## Delta 4 — De-CRMC / generalization framing (decision needed, not a fix)

The **code** is now client-agnostic — the host organization is configured through `src/config/org.js` (`ORG`, `VITE_ORG_*`), and the source no longer hardcodes "CRMC." The **manuscript** names CRMC 184 times, which is appropriate: CRMC Malasakit Center is the real reference deployment and the workflow is modeled on it.

**Recommendation:** keep it as a CRMC capstone, and add **one sentence** (Scope/Limitations or Recommendations) noting the architecture is deployment-configurable so the platform can be re-hosted by another charitable medical office without code changes — this reads as a *strength* (scalability) and matches the panel's generalization note. A full reframe away from CRMC is **not** recommended and would be a large rewrite.

---

## Appendix deltas (feed the "regenerate appendix material" track)

- **Appendix B (source code):** the Sept brief planned B.5 = `firestore.rules` *interviewSlots compare-and-set booking* and B.6 = `onInterviewSlotWritten.js` — **both deleted.** Re-slot them. Suggested replacements that show equivalent engineering depth:
  - **B.5 →** `firestore.rules` excerpts: `auditLog` actor-binding · `applications`/slice cap enforcement (`amountApproved` ≤ endorsed) · `certificates` cross-agency guard · `users` role-escalation guard.
  - **B.6 →** `functions/src/onSliceProceeded.js` (patient-proceeds → slice advance) or `functions/src/syncRequestFinancials.js` (the committed/outstanding rollup) — a current handler that carries real logic.
- **Appendix C (test docs):** regenerate with the Delta-1 counts (690). Re-run `npm run test:all` into `appendix-c/test-run.txt`.
- **Appendix D (screens):** the 19-capture list must not include any interview/booking screen (gone). Use `tests/e2e/capture-appendix-d.spec.js` (present) against the seeded demo. Note the demo admin login is now `admin@example.org` (PR #301 renamed it from `admin@crmc.gov.ph`; re-seed with `scripts/demo-accounts.js`).
- **Appendix E (user guide):** re-verify against the live UI — the patient "Interviews" sidebar entry and the "join your interview" guide section were removed (#300), so any step referencing them must go.

---

## Unchanged — still needs a human (from the brief, Part 4)

Wet signatures (Endorsement/Approval), questionnaire certification + completed forms, per-item questionnaire tallies, signed acceptance-test forms, four personal vitae (as tables, brief §3.4), final defense date. Also still open from the brief: Abstract over length (§3.1, ~450→~330 words), three unverified citations (§3.3). None of these changed this cycle.

---

## How to apply

Per the brief §5, the `.docx` is rebuilt by the two-pass generator (not in the repo — lives in a session scratchpad). Hand this file to that rebuild: Deltas 1–2 are mechanical find-replace; Delta 3 is a paste-in paragraph; Delta 4 is a one-line add; the appendix deltas feed the appendix-material pass.
