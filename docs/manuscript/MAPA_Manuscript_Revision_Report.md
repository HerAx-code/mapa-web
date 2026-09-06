# MAPA Manuscript — Revision & Gap Report

**Prepared:** 4 September 2026
**Source manuscript:** `MAPA_REDEFENSE_5.pdf` (68 pages)
**Template applied:** `FTCRD19100_IT_IS_Capstone_Project_Manuscript_Template2.docx`
**System of record:** `mapa-web` repository — `CLAUDE.md`, `docs/thesis-summary.md`
(2026-09-04), `docs/thesis-documentation.md`, `docs/remaining-work.md`
(2026-08-28), `docs/defense-cheat-sheet.md`, `firestore.rules`,
`functions/index.js`, `package.json`, `tests/`
**Output:** `MAPA_Manuscript_Final_Sept2026.docx` — 139 pages

---

## 1. What changed, at a glance

| | Old manuscript | New manuscript |
|---|---|---|
| Pages | 68 | 139 |
| Chapters | 3 of 6 | 6 of 6 |
| Tables | 7 | 14 |
| Figures | 15 | 14 (renumbered, 3 redrawn) |
| References | 17 | 20 |
| Appendices | 1 (unlabelled) | 6 (A–F) |

The manuscript now follows the STI template's own styles — `Body of Research`,
`Heading 1`, `Heading 2`, `References`, Times New Roman 12 pt, double-spaced,
justified, 1.5″ binding margin, roman front matter then arabic body, and the
`STI College Cotabato` footer with page numbers.

---

## 2. Structural gaps that were closed

The template requires a chapter structure the old manuscript stopped short of.

| Template section | Old manuscript | Action |
|---|---|---|
| Acknowledgements | **Missing** | Written |
| Abstract | **Missing** | Written (~450 words, with the header block the template specifies) |
| Table of Contents | Present, incomplete | Rebuilt with real page numbers |
| List of Tables / List of Figures | **Missing** | Added |
| Introduction → RRL | RRL was a **top-level chapter** | Moved under Introduction as a Heading 2, per the template |
| Methodology → Development | **Missing** | Written |
| **Results and Discussion** | **Entire chapter missing** | Written — Testing, Description of Prototype, Implementation Plan, Implementation Results |
| Conclusion | **Missing** | Written — Summary, Conclusions, Recommendations |
| Appendix A. Resource Persons | Present but unlabelled | Labelled and expanded |
| Appendix B. Relevant Source Code | **Missing** | Scaffolded — 6 named excerpts with descriptions; **you paste the listings** |
| Appendix C. Evaluation Tool / Test Documents | **Missing** | Scaffolded — **paste the signed questionnaires and CI report** |
| Appendix D. Sample Input/Output/Reports | **Missing** | Scaffolded — 19 named screens to capture |
| Appendix E. User's Guide | **Missing** | Written in full — all five roles |
| Appendix F. Personal Technical Vitae | **Missing** | Scaffolded ×4 — **each proponent fills their own** |

> **The most serious of these:** the old manuscript forward-referenced "the
> Results and Findings chapter" on pages 3, 23–24 and 31, and that chapter did
> not exist. A panel checking a cross-reference would have found nothing. The
> chapter now exists and is called **Results and Discussion**, matching the
> template's name, and the three forward references were rewritten to match.

---

## 3. Factual corrections — manuscript vs. deployed system

Every item below was verified against the repository, not inferred.

| # | Old manuscript said | Current system | Where fixed |
|---|---|---|---|
| 1 | Assessment interview conducted **online via Google Meet**; MAPA only schedules and delivers the link | **Self-service booking from capacity-limited slots, in person by default** at the CRMC Medical Social Service office with an in-person queue number; Google Meet is the **online fallback** for emergencies, disaster, or distance | Purpose & Description, Objectives, Scope, Limitations, Requirement Analysis, FR-P-06/07, FR-CRMC-03, Storyboard Scenes 6 & 22, Use Case Figures 12 & 14 |
| 2 | "Free-tier deployment… Firebase Spark plan… Vercel Hobby… reminders rely on client-side fallbacks… no Cloud Functions" | **Blaze (metered) plan. Seven Cloud Functions deployed in `asia-southeast1`**: `verifyAccessCode`, `syncRequestFinancials`, `onInterviewSlotWritten`, `interviewReminders`, `resetAgencySlots`, `glExpirySweep`, `deleteAuthUser` | Technical Background (Firebase), new **Table 6**, System Architecture, Development → Deployment, NFR-02 |
| 3 | Limitation: "**No SMS notifications** — excluded as cost-prohibitive" | SMS **is built** via Semaphore (`api/send-sms.js`, opt-in per call, PII-free); **not yet live** pending sender-name approval | Limitations, Implementation Plan (readiness gates), Recommendations |
| 4 | Four partner agencies incl. **Malasakit Center as a funder**; PhilHealth treated as a program alongside them | **Four GL-issuing funders: DOH-MAIP, PCSO MAP, DSWD AICS, AMBaG.** Malasakit is modelled as the **CRMC gateway role itself** (RA 11463 = a coordination hub, not a funder) and retained disabled. **PhilHealth is not an agency** — it is the first-charge coverage (`philhealthCovered`) that reduces the bill under JAO 2020-0001 | Project Context, Purpose & Description, new subsection **"The Order of Charging in the Data Model"**, FR-CRMC-05, Table 7, Conclusions |
| 5 | Data model listed 12 collections | ~18 in `firestore.rules`, incl. `interviewSlots`, `docReviewPresence`, `notificationErrors`, `referralSuggestions` | **Table 7** rewritten |
| 6 | NFR-04 security = HTTPS + Firestore rules only | Adds **staff TOTP MFA** (Identity Platform, patients exempt), **App Check** (reCAPTCHA Enterprise, monitor mode), **security headers + report-only CSP**, Dependabot + `npm audit` in CI, and a **rules-deploy CI gate** | NFR-04, Technical Background, Development → Security Practices, Permissions matrix |
| 7 | No testing evidence anywhere in the manuscript | **286 automated tests** (utils 35 / components 64 / functions 49 / rules 138) + Playwright E2E, GitHub Actions CI, pre-commit hook | New **Tables 9, 10, 11**; NFR-12 added |
| 8 | NFR-02: "50 concurrent applications per agency per day **within the constraints of the free-tier Firebase plan**" | The fixed daily write quota is gone on the metered plan | NFR-02 rewritten |
| 9 | RA 10173 §16(e): Auth account was an acknowledged residual after erasure | Closed by the deployed `deleteAuthUser` function | Compliance Verification, FR-CRMC-17, Table 6 |
| 10 | No mention of §16(c) right of access | Patient-facing **data access log** shipped | FR-P-15, Permissions matrix, Storyboard |
| 11 | Bilingual claim unqualified | Patient surfaces are FIL/EN and lint-enforced; **staff surfaces are English-only by design** | NFR-05, Limitations |
| 12 | Access Code issued on a printed slip | Also issued as a **scannable QR** that pre-fills the portal | FR-P-01, FR-CRMC-09, Storyboard Scene 1 |
| 13 | No mention of inter-agency coordination features | Case Timeline, sibling-approval watchers, live over-commitment guard, structured referrals, branded announcements | FR-A-06/10/14, RRL (Bardach; Klijn & Koppenjan), Objectives & Features |
| 14 | Calendar ended June 2026 | Extended through **September 2026** — two new activities (production hardening; final consolidation) and four calendar figures rebuilt as native Word tables | Calendar of Activities, Figures 8–11 |
| 15 | Title page / endorsement / approval: May 2026 | **September 2026** | Front matter |

---

## 4. Things I want you to check before submitting

### 4.1 One open security finding — I reported it honestly rather than hiding it

`firestore.rules:425` still reads `allow get: if true` on `/hospitalIds/{id}`.
Single-document reads of Patient Access Codes are therefore possible without
authentication via the Firestore REST API, bypassing the `verifyAccessCode`
throttle. `Register.jsx` still keeps a direct-read fallback, and
`tests/rules/hospitalIds.rules.test.js:53` **asserts the unauthenticated GET as
correct behaviour**, so closing this means inverting the test, not just the rule.

I did **not** write a blanket "all access is server-enforced and deny-by-default"
claim into NFR-04, because it would be false while this is open. Instead the
manuscript states the security posture accurately and lists the item as
**Recommendation 1 for the System**, in the proponents' own voice. If you close
the rule before submission, tell me and I'll rewrite that recommendation as a
closed item.

The other critical finding from your August audit — the unauthenticated
`api/send-email.js` open relay — **is closed**; the route now verifies the
Firebase ID token via `jose` and rejects anonymous sessions. That's reflected
positively in the manuscript.

### 4.2 Data I could not source — fill these in

- **Item-level questionnaire results.** Table 13 reports exactly the eight group
  means your old manuscript stated (4.00 / 4.37 / 4.00 / 4.00 / 3.90 / 4.00 /
  4.33 / 4.20). I did **not** invent a per-item breakdown. If you have the raw
  tally sheet, an item-by-item table would strengthen the chapter considerably.
- **Appendix B** — paste the six source listings named there.
- **Appendix C** — paste the signed questionnaires, the CI run report, and the
  acceptance test forms.
- **Appendix D** — capture the 19 listed screens from the live system.
- **Appendix F** — each proponent completes their own vitae.
- **Signatures** on the endorsement form, approval sheet, and Appendix A.

### 4.3 Citation repairs I made — please confirm you're comfortable

Three references in the old list did not match how they were cited in the text:

1. **Zhou et al. (2017)** was cited as showing *"web-based appointment systems
   reduce waiting time from 98 minutes to 7 minutes"*, but the reference entry
   was *"Factors influencing behavior intentions to mHealth: The role of
   perceived value and trust"* — a different paper making a different claim. I
   could not verify the 98→7 minute figure to any source, so **I removed that
   claim** and rewrote the citation to match what the referenced paper actually
   argues (perceived value and trust as adoption determinants), tying it to the
   appointment-booking design instead. Reference updated to Zhou et al. (2019),
   *Int. J. Medical Informatics*.
2. **Tangcharoensathien et al. (2020)** was given as *The Lancet* 374(9701),
   1607–1620 — that volume/issue is 2009. Corrected to *The Lancet*, 391(10126),
   1205–1223 (2018).
3. **Yellowlees et al. (2020)** was given as *Academic Psychiatry* 44, 519–523.
   The telepsychiatry rapid-conversion paper is *Psychiatric Services*, 71(7),
   749–752. Corrected.

Three references were **added** because the new chapters cite them: Bardach
(1998), Klijn & Koppenjan (2016), and JAO 2020-0001 / RA 11463.

**Astudillo et al. (2024), Marcelo et al. (2024) and Tinam-Isan & Naga (2024)
I left exactly as you had them** — I could not independently verify these three
and did not want to alter citations you may have sourced locally. Please check
them against your own copies before submission; a panel that cannot find a cited
source will ask about it.

### 4.4 Figures

- **Figures 1–7** (React, Vite, Tailwind, Firebase, Vercel, VS Code, Google
  Meet) — extracted from your PDF and reused unchanged.
- **Figures 8–11** (Calendar of Activities) — **rebuilt as native Word tables**
  rather than images, so you can edit dates directly. Extended to September 2026.
- **Figures 12–14** (Use Case Diagrams) — **redrawn.** The originals were stale:
  the patient diagram showed *"Join assessment interview"* when your system now
  books appointments, and none of the three showed PhilHealth first-charge,
  the data access log, RA 10173 erasure, or referral suggestions. The redrawn
  versions match the original visual style and the current feature set.
- Old Figures 14–16 in the List of Figures (architecture, lifecycle, order of
  charging) **did not exist in the document** — removed from the list. If you
  want them drawn, say so; the Order of Charging one would be worth having.

### 4.5 Deliberate formatting choice

The template instructs *"in the succeeding paragraphs, there should be no
indentations."* Your existing manuscript indents the first line of every body
paragraph, and the panel has read it that way through four defenses. **I kept
your indentation** rather than the template's literal instruction. Say the word
if you'd rather match the template exactly — it's a one-line change.

---

## 5. Table and figure renumbering

Tables 6, 7 and 8 were renumbered so that they appear in document order (the
Cloud Functions table now precedes the data model, which precedes the
permissions matrix). In-text references were updated to match.

| Old | New | Table |
|---|---|---|
| — | 6 | Deployed Cloud Functions *(new)* |
| 6 | 7 | MAPA Data Model (Firestore Collections) |
| 7 | 8 | User Roles and Permissions Matrix |
| — | 9–14 | Test suites, rules cases, defects, performance, questionnaire, objectives traceability *(all new)* |

---

## 6. Likely panel questions this revision now answers

1. *"Where are your results?"* — Chapter 4 now exists, with 286 tests, measured
   performance against stated targets, and the questionnaire data.
2. *"How do you know it's secure?"* — Table 10, the incident narrative, and the
   honest open item in the recommendations.
3. *"Why is Malasakit not one of your agencies?"* — the Order of Charging
   subsection, grounded in RA 11463 and JAO 2020-0001.
4. *"Your manuscript says Google Meet but your demo books an in-person slot."* —
   no longer a discrepancy.
5. *"What are your conclusions?"* — six numbered conclusions, each tied to a
   finding, followed by recommendations split across CRMC, the system, and
   future research.
