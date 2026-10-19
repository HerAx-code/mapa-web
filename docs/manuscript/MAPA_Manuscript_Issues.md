# MAPA Manuscript — Review Findings

**Reviewed:** `MAPA_Manuscript_Complete_Oct2026.docx`, 163 pages, 39,582 words, 18 October 2026
**Method:** three independent full-text passes plus a mechanical re-check of every hard number against the working tree at commit `947584c`

Paragraph indices below refer to the extracted text. Where a figure was checked
against the repository, the verified value is stated.

**Verified against the repository today:** `firestore.rules` = **1,031 lines** ·
`src/pages/**/*.jsx` = **54 pages** · Cloud Function handlers = **10** ·
top-level Firestore collections = **19** · tests = **690** (256 / 131 / 94 / 209).

---

## A — Contradictions a panelist finds by comparing two pages

These are the dangerous ones: both statements are in the manuscript, and the
reader does not have to leave it to see the conflict.

**A1. Cloud Functions: seven vs ten.** [2424] "seven Cloud Functions in the
asia-southeast1 region" against [2254] and [2450] "ten Cloud Functions", and
Table 7, which itemises exactly ten. The repository has ten. **[2424] is wrong.**

**A2. Security-rules line count: ~930 vs 1,031.** [2312] "runs to approximately
930 lines" against [2450] "1,031 lines of security rules". The file is 1,031
lines. **[2312] is wrong.**

**A3. Page count: 46 vs 56 vs 54.** [2374] "a second, full-system review covering
all 46 pages" and the Table 12 row label [2384] "Full-system audit (56 pages)"
describe *the same review pass* with different numbers; [2450] says the live
system spans 54 pages. The system has 54 pages today. The review passes happened
when the count was different, so this needs a decision rather than a find and
replace — either date the review figures ("all 46 pages as the system then
stood") or restate them at 54.

**A4. Firestore collections: eighteen vs nineteen.** [2692] "approximately
eighteen data collections" against [2450] "nineteen Firestore collections" and
Table 8, which itemises nineteen. "Approximately" is also out of place in a
Summary that gives every other figure exactly.

**A5. The Patient Access Code rule is both fixed and still open.** [2250] states
the collection "was closed in the same pass: its single-document read now
requires authentication… and the corresponding rules test was inverted to assert
the denial." Recommendation [2716] says reads "are currently permitted without
authentication" and recommends inverting that same test. Nearly identical wording,
opposite claims. One is a leftover.

**A6. Application attestation: live vs not yet active.** [2450] lists
"application attestation in monitor mode" among components that are live, while
readiness gate [2442] says error tracking and attestation "require console
registration and environment configuration to become active."

**A7. SMS channel: integrated vs awaiting approval.** [1458] "Semaphore —
Philippine-local SMS gateway integrated as an opt-in channel" against [431] "the
SMS channel awaiting gateway approval of its sender name."

**A8. Firebase services: four vs five.** [493] "Firebase provides four core
backend services" and enumerates four; the Resources list [1453] gives the same
four plus Cloud Storage. [431] says document storage has not yet migrated, so
Cloud Storage is probably not in use — but [2413] lists it as a deployment
prerequisite and [2424] names it again.

---

## B — Numbers and arithmetic

**B1. The instrument has fourteen rated statements, not thirteen.** Stated as
thirteen at [2419], [2493], [2532] and [3078]. The rating sheet actually carries
3 + 2 + 5 + 2 + 2 = **14**. I re-derived this from the filled instrument. Table 15
is already computed on fourteen — the patient's 3.86 is 54 ÷ 14, not 54 ÷ 13 —
so the tables are right and the prose is wrong in four places. **This is my error.**

**B2. Table 15's bottom row does not follow from its own columns.** The row is
labelled "Across all five characteristics", but its figures are the mean of the
fourteen individual statements, not the mean of the five characteristic means.
They differ for two of three roles:

| | printed | mean of the 5 characteristic means |
|---|---|---|
| Patient | 3.86 | 3.86 ✓ |
| CRMC staff | 3.36 | **3.47** |
| Agency | 3.36 | **3.49** |
| Average | 3.52 | **3.61** |

Both are legitimate statistics; averaging the statements is arguably the better
one, because averaging the characteristic means would weight a two-item
characteristic the same as a five-item one. The fault is the **label**. Fix by
renaming the row "Across all fourteen statements" and adding one sentence saying
why. [2694] needs the same correction. **This is my error.**

**B3. "More than thirty points" is false.** [2702]. The gaps are 75.0 − 47.5 =
**27.5** and 75.0 − 42.5 = **32.5**. Only against the two-staff mean is it
exactly 30.0. Say "by 27.5 and 32.5 points."

**B4. "The highest single rating in the study — 4.33."** [1511]. Table 1 at [1477]
records 4.37 for patients. The inference built on top of it — that the strongest
rating came from the group furthest from patients — collapses with the premise.

**B5. Interpretation band contradicts the scale.** Table 1 labels 4.37 and 4.33
as "Agree", and [2691] says "All three groups rated the proposed features at the
Agree level." The equal-interval scale the manuscript itself prints in Appendix
C.1.4 puts 4.21–5.00 in **Strongly Agree**. Either Table 1 used a different band
table, which must then be stated, or those labels are wrong.

**B6. "The security-rules suite is the largest of the four."** [2404], and
[2312] "they receive the largest share of test coverage". Table 10: unit 256,
rules 209. The unit suite is larger by 47.

**B7. Table 1's "overall rating" figures cannot come from a single item.** With
n = 3 and integer responses, a one-item mean must end in .00, .33 or .67. The
three single-statement means do; the three "overall rating" figures (4.37, 3.90,
4.20) do not, so they must be composites across several items. The table never
says so, and [1463] calls them "the group means". Add a note defining how
"overall" was computed.

**B8. Five of Table 13's six performance targets are not in the NFRs.** [2453]
says performance was measured "against the targets stated in the non-functional
requirements", but Table 6 contains one performance target (NFR-01, under 4
seconds on 4G). The bundle size, render time, read latency, animation budget and
"fast enough for pre-commit" appear nowhere in the requirements — and the last is
not measurable yet is marked "Met". [2693] then generalises to "Measured
performance met every stated target."

---

## C — Content that is broken on the page

All three are defects I introduced when cutting the Appendix B listings.

**C1. B.6 prints a `catch` with no `try`.** The extraction skipped line 43 of
`purgeSelfieOnClose.js`, which is the `try {`. The listing as printed will not
parse, and [2818] claims every excerpt is quoted verbatim.

**C2. B.5 prints `allow update, delete: if false;` twice.** Line 762 of
`firestore.rules` is already inside the quoted range, and a hand-written copy was
appended after it.

**C3. B.5's certificates excerpt is unbalanced and truncated.** It opens with a
hand-written `allow create: if isAdmin() ||` then starts the real quote at line
834, skipping line 833's `(isAgency() &&` — so a parenthesis is missing — and
ends mid-expression on `allow update: if isAdmin() ||`.

**C4. B.3's heading contradicts its own trim note.** The heading says the
transaction stamps the documents and notifies the patient "all within a single
Firestore transaction so that a partial endorsement cannot occur", while the note
beneath says the trimmed material includes "the post-transaction document
stamping". The stamping is deliberately *outside* the transaction — that was a
bug fix — so the heading claims the opposite of the design.

**C5. A leftover `'interview'` status is visible in the B.1 listing.**
`OUTSTANDING_SLICE_STATUSES = [… , 'interview']`. It is genuinely in the source,
retained for historical slices, but in a manuscript whose argument is that the
appointment was removed it needs a one-line note or a panelist will read it as
the booking system still being live.

---

## D — Residue of the removed appointment design

The literature review still argues for the booked in-person interview that the
system no longer has. This is the most visible draft residue in the document.

- [438] "the proponents' decision to schedule the assessment interview as in
  person by default while retaining an online fallback"
- [448] "the appointment system assigns and displays a queue number for in-person
  interviews, making the reservation tangible enough for a patient to rely on it
  instead of arriving early to queue"
- [436] frames the whole queue literature around "a system asking indigent
  patients to rely on a booked appointment"
- [454] "the slot visibility, interview booking, and document submission
  functions of MAPA"
- [466] "the trustworthy appointment reservation"

All five directly contradict [403]: "No slots are published, no queue numbers are
issued, and no appointment reminders are sent, because there is no appointment to
keep."

Related: [1520] duplicates [1521] (both describe browsing the agency directory)
and its "check real-time slot availability per agency" is pre-gateway framing —
under the gateway the patient never picks an agency. [2169] still says the patient
reads agency requirements "before travelling", when not travelling to agencies is
the point.

---

## E — Missing or incomplete

**E1. Four placeholder slots remain.** The signed evaluation response sheets
[3496], the CI run summary [3551], the completed acceptance forms [3731], and all
of Appendix D [3754]. Appendix D is nineteen captions written as instructions
("Each item should be captured from the live system") with no content.

**E2. Appendix C.2.1 contains a written admission against the manuscript.**
[3551]–[3552] explains that the CI report in the repository "would contradict
those reported in Chapter 3." That sentence was mine, intended as an honest note
to you — it should not ship. Either capture a current green run or delete the
explanation and leave a plain slot.

**E3. No reference entry for ISO/IEC 25010 or the System Usability Scale.** Both
are central to Chapter 3 and neither appears in the References. The SUS grade and
adjective bands in Table 16 are also unsourced, and the "published average of 68"
is cited to nothing. Minimum: ISO/IEC 25010:2023, Brooke (1996), and a source for
the benchmark and bands.

**E4. Identity Verification has no requirement behind it.** [2256]–[2260]
describe guided camera quality gating, on-device OCR cross-check, face match,
passive liveness, a social-worker identity review panel and PhilSys QR
verification. Only FR-P-03 touches any of it. There is no CRMC-side requirement
for the identity review panel, nothing in the Table 9 permissions matrix, and no
NFR for the thresholds — yet "confirming the applicant's identity" is one of the
eight evaluated staff tasks.

**E5. No figures anywhere in Chapter 3, and none of the system itself.** The
nineteen figures are six vendor logos, nine month calendars, three use-case
diagrams and one process flow. There is no architecture diagram, no data-flow
diagram, no ERD, and **no screenshot of the delivered system anywhere in the
manuscript**. "Description of Prototype" has no figure at all, and its subsection
is still headed "Preliminary Design and Interface Experience".

**E6. The post-implementation evaluation has no date, place or affiliations.**
Nowhere does it say when the three sessions were held, where, or which office the
staff administrator and agency coordinator came from. The pre-development survey
has all of this.

**E7. Objectives do not reconcile.** [409] says "Each specific objective below
answers the correspondingly numbered problem stated above", but there are five
problems and six objectives. Table 17 then has thirteen rows and no row for
objective [414] (intelligibility, assisted filing, filing by a representative),
while [2687] asserts "Every stated objective is satisfied by a delivered feature."

**E8. Monitoring activation drops out of the recommendations.** [2442] lists
seven readiness gates; the conclusion [2701] and the CRMC recommendation [2707]
each name five, and monitoring activation is in neither.

**E9. Appendix A lists no resource person who actually contributed data.** Four
people share the single title "Capstone Project Adviser/ICT Instructor" though the
study names one adviser, and none of the nine survey respondents or three
evaluation respondents appears. No dates, contributions or contact details.

---

## F — Claims stronger than the evidence

**F1. "No combination of independent agency approvals can commit more than the
patient actually owes."** [2698]. The rule in B.5 caps each slice at its own
`amountRequested`; nothing bounds the cross-agency total. FR [1663] describes the
over-commitment guard as a **warning**, and the acceptance script [3640] says
CRMC "may intentionally over-endorse across agencies for a buffer." Soften to a
per-slice cap plus an advisory cross-agency guard.

**F2. "Functionally complete and acceptably fast and secure."** [2626]. Security
here rests on three users answering two perception items, plus an open
unauthenticated-read rule conceded at [2716]. Attribute security to the rules
suite, not to the respondents.

**F3. "The deployed system demonstrates that one verification and one assessment
can serve several independently governed funders."** [2697]. No partner agency
ever operated the platform; the four agencies are seeded data and the agency role
was exercised by one coordinator on demonstration data. "Shows to be technically
feasible" is the defensible verb.

**F4. "Indicating multi-level institutional readiness."** [388]. Nine
respondents cannot establish institutional readiness, and [430] and [1513]
correctly hedge the same data — so the manuscript contradicts its own caution.

**F5. Absence claims with no survey behind them.** [462] "no comparable
patient-centered digital platform currently exists in a public hospital setting",
[457] and [464] similar. Soften to "none of the systems reviewed".

**F6. The Order of Charging claim overstates the build.** [464] implies MAPA
models the full statutory sequence; the system models PhilHealth as first charge
and then endorses the residual to the rest as unordered parallel slices.

**F7. "Scalable."** [406], against [426] which says extending beyond CRMC is
"future architecture rather than a configuration change."

**F8. Table 10 reports every suite "Pass" while the combined run exits non-zero.**
Appendix C's own capture note explains why — a worker crash, not an assertion
failure — but Table 10 and [2247] should carry the qualification too.

**F9. "Three structured review passes" and chapter-level claims are fine**, but
[1513] promises "a post-implementation evaluation with a larger sample" and the
realised evaluation is n = 3, one third of the earlier survey. Chapter 3 caveats
this well; the Chapter 2 promise is left dangling.

---

## G — Appendix F (the curricula vitae)

**G1. All four proponents carry identical pre-tertiary dates** — Vocational 2018–2020,
High School 2014–2018, Elementary 2008–2014 — and all four show Tertiary
"2025–Present". Four unrelated people with four identical date ranges is not
credible, "2025–Present" does not fit a fourth-year capstone, and there is an
unexplained 2020–2025 gap in every CV.

**G2. The Vocational/Technical row is mislabelled in three of four CVs** — the
same school is listed for both Vocational and High School. These are almost
certainly Senior High School entries.

**G3. Aaron's and Saud's skills and trainings tables are byte-identical.**

**G4. The technical vitae contain almost no technical skills.** Across all four,
the only programming entry is "Programming — Basic" on two CVs. No JavaScript,
React, Firebase, Git or testing anywhere, in an appendix titled *Personal
Technical Vitae* backing a 54-page, 690-test platform.

**G5. Aaron's phone number has ten digits**; the other three have eleven.

**G6. Word artifacts survive** — "right-11874500Curriculum Vitae of" heads all
four CVs, and several empty template rows remain.

---

## H — Consistency and polish

**H1. "Slot" means two different things.** [403] says no slots are published
(appointments, abolished); FR-A-11 and Table 8 use "slot" for an agency's daily
funding capacity. Rename the second one.

**H2. "Hospital ID" and "Patient Access Code" are used interchangeably.**
FR-CRMC-09 is titled "Hospital ID Issuance" and its body is entirely about Access
Codes.

**H3. The slice lifecycle is named three ways** — "For Funding" (FR-P-10),
"Funding Review" (Scene 8), "reviewing" (Table 8).

**H4. "Step out of six" vs a five-stage lifecycle.** [2167] and [2415] say the
status hero names the current step out of six; FR-P-10 and Scene 8 list five.

**H5. The staff second factor is named four ways** across [1825], [1996], [2187],
[2254].

**H6. Abstract problems.** 160 words, at the bottom of the 150–350 band, with no
results and no conclusion — it stops after the method. Also "delivered as **an**
Progressive Web Application" and "The requirement **was** established" (should be
plural). This is the first body text a panelist reads.

**H7. Dates on the front matter predate the work.** Title page, endorsement form,
approval sheet and abstract all say **September 2026**, but the calendar runs to
October 2026 and the Capstone 2 Predefense is in the week of 18 October. An
endorsement form for final defense dated September endorses work that had not yet
had its predefense.

**H8. The September 2026 calendar is missing the 30th.** The last row runs 27, 28,
29 and then an empty cell. (The other eight calendars check out, including
starting weekday.)

**H9. The Acknowledgements switch between four proponents and one** — "The
proponents wish" but then "pushed the proponent to justify **his** design
decisions" and "sustained the proponent", signed "The Researchers".

**H10. Mixed British and American spelling** throughout — "favours", "travelling",
"recognised", "generalisation", "Fulfilment" against "recognized", "organized",
"modeled", "fulfillment". Note the title page says "Fulfilment" and the approval
sheet "fulfillment".

**H11. A stray lone "S"** sits immediately before the Introduction heading [377].

**H12. Missing spaces after label colons** on the title page and abstract header —
"TITLE OF RESEARCH:MAPA", "Researchers:BAHER", "Keywords:medical" — and the label
case differs between the two blocks.

**H13. The Mock Defense and Predefense descriptions are word-for-word identical**
[531] and [533] except the final word.

**H14. Figures 1–15 and Tables 2–6 are never referred to in the body.** Only
Table 1 and Figures 16–18 have in-text references in the first half.

**H15. Mixed straight and curly apostrophes** throughout; one find-and-replace pass.

**H16. [2309] "the component suite in approximately fifteen"** — missing "seconds".

**H17. Appendix C.3 step 1.4 contradicts Appendix E and Scene 5** on when the
Household Intake wizard runs; E.4 records PhilHealth before the intake sheet while
Form C runs intake sheet then PhilHealth.

**H18. Two references look hard to verify** — Bidari et al. (2021), a conference
paper with no page range, no DOI and a garbled author list, cited twice as
substantive support; and Astudillo, Reyes & Santos (2024), cited four times with
no DOI. Three entries still use APA 6 "Retrieved from". The MySejahtera URL should
be under `moh.gov.my`.

---

## What is sound

Worth stating, because it is a lot, and none of it should be touched.

The quantitative spine holds. 256 + 131 + 94 + 209 = 690 and 25 + 26 + 10 + 11 =
72, matching everywhere they appear. Task outcomes 8 + 4 + 1 = 13 unaided and
11 assisted over 24, with 54.2% and 45.8% correct. SUS 75.0 + 47.5 + 42.5 = 165,
mean 55.0, each score correctly computed under the stated rule. Table 12 sums to
the 54 fixes claimed. Table 7 contains exactly the ten Cloud Functions, Table 8
exactly nineteen collections. All seventeen tables promised in the List of Tables
are delivered, the figure sequence 1–19 has no gaps or duplicates, and the
references are in correct alphabetical order with every citation matched both ways.
Nine of the twenty references are real international sources, correct down to
volume, page range and DOI.

Appendix E is complete and substantive for all five roles. The limitations
section, the honest reporting of the security incident, the explicit reversal on
the appointment design, and the refusal to let the pre-development survey stand as
evidence about the built system are stronger than is typical for this level and
should be defended, not softened.
