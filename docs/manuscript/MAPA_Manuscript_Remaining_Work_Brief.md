# MAPA Manuscript — What the STI Template Requires, and What's Left

Hand this file to Claude Code in the `mapa-web` repo. It lists every part the
template `FTCRD19100_IT_IS_Capstone_Project_Manuscript_Template2.docx` requires,
marks what the September 2026 rebuild already contains, and specifies exactly
what still needs to be produced.

**Current manuscript:** `docs/manuscript/MAPA_Manuscript_Final_Sept2026.docx`
(139 pages)

---

## Part 1 — The template's required structure (verbatim from the template)

### Front matter (roman numerals, title page unnumbered)

| # | Required part | Status |
|---|---|---|
| 1 | Title Page | ✅ Done — needs date confirmed |
| 2 | Endorsement Form | ✅ Done — **needs wet signatures** |
| 3 | Approval Sheet | ✅ Done — **needs wet signatures** |
| 4 | Acknowledgements | ✅ Done |
| 5 | Abstract | ⚠️ Done but **over length** — see §3.1 |
| 6 | Table of Contents | ✅ Done, real page numbers |
| 7 | List of Tables / List of Figures | ✅ Done (template doesn't require these; harmless additions) |

### Body (arabic numerals from 1)

| Chapter | Required subsections (template's exact names) | Status |
|---|---|---|
| **Introduction** (H1) | Project Context · Purpose and Description · Objectives · Scope and Limitations · Review of Related Literature/Studies/Systems | ✅ All present. Note: *Statement of the Problem* is **not** a template heading — we kept it because your original manuscript had it and the panel has read it four times. |
| **METHODOLOGY** (H1) | Technical Background · Requirements Analysis · Requirements Documentation · Design of Software, System, Product, and/or Processes · Development | ✅ All present. See §3.2 for one heading-name mismatch. |
| **RESULTS AND DISCUSSION** (H1) | Testing · Description of Prototype · Implementation Plan · Implementation Results | ✅ All present (this whole chapter was missing before) |
| **Conclusion** (H1) | *(no subsections prescribed)* | ✅ Present — we used Summary / Conclusions / Recommendations |
| **References** (H1) | APA style | ✅ 20 entries — see §3.3 |

### Appendices (template's exact titles)

| Appendix | Required content | Status |
|---|---|---|
| **A. Resource Persons** | Names, roles, affiliations | ✅ Written — **needs signed certification page attached** |
| **B. Relevant Source Code** | Actual source listings | 🔧 **Scaffolded only — 6 slots to fill** |
| **C. Evaluation Tool / Test Documents** | The instrument + completed test docs | 🔧 **Scaffolded only** |
| **D. Sample Input / Output / Reports** | Screens and generated documents | 🔧 **Scaffolded only — 19 captures listed** |
| **E. User's Guide** | Operating instructions | ✅ Written in full, all five roles |
| **F. Personal Technical Vitae** | One per proponent, **as tables** | 🔧 **Scaffolded — wrong format, see §3.4** |

---

## Part 2 — Tasks Claude Code can do without you

These need only the repository. Give Claude Code this section directly.

### Task B — Appendix B: Relevant Source Code

Extract six listings into `docs/manuscript/appendix-b/` as separate `.md` files,
each fenced with the language, trimmed to the relevant function(s) — not whole
files — and each preceded by its file path and line range.

| Slot | Source | What to extract |
|---|---|---|
| B.1 | `src/utils/requests.js` | `computeAmountNeeded` + `computeFunding` — the Order of Charging (bill − PhilHealth − other) and the sibling-slice tally |
| B.2 | `src/utils/requests.js` | `deriveRequestStatus` + `isSliceTerminal` |
| B.3 | `src/pages/admin/Requests.jsx` | The endorsement transaction — slice creation, slot decrement, `documents.agencyIds[]` stamping, patient notify |
| B.4 | `src/components/agency/ApplicationModals.jsx` | The approval transaction — cooldown + cap checks, budget increment, request advance, Hospital ID stamp |
| B.5 | `firestore.rules` | Four excerpts: `auditLog` actor-binding, `interviewSlots` compare-and-set booking, `certificates` cross-agency guard, `users` role-escalation guard |
| B.6 | `functions/src/onInterviewSlotWritten.js` | The whole handler — request sync + queue-number assignment |

Keep each listing under ~60 lines. Where you trim, use `// …` and say what was
removed.

### Task C — Appendix C: Test Documentation

1. Run `npm run test:all` and `npm run test:e2e`; capture the full output to
   `docs/manuscript/appendix-c/test-run.txt`.
2. Confirm the per-suite counts still match what the manuscript claims —
   **utils 35 / components 64 / functions 49 / rules 138 = 286**. If any number
   has drifted, report the new figure; Table 9, Table 10, the Abstract, the
   Conclusion Summary and §4.1 of the revision report all cite it.
3. Export the most recent successful GitHub Actions run summary (job names,
   durations, result) to `docs/manuscript/appendix-c/ci-report.md`.
4. Produce `docs/manuscript/appendix-c/acceptance-script.md` — a scenario-based
   UAT script with a sign-off column, covering patient → CRMC → agency end to
   end from registration through Guarantee Letter download. Derive the steps
   from Appendix E in the manuscript so the two agree.

### Task D — Appendix D: Sample Input/Output/Reports

Write a Playwright script (`tests/e2e/capture-appendix-d.spec.js`, excluded from
CI) that logs in as each seeded role and captures the 19 screens listed in
Appendix D of the manuscript. Save as PNG to `docs/manuscript/appendix-d/`,
named `D-01-landing.png` … `D-19-reports.png`.

- Patient screens at 390×844 (phone). Staff screens at 1440×900.
- Seed first with `scripts/seed-demo-scenario.js` so there is an in-flight
  request to photograph.
- **Redact before saving**: no real patient names, addresses, contact numbers,
  ID images, or selfies. Use demo data only. If any capture shows real PII, drop
  it and say so.

### Task E — Verify Appendix E against the shipped UI

Appendix E of the manuscript was written from the docs, not by clicking through.
Walk each of the five role guides against the actual pages and report any step
that names a button, page, or field that no longer exists. Don't rewrite it —
just list the mismatches.

---

## Part 3 — Corrections to make in the manuscript itself

### 3.1 Abstract is over the template's limit

The template specifies **150–350 words** and says "usually a one-pager abstract
is the most ideal." The current abstract is **~450 words** across five
paragraphs. Cut to ~330 by compressing paragraphs 3 and 4 (tech stack and
verification) into one. Keep the questionnaire figures and the co-funding
description — those are the substance.

### 3.2 One heading name differs from the template

Template says **"Requirements Analysis"**; the manuscript says **"Requirement
Analysis"** (singular), because that is what your original manuscript used.
Change it only if you want strict template conformance — update the heading and
the Table of Contents entry together.

Two other names we deliberately kept from your original rather than the
template: *Review of Related Literature, Studies, and Systems* (template writes
it with slashes) and *Statement of the Problem* (not a template heading at all).

### 3.3 Three citations still unverified

`Astudillo et al. (2024)`, `Marcelo et al. (2024)` and `Tinam-Isan & Naga (2024)`
were carried over from your original list unchanged — I could not confirm any of
them exist. Check each against your own source copies. If one cannot be found,
either replace it or remove the claim it supports; a panel that cannot locate a
cited source will ask about it.

### 3.4 Appendix F is in the wrong format

The template supplies the vitae as **tables**, not prose:

- **Educational Background** — columns: Level (Tertiary / Vocational-Technical /
  High School / Elementary) | Inclusive Dates | Name of School or Institution
- **Professional or Volunteer Experience** — Inclusive Dates | Nature of
  Experience / Job Title | Name and Address of Company or Organization
- **Affiliations** — Inclusive Dates | Name of Organization | Position
- **Skills** — Skills | Level of Competency | Date Acquired
- **Trainings, Seminars, or Workshops Attended** — Inclusive Dates | Title

Each in reverse chronological order. Rebuild the four vitae as empty tables in
this shape so each proponent just fills cells.

### 3.5 One open security item to resolve before submission

`firestore.rules:425` — `allow get: if true` on `/hospitalIds/{id}`. Because
this is open, NFR-04 makes no blanket deny-by-default claim and the item appears
as **Recommendation 1 for the System** in the Conclusion.

If you want it closed: route registration exclusively through the
`verifyAccessCode` Cloud Function, withdraw the direct-read permission, and
**invert `tests/rules/hospitalIds.rules.test.js:53`**, which currently asserts
the unauthenticated GET as correct behaviour. Then tell me and I'll rewrite that
recommendation as a closed item and strengthen NFR-04.

---

## Part 4 — Needs a human, not Claude Code

| Item | Who |
|---|---|
| Wet signatures on Endorsement Form and Approval Sheet | Adviser, coordinator, panel, program head |
| Signed certification of the interview-questionnaire | CRMC / respondents |
| Completed and signed questionnaire forms for Appendix C | You — from your files |
| **Item-level questionnaire tallies** | You — only the 8 group means exist (patients 4.00 / 4.37, social workers 4.00 / 4.00 / 3.90, supervisors 4.00 / 4.33 / 4.20). A per-item table would strengthen Table 13 considerably. |
| Signed acceptance test forms | Whoever ran the walkthrough |
| Four personal vitae | Each proponent |
| Final defense date on the title page | Your coordinator |

---

## Part 5 — How to rebuild the .docx after changes

The generator is **not in the repo** — it lives in this session's scratchpad
(`blocks.py`, `front.py`, `ch1.py`, `ch2a/b/c.py`, `ch3.py`, `ch4.py`,
`build.py`, `resolve_pages.py`). It is a two-pass build: it renders to PDF, reads
the real page numbers back out, and rewrites the Table of Contents.

So don't have Claude Code edit the `.docx` directly for anything structural —
produce the *material* (Parts 2 and 3 above) into `docs/manuscript/`, then come
back here and I'll regenerate the document with everything folded in and the
page numbers, tables, and figure numbering all still correct.

Small text fixes made directly in Word are fine; just tell me what you changed
so the generator doesn't overwrite them.
