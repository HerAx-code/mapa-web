# Evaluate MAPA with layered, triangulated evidence

A full evaluation of a production system like MAPA does not rest on one instrument. It needs an evidence stack, with each layer answering a different question, organised under the **ISO/IEC 25040:2024 five-step process** (define, design, plan, execute, conclude) and scored against the **nine ISO/IEC 25010:2023 characteristics**. The current model adds **Safety**, renames usability to **interaction capability** and portability to **flexibility**, and moves quality in use into **ISO/IEC 25019:2023** ([ISO/IEC 25010:2023 preview](https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf); [ISO/IEC 25040:2024 preview](https://cdn.standards.iteh.ai/samples/83467/6f61102971184ae6a08ae4f28d431d08/ISO-IEC-25040-2024.pdf)). The ISO 25010 Likert questionnaire that Philippine panels expect should stay, but as one input among several. Around it go five other layers:

- objective ISO/IEC 25023 ratios from MAPA's own test suites, logs and tools;
- role-specific task-based usability testing using SUS, UMUX-Lite and SEQ;
- WCAG 2.2 AA audits that combine automated and manual checks;
- an OWASP ASVS 5.0 Level 2 security verification, backed by a Firestore rules tenant-isolation matrix, alongside a Data Privacy Act compliance checklist and a privacy impact assessment (PIA);
- an operational-outcome study framed by HOT-fit and the WHO digital-health maturity stages, comparing MAPA's timestamps with a paper baseline.

This matters because the usual capstone evaluation (Slovin-sized samples, one pooled weighted mean, "Excellent" declared from 4.21) is methodologically weak, and a panel can take it apart ([Tejada & Punzalan 2012](https://mail.psai.ph/docs/publications/tps/tps_2012_61_1_9.pdf)). MAPA already holds most of the objective evidence a stronger design needs: Vitest, React Testing Library and rules-emulator tests, Playwright E2E, a bundle budget, an audit log, per-case timestamps and a Training Hospital. The extra work lies mainly in instrument validation, honest statistics, a real-user usability round, a privacy compliance pass and a baseline for impact claims.

## ISO standards give the skeleton, and the team sets the thresholds

The 2023 revision reorganised the model, and a late-2026 thesis that cites only the 2011 characteristics looks dated. ISO/IEC 25010:2023 defines these characteristics:

- functional suitability
- performance efficiency
- compatibility
- **interaction capability**, which adds the new sub-characteristics inclusivity and self-descriptiveness; user engagement replaces UI aesthetics, and accessibility is split between inclusivity and user assistance
- reliability, where **faultlessness** replaces maturity
- security, which adds **resistance**
- maintainability
- **flexibility**, which adds **scalability**
- **safety**, with the sub-characteristics operational constraint, risk identification, fail safe, hazard warning and safe integration

The ISO preview documents all of these changes ([ISO/IEC 25010:2023 preview](https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf)). Quality in use now lives in ISO/IEC 25019:2023 as three characteristics: beneficialness, freedom from risk (economic, health, human-life and societal) and acceptability, which includes compliance ([arc42 ISO 25019](https://quality.arc42.org/standards/iso-25019)). Safety suits a medical-financial system. For MAPA, the harm is a wrong eligibility or money decision rather than physical injury, so reasonable safety evidence is the server-enforced endorse gate, the amount caps in `decideSlice`, the assessment lock at endorsement, and audited overrides such as `repeatOverride` and bill reuse.

**The measures still come from ISO/IEC 25023:2016**, which was reconfirmed in 2022 and still uses the 2011 names. A 2026 draft revision exists but is unpublished. Almost every 25023 measure is a ratio, **X = A/B** (items meeting the criterion ÷ items specified), and time measures are means. The catalogue covers functional coverage, mean response time and response-time adequacy, system availability, mean recovery time, access controllability, user audit-trail completeness, coupling of components, cyclomatic complexity adequacy, coding-rules conformity and test-function completeness ([Karnouskos et al.](https://arxiv.org/pdf/2108.02921); [ISO/IEC 25023:2016 preview](https://cdn.standards.iteh.ai/samples/35747/34b91bc957f647ce8bbb2093907d7bc0/ISO-IEC-25023-2016.pdf)). Two practical caveats follow. **25023 and 25022 deliberately set no rating levels**, "because these values are defined based on the nature of the system", so the team must declare and justify its own thresholds ([ISO 35747](https://www.iso.org/standard/35747.html)). And 25023 predates safety, resistance, scalability, inclusivity, self-descriptiveness and user engagement, so the team must define measures for those itself and say so. Karnouskos et al. also found that some technical measures were hard to compute or redundant (MTBF and failure rate overlap), so a justified subset is normal practice ([Karnouskos et al.](https://arxiv.org/pdf/2108.02921)).

**ISO/IEC 25040:2024 supplies the chapter structure.** Its reference process has five steps (define, design, plan, execute, conclude). Each evaluation has three tasks: measurement, rating against predetermined levels, and analysis into strengths, weaknesses and recommendations. A "quality rating module" bundles the measures, the measurement environment and the rating levels for a target ([ISO/IEC 25040:2024 preview](https://cdn.standards.iteh.ai/samples/83467/6f61102971184ae6a08ae4f28d431d08/ISO-IEC-25040-2024.pdf)). The 2024 edition names four evaluation types. MAPA's are "conformity checking to requirements" and "suitability to a specific use" (indigent patients on phones, hospital social workers, agencies). The edition also treats **data** as a target, evaluated with ISO/IEC 25012/25024. That gives the Firestore data-model evaluation a formal home. The standard also states that it "does not provide specific test methods", so the methods below (testing, inspection, static analysis, surveys) are the team's choices, and the chapter should document them as such ([ISO/IEC 25040:2024 preview](https://cdn.standards.iteh.ai/samples/83467/6f61102971184ae6a08ae4f28d431d08/ISO-IEC-25040-2024.pdf)).

Mapped to MAPA, the five steps look like this:

| 25040 step | MAPA content |
|---|---|
| Define | Stakeholders (patients and family members, Hospital Admins and Staff Admins, Agency Admins and Coordinators, Super Admin); evaluation types; targets (the web PWA, Cloud Functions, Firestore data) |
| Design | Weighted 25010:2023 characteristics; chosen 25023 measures plus tool metrics; rating levels declared in advance |
| Plan | Environments (emulator, Training Hospital `TRAIN`, a separate load-test project, real low-end Android phones on mobile data); respondents; ethics clearance; schedule |
| Execute | Measure, then rate each measure |
| Conclude | Quality analysis per characteristic, a risk-ranked defect list and recommendations |

## Functional verification should be traceable, technique-driven and tiered

ISO/IEC/IEEE 29119 is the reference frame: Part 1:2022 for concepts, Parts 2–4 (2021) for processes, documentation and techniques, and Part 5:2024 for keyword-driven testing. It drew a "Stop 29119" campaign from context-driven testers who found it documentation-heavy, so a thesis should cite it as a framework to **tailor**, not follow verbatim ([Wikipedia: ISO/IEC 29119](https://en.wikipedia.org/wiki/ISO/IEC_29119)). A credible tailored package has five parts:

- a Test Plan;
- a **Requirements Traceability Matrix**, tracing each requirement or user story to test-case IDs, the automated test file, the result and any defect IDs;
- Test Case Specification tables recording the technique, preconditions, inputs, expected and actual results, and verdict;
- an incident log;
- a Test Completion Report.

The headline functional measure is 25023's functional coverage, expressed as **requirements coverage = requirements with at least one passing test ÷ total requirements**. The target is 100% for must-have requirements.

MAPA's existing suites already map onto the test levels:

| Test level | MAPA suite |
|---|---|
| Unit | Vitest tests on `src/utils` and the shared `src/shared/caseState.js` |
| Component | React Testing Library |
| Integration | Firestore and Storage rules on the emulator; Cloud Functions handler tests |
| System | Playwright E2E smoke tests in CI |
| Acceptance | UAT with gateway social workers, agency coordinators and patients |

What the panel will want to see is that test cases were *derived* with named 29119-4 black-box techniques, not written ad hoc ([Wikipedia: ISO/IEC 29119](https://en.wikipedia.org/wiki/ISO/IEC_29119)). MAPA's business rules suit each technique:

- **Boundary values** suit `amountNeeded = totalBill − PhilHealth − other`, `maxPerApplicant`, repeat-limit days, the 140/180/220% poverty-line class cut-offs, `BLANK_CODE_CUTOFF` and the 10-day letter validity.
- **Equivalence partitions** suit roles, inpatient vs outpatient, and bound, blank and course-of-treatment codes.
- **Decision tables** suit the endorse gate (documents verified and intake complete, plus the verification-call reasons and the second-person hold) and `emailScope`.
- **State-transition testing** suits the request lifecycle and the slice and letter lifecycles. It should cover every valid transition and chosen invalid ones, such as approving from any state other than `reviewing`.

For coverage, Google's published guideline is 60% "acceptable", 75% "commendable" and 90% "exemplary". Google warns that project-wide goals above 90% are "most likely not worth it" and that the risk in uncovered code matters more than the number ([Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html)). A defensible MAPA target is **at least 75% statement and branch coverage on business-logic modules** (utils, shared, functions), with branch coverage reported separately for the money and lifecycle code, rather than a whole-repository number dragged down by JSX. Vitest's default v8 provider now produces reports identical to Istanbul's ([Vitest coverage](https://vitest.dev/guide/coverage)). Rules coverage needs its own number. The emulator serves a per-expression `ruleCoverage` report after tests run, and the third-party `@simpleclub/firebase-rules-coverage` converts it to LCOV ([Firebase emulator reports](https://firebase.google.com/docs/rules/emulator-reports); [npm](https://www.npmjs.com/package/%40simpleclub%2Ffirebase-rules-coverage)).

Defect metrics should be ones a small team can count honestly:

- **Defect density** per module or KLOC.
- **Defect detection percentage per level**: defects found at a level ÷ (those defects plus any that escaped to later levels) ([ISTQB glossary](https://atsqa.org/assets/documents/ISTQB-Glossary-3.2-GA-Release-Notes-final.pdf)). For MAPA this shows what the unit and rules tests caught versus what reached UAT or production.
- **Defect removal efficiency**, for which Capers Jones reports a range from below 80% to about 99% ([Jones](https://www.ppi-int.com/wp-content/uploads/2021/01/Software-Defect-Removal-Efficiency.pdf)). It is useful context, not a pass mark.

UAT needs explicit entry and exit criteria. Entry requires system testing finished, a completed traceability matrix and a ready environment. Exit requires all critical scenarios to pass with no open P1–P3 defects, and business sponsors must sign off ([Stanford UIT PMO](https://uit.stanford.edu/pmo/UAT)). For MAPA, run the UAT in the Training Hospital with sample patients, and have a gateway social worker and an agency admin sign.

## Usability, accessibility and acceptance need instruments matched to each role

MAPA's four user populations differ too much for one questionnaire, so the usability layer should be built per role.

**Patients** are low-literacy users on low-end phones, working in Filipino and English. Use the **Single Ease Question** after each task ("Overall, how difficult or easy was the task to complete?", 7 points). Its benchmark average is about 5.3–5.6. Pair it with observed success, because about 14% of users who fail a task still rate it very easy ([MeasuringU SEQ](https://measuringu.com/seq10/)). At the end, ask the two-item **UMUX-Lite**, which correlates r = .83 with SUS and converts to an SUS equivalent with about 1% error ([MeasuringU UMUX-Lite](https://measuringu.com/umux-lite/)). If the panel insists on SUS, read it aloud with a large printed response card. **No validated Filipino SUS was found.** The only Philippine-validated usability instrument located is the Filipino Telehealth Usability Questionnaire (TUQ-F) ([JMUST](https://www.jmust.org/elib/journal/doi/10.35460/2546-1621.2022-0045/full)). Follow the Malay mobile-app SUS adaptation: forward and back translation, expert content validation, face validation with about 10 target users, and "system" replaced by the app's name; it reached α = .85 ([PMC5972216](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5972216/)). Present the result as an *adaptation*, not a validation.

**Staff and agency users** should take the full English **SUS** (α = .91). Score it as follows: odd items score the response minus 1, even items score 5 minus the response, and the sum is multiplied by 2.5 ([MeasuringU SUS](https://measuringu.com/sus/)). Read results on the Sauro-Lewis curved scale, where **68 is the 50th percentile (grade C)**, 74.1 is a B and 80.8 an A. Bangor's acceptability bands give a second reading: above about 70 is acceptable, 50–70 marginal and below 50 not acceptable ([MeasuringU interpreting SUS](https://measuringu.com/interpret-sus-score/)). A sensible pre-declared target is **an SUS (or SUS-equivalent) of at least 68 per role, reported with a 95% CI**. The norms come mostly from Western, literate samples, which belongs in the limitations.

**Sample sizes depend on whether the goal is finding problems or measuring them.** Five users per homogeneous group find about 85% of problems, and iterative rounds of five beat one round of 15. Distinct user groups each need their own participants ([NN/g](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/)). Faulkner showed that five-user samples found as little as 55% of problems, while no 20-user sample found under 95% ([Faulkner 2003](https://pubmed.ncbi.nlm.nih.gov/14587545/)). MAPA's plan therefore has two parts:

- A **formative round** with about 5 patients, 3–5 social workers and 3 agency staff, then a fix-and-retest round.
- A **summative patient round of about 20** for task success with a binomial CI, time on task, SEQ and UMUX-Lite. Staff groups are small, so treat their results as descriptive.

Write task scenarios as plain-language goals, and run them in person at the hospital, on participants' own phones over their usual data:

- **Patients:** register with and without a code, file a request with documents and a live selfie, reply to a message, and find the Guarantee Letter.
- **Staff:** verify documents, complete the intake sheet and endorse.
- **Agencies:** approve a slice and mark a letter redeemed.

Before user testing, run expert inspection. Use a **cognitive walkthrough** of first-time patient tasks, where four questions at each step simulate a novice ([Wharton et al.](https://course.khoury.northeastern.edu/is4300sp13/ssl/articles/p381-wharton.pdf)), and a **heuristic evaluation** of staff dashboards. Rate severity 0–4 and average the ratings of at least three independent evaluators, because one evaluator's ratings are "too unreliable to be trusted" ([NN/g severity](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/)).

**Accessibility should target WCAG 2.2 AA** (W3C Recommendation, December 2024 version) ([W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)). The criteria that matter most for patients on phones are:

- 2.5.8 Target Size, which requires at least 24×24 CSS px; W3C advises aiming for 44×44 on important controls, matching MAPA's own ≥44px convention ([W3C Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html));
- 2.4.11 Focus Not Obscured;
- 1.4.3 and 1.4.11 contrast (4.5:1 for text, 3:1 for UI components);
- 1.4.10 reflow at 320 px and 1.4.4 resize to 200%;
- 3.3.7 Redundant Entry and 3.3.8 Accessible Authentication, which apply directly to password and access-code entry.

Automated tools set only a floor. Deque's own data puts axe coverage at about 57% of issues by volume ([Deque](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/)). In a UK GDS test, 29% of barriers were caught by no tool at all ([GDS](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/)). Report automated axe and Lighthouse results per key page, then add a manual checklist covering:

- keyboard order and traps;
- focus hidden behind sticky bars;
- the quality of labels and error messages;
- a TalkBack walkthrough of three to five core patient tasks;
- an alternative for the selfie camera flow.

**User acceptance** should be measured, but kept separate from usability. For staff, short TAM scales (perceived usefulness, perceived ease of use and intention) fit a capstone. TAM's original six-item scales reached α = .98 and .94 ([Davis 1989](https://verdi.cs.ucl.ac.uk/constructDB/publications/davis-perceived-1989.html)). UTAUT2 explains more variance (74% of intention) but adds price value and hedonic motivation ([Venkatesh et al. 2012](https://papers.ssrn.com/abstract=2002388)), which fit poorly for a free assistance service. Philippine evidence supports the constructs. Ong et al. surveyed 533 Filipinos on telemedicine with UTAUT2 and SEM ([IDEAS](https://ideas.repec.org/a/eee/teinso/v70y2022ics0160791x22001816.html)). Marcelo et al. found that only compatibility, facilitating conditions and social factors predicted intention to use RxBox among health workers ([Acta Med Philipp](https://search.bvsalud.org/gim/resource/en/wpr-959989)). That second finding argues for asking MAPA staff about workflow fit. With staff samples far below 100, SEM is not justified. Report descriptives, α per construct and Spearman correlations.

## Performance and reliability are measured on slow phones and a separate project

**Core Web Vitals are the performance yardstick:** LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1, judged at the 75th percentile and segmented by mobile and desktop ([web.dev Web Vitals](https://web.dev/articles/vitals)). The "poor" thresholds are above 4 s, 500 ms and 0.25 ([web.dev thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)). INP replaced FID on 12 March 2024 ([web.dev](https://web.dev/blog/inp-cwv-march-12)).

MAPA's authenticated pages are not publicly indexable, so Chrome UX Report (CrUX) field data will mostly be missing ([CrUX methodology](https://developer.chrome.com/docs/crux/methodology)). The thesis therefore needs two kinds of data:

- **Lab runs.** Use Lighthouse's mobile preset: simulated Slow 4G at 150 ms RTT and about 1.6 Mbps, with a 4× CPU slowdown calibrated through `benchmarkIndex` ([Lighthouse throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)). Run it on the landing, register, patient dashboard, file-request and staff queue pages, three to five runs each, and report medians. Add a real low-end Android phone on actual mobile data.
- **Its own real-user monitoring.** Collect it through the `web-vitals` library and report p75 by role and device class, stating n and the collection window. Lab data reveals failures among users who never finish loading, which field data cannot see ([web.dev lab vs field](https://web.dev/articles/lab-and-field-data-differences)).

MAPA's `npm run budget` gate is the quantity-based budget. web.dev's suggested baseline is under 170 KB of critical-path resources (minified and compressed) for a 3G baseline device ([web.dev budgets](https://web.dev/articles/performance-budgets-101)). Tesseract OCR, selfie capture and uploads are the likely INP risks on low-end phones and deserve scripted interaction tests.

**Load testing must not touch production, and emulator timings are not capacity data.** Firebase states that its emulators are "built for accuracy, not performance" ([Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)). Credible capacity numbers come from a separate, production-like Firebase project with the same rules, indexes and function region, seeded with synthetic data only. Firestore splits load over minutes and is best ramped gradually, and Firebase says "load testing is the best way" to find a workload's limits ([Firestore best practices](https://firebase.google.com/docs/firestore/best-practices)). Spend-cap budgets pause Cloud Functions, while alert-only budgets pause nothing ([Firebase billing](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)).

Run k6's progression of smoke, average-load, stress, spike and soak tests, with p95 latency and error-rate thresholds as pass/fail ([Grafana k6](https://grafana.com/docs/k6/latest/testing-guides/test-types/)). MAPA's realistic peak is probably tens of operations per second, far below Firestore's limits, so the meaningful tests are **contention tests**. Fire concurrent `decideSlice`, `endorseRequest` and `claimAccessCode` calls at the same agency document, `counters/patientIds` and `eligibilityCounters`. Then assert that budgets are never double-committed and that slots never go negative. Firestore documents note that a single document cannot be updated at an unlimited rate, and that each counter shard handles about one increment per second ([Firestore distributed counters](https://firebase.google.com/docs/firestore/solutions/counters)). Report p50, p95 and p99 latency per callable, the ABORTED or contention-error count, the cold-start share and the cost incurred.

**Reliability should be framed in SRE terms.** An SLI is good events ÷ valid events. The SLO sits below 100%, and the error budget is 100% minus the SLO, tracked over a four-week rolling window ([Google SRE Workbook](https://sre.google/workbook/implementing-slos/)). For a small team on Vercel and Firebase, **99.5% a month (about 3.6 hours of allowed downtime)** is a realistic SLO ([SRE availability table](https://sre.google/sre-book/availability-table/)). Track four SLIs:

- availability, through an external probe of the app shell plus a Firestore-reading health page;
- the callable success rate, from Cloud Logging;
- latency, for example 95% of `endorseRequest` calls under 2 s;
- notification-email delivery success.

Low traffic makes means noisy. Report an incident list (start, detection, resolution, cause) and DORA's **failed-deployment recovery time** and change-failure rate in place of a fragile MTBF ([DORA](https://dora.dev/guides/dora-metrics/history/)). For the PWA, Lighthouse no longer has a PWA category ([Chrome blog](https://developer.chrome.com/blog/update-install-criteria)). Test offline behaviour with scripted Playwright `setOffline` scenarios instead: the shell loads, the OfflineBanner shows, writes queue and then sync, and uploads fail gracefully ([web.dev PWA checklist](https://web.dev/articles/pwa-checklist)).

## Security and privacy are verified against ASVS 5.0 and the NPC circulars

**The security baseline is OWASP ASVS 5.0.0** (30 May 2025, about 350 requirements in 17 chapters), with **OWASP Top 10:2025** as the awareness lens ([OWASP ASVS](https://asvs.owasp.org/); [arc42 ASVS](https://quality.arc42.org/standards/owasp-asvs); [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction)). OWASP's guidance puts most applications at Level 2. Earlier wording explicitly reserved Level 3 for apps holding "sensitive medical data" ([OWASP Developer Guide](https://owasp.org/www-project-developer-guide/draft/security_gap_analysis/guides/asvs)). MAPA's defensible claim is therefore **L2, plus selected L3 requirements in access control, data protection and logging**, with each excluded L3 item listed and justified.

ASVS's own assessment rules shape the report. Nobody can be "ASVS certified". The report must state the scope, the target level, the result for every requirement, and each N/A with a reason. Methods must be repeatable, and "running an automated tool alone isn't sufficient" ([ASVS 5.0 Assessment](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x04-Assessment_and_Certification.md)). Top 10:2025 maps closely onto MAPA's main risks:

| Top 10:2025 category | MAPA risk |
|---|---|
| A01 Broken Access Control | Tenant isolation; agencies reading only patients endorsed to them |
| A02 Security Misconfiguration | Rules and console settings |
| A03 Software Supply Chain Failures (new) | The npm dependency tree and the committed `shared.cjs` bundle |
| A09 Security Logging & Alerting Failures | The audit log and alerting |
| A10 Mishandling of Exceptional Conditions (new) | Functions that fail open |

**MAPA's strongest security evidence is its rules test suite, which should become an isolation matrix.** `@firebase/rules-unit-testing` runs against the emulator and never touches production. `authenticatedContext` simulates each role, and `assertFails` and `assertSucceeds` give reproducible verdicts ([Firebase unit tests](https://firebase.google.com/docs/rules/unit-tests)). Build the matrix like this:

- **Rows:** every role (patient, Staff Admin, Hospital Admin, Agency Coordinator, Agency Admin, Super Admin) signed in at hospital A.
- **Columns:** collections × get, list, create, update and delete, run against hospital B's data and against patients not endorsed to the agency.
- **Expected result:** every off-diagonal cell fails.
- **Query-level cases:** include unfiltered list queries, since a `resource.data` default leaks across tenants.

The 25023 measure here is **access controllability**: the share of tenant collections that have a proven cross-tenant denial test.

Add the following around the matrix:

- Cloud Functions handler tests for the server-side invariants;
- dependency (SCA) scanning, plus SAST with Semgrep or CodeQL, plus secret scanning;
- a ZAP scan of a staging host;
- a manual test guided by WSTG v4.2, the current stable release ([OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/)), focused on authorization, business logic (approval caps, the repeat limit, code claiming) and IDOR on Storage paths;
- a STRIDE threat model over a data-flow diagram.

Score every finding with **CVSS v4.0** Base, Threat and Environmental groups (Low 0.1–3.9, Medium 4.0–6.9, High 7.0–8.9, Critical 9.0–10.0) ([FIRST CVSS v4.0](https://www.first.org/cvss/v4-0/specification-document)), using high confidentiality and integrity requirements for health and ID data. **App Check does not replace authentication** and "doesn't eliminate all abuse" ([Firebase App Check](https://firebase.google.com/docs/app-check)). Two project facts should appear as honest findings: App Check is still in monitor mode, and staff MFA is built but switched off (`MFA_MODE = 'off'`).

**Privacy compliance is a traceable checklist, not a single verdict.** These instruments apply:

| Instrument | What it governs |
|---|---|
| **NPC Circular 2023-06** (effective about March 2024) | Security of personal data; repeals Circular 16-01, applies to government and private sectors, and expects a PIA, a privacy management program, training and secure authentication ([NPC FAQ](https://privacy.gov.ph/wp-content/uploads/2024/12/v12-19-2024_FAQ-NPC-Circular-2023-06_NNJ_JDN.pdf); [Global Compliance News](https://www.globalcompliancenews.com/?p=37984)) |
| **NPC Advisory 2017-03** | PIAs: a PIA for every processing system, done before adoption; risk = likelihood × impact; DPO involvement; annual review; no prescribed format ([Advisory 2017-03](https://legaldex.com/laws/guidelines-on-privacy-impact-assessments)) |
| **NPC Circular 16-03** | Breach notification to the Commission and to data subjects within 72 hours ([NPC Circular 16-03](https://privacy.gov.ph/?p=553)) |
| **NPC Advisory 2026-02** | Filing through the DBNMS ([Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/2026/06/philippines-data-breach-notification-procedure-further-clarified)) |
| **NPC Circular 2022-04** | DPO and system registration where sensitive personal information of 1,000 or more people is processed, which MAPA will meet in deployment ([Circular 2022-04](https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf)) |
| **NPC Circular 2023-04** with **Advisory 2023-01** | Consent, and the ban on deceptive design patterns ([Global Compliance News](https://www.globalcompliancenews.com/2023/11/18/https-insightplus-bakermckenzie-com-bm-data-technology-philippines-national-privacy-commission-issues-comprehensive-guidelines-on-consent_11162023/)) |
| **NPC Advisory 2024-01** | Model clauses as voluntary tools for the cross-border transfer to Singapore-region storage ([NPC Advisory 2024-01](https://privacy.gov.ph/wp-content/uploads/2024/06/Published-NPC-Advisory-No.-2024-01-Contractual-Clauses-for-Cross-Border-Transfers_30May24.pdf)) |
| **DOH-DOST-PhilHealth JAO 2016-0002** | Health-information privacy, applied by analogy rather than as binding ([legaldex](https://legaldex.com/laws/privacy-guidelines-for-the-implementation-of-the-philippine-health-information)) |

The checklist rows should cover governance, lawful basis, the privacy notice, data-subject rights (including `eraseAccount`'s restriction-on-retention), minimisation and retention (selfie purge, document purge, the retention period still awaiting the DPO), security, breach readiness, and sharing and transfers. Each row carries its legal basis, MAPA's implementation, an evidence artifact and a status (Compliant, Partial, Not compliant or N/A). Report the totals per domain (for example "31 of 40 Compliant, 6 Partial"), never "certified". The PIA's **4×4 likelihood × impact register** should cite its provenance honestly: the four impact labels come from the CNIL methodology, not NPC wording, and NIST warns that undefined ordinal scores are arbitrary ([CNIL](https://WWW.CNIL.FR/sites/cnil/files/atoms/files/cnil-pia-1-en-methodology.pdf); [NIST IR 8062](https://nvlpubs.nist.gov/nistpubs/ir/2017/NIST.IR.8062.pdf)). A compromised staff account while MFA is off will score high and should be shown that way. So should a missing 72-hour breach runbook. The single most important legal finding is the PIC/PIP split: is each hospital the controller and the MAPA operator the processor, with agencies becoming separate controllers at endorsement? The DPO and adviser, not the developers, should sign it off.

## Maintainability and the data model need metrics that fit hooks and documents

**The object-oriented CK suite mostly does not transfer to React function components**, and the thesis should say so rather than report zeros. DIT and NOC are meaningless without inheritance, and LCOM has no instance variables. Even for web components, CBO and LCOM "can only be applied inside a web component if it contains multiple classes", and SonarQube dropped LCOM4 over false positives ([Münch & Roosmann, WEBIST 2022](https://www.scitepress.org/Papers/2022/115111/115111.pdf)). No study applying CK to React function components was found. A 2025 mapping study of 142 JavaScript quality papers lists 48 JavaScript-specific metrics and notes weak tool support ([Zozas et al.](https://sites.uom.gr/a.ampatzoglou/public_html/papers/zozas2026jsme.pdf)). The usable substitutes are:

| Metric | Tool | Rating level |
|---|---|---|
| Cyclomatic complexity per function | ESLint `complexity` ([ESLint](https://eslint.org/docs/latest/rules/complexity)) | Default max 20; note that every `?.` and `\|\|` counts |
| **Cognitive complexity** | Sonar ([whitepaper](https://www.sonarsource.com/docs/CognitiveComplexity.pdf)) | Team-set per function; 15 is widely cited but was not verified in this research |
| Maintainability Index | Visual Studio formula ([Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index-range-and-meaning)) | Green ≥ 20, yellow 10–19, red 0–9 |
| Duplication | jscpd ([jscpd](https://github.com/kucherenko/jscpd)) or Sonar | ≤ 3% on new code |
| Coupling and cycles (stand-in for CBO and module fan-in/fan-out) | madge ([madge](https://github.com/pahen/madge)) or dependency-cruiser ([dependency-cruiser](https://github.com/sverweij/dependency-cruiser)) | Zero circular imports |
| Maintainability rating (SQALE) | SonarQube ([Sonar metrics](https://docs.sonarsource.com/sonarqube-server/latest/user-guide/code-metrics/metrics-definition/)) | A (technical-debt ratio ≤ 5%) |
| Coverage | Vitest | Sonar-way gate ≥ 80% on new code ([Sonar gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates)) |

Cognitive complexity was designed partly because cyclomatic complexity mishandles try/catch and lambdas. It has a JavaScript rule for purely declarative outer functions, which matters for components and hooks that wrap closures, and it aggregates meaningfully to file level. Large staff pages are the likely hotspots. The heavily imported `src/shared/` modules are a natural "high fan-in, must be stable" check.

**For Firestore, no ISO-style schema checklist exists**, so the evaluation is a synthesis of vendor criteria, and the thesis should say that. Relational normalisation is inverted: document stores accept controlled redundancy because they cannot join on the server ([MongoDB data modeling](https://www.mongodb.com/docs/manual/data-modeling/); [Firestore data structure](https://firebase.google.com/docs/firestore/manage-data/structure-data)). So the evaluation question becomes **"is every redundancy intentional, single-writer and tested?"** rather than "is it normalised?". Measurable items, each grounded in Firestore's documented limits and practices ([Firestore quotas](https://firebase.google.com/docs/firestore/quotas); [best practices](https://firebase.google.com/docs/firestore/best-practices)):

1. **Access-pattern fit.** What share of screens are served by one indexed query with no unbounded client joins.
2. **Single-writer projections.** What share of derived fields (`agenciesPublic`, `hospitalsPublic`, `attachedDocuments`, the financial totals, `networkStats`) have exactly one server writer and a rules test refusing browser writes.
3. **Atomic invariants.** Whether budget, slot and code-to-one-request invariants are updated in single transactions.
4. **Bounded documents.** Growing arrays (`tenantIds`, `agencyIds`, `amendments[]`) and base64 certificate scans checked against the **1 MiB document** and **40,000 index-entry** limits.
5. **Index headroom.** The composite-index count against the 200 (no billing) or 1,000 (billing) cap, plus exemptions for timestamps, since an indexed sequential field caps a collection at 500 writes/s.
6. **Hot spots.** Counters and agency documents assessed against the per-document write guidance.
7. **Rules headroom.** Complex rules checked against the limit of 10 or 20 `get()` calls per request and the 1,000-expression limit.
8. **Lifecycle and erasure.** Subcollections are "hard to delete", which matters for `notifications/{uid}/items` when erasing an account.

## Outcomes and impact belong to HOT-fit, WHO staging and a real baseline

Product quality shows that MAPA works. It does not show that MAPA helps. For impact, **HOT-fit** (Yusof et al. 2008) is the best backbone. It extends the DeLone & McLean dimensions (system, information and service quality, use, satisfaction and net benefits) with explicit Human and Organization factors, and was pilot-tested in health-IS evaluation ([PubMed 17964851](https://pubmed.ncbi.nlm.nih.gov/17964851/); [DeLone & McLean 2003](https://jmis-web.org/articles/271)). MAPA's success hinges on organisational fit: the social-services workflow, agency partnerships and hospital settings.

The **WHO 2016 M&E guide** adds claim discipline. It distinguishes functionality and feasibility evaluation from attributable impact ([WHO](https://www.who.int/publications/i/item/9789241511766)), and its maturity stages run from prototype through pilot to scale-up ([PMC5650671](https://pmc.ncbi.nlm.nih.gov/articles/PMC5650671)). MAPA is at pilot or demonstration stage, so the claims should cover functionality, usability, feasibility and early effectiveness, not population impact.

**RE-AIM** supplies the equity indicators ([CDC PCD](https://cdc.gov/pcd/issues/2018/17_0271.htm)):

- **Reach:** the number, proportion and representativeness of eligible indigent patients who used MAPA.
- **Adoption:** the share of social workers and partner agencies actively using it.
- **Implementation:** fidelity to verify → assess → endorse.

CFIR 2.0 is optional, for coding staff interviews ([Implementation Science](https://implementationscience.biomedcentral.com/articles/10.1186/s13012-022-01245-0)). Stacking all of these frameworks with equal weight invites a framework-sprawl critique.

**The persuasive metrics are cycle time, visits avoided, rework and staff effort, and most come free from MAPA's timestamps.** Philippine agencies frame digitisation in exactly these terms. DSWD targets a one-time assessment and 1–2 days to assess AICS applications on the eGov app, and is piloting digital Guarantee Letters to "lessen the need for clients to physically visit" ([DSWD](https://www.dswd.gov.ph/dswds-soon-to-be-launched-aics-online-system-aims-for-one-time-assessment-sec-gatchalian); [ABS-CBN](https://www.abs-cbn.com/news/nation/2025/5/23/dswd-egov-app-speeds-up-application-process-for-assistance-programs-1604); [Manila Bulletin](https://mb.com.ph/2025/07/03/dswd-to-pilot-digital-issuance-of-guarantee-letters-under-aics-by-q4-2025)). The RA 11463 (Malasakit) M&E indicators already include reduced waiting time and the percentage of indigent patients served ([RA 11463 IRR](https://ldr.senate.gov.ph/sites/default/files/2021-08/RA%2011463%20IRR.pdf)). The ARTA Citizen's Charter convention expresses service time per step ([PhilHealth handbook](https://www.philhealth.gov.ph/arta/articles/handbook/external/HealthFinancePolicySector_ExternalService_PCC2024Volume9_1stEdition.pdf)). India's PM-JAY audits show the value of reporting **the share of cases within a target turnaround**, not only averages ([CAG audit](https://cag.gov.in/uploads/download_audit_report/2023/09_Chapter-V-064d22bab412c53.02505839.pdf)).

| Metric | MAPA source | Paper baseline |
|---|---|---|
| End-to-end and per-stage cycle time (filing → verified → intake complete → endorsed → GL) | Firestore timestamps and the audit log | Logbook dates, or patient recall |
| Completion and abandonment | Request status and case timers | Logbook "never returned" proxy |
| Rework (document Redo cycles) | Document status history | Staff observation |
| Staff minutes per case | Time-and-motion sample of about 20–30 cases | The same on paper cases |
| Visits, fare and work days lost | Short patient survey | Recall of the last paper application |
| Fidelity and data quality (complete intake, verification call when required) | Firestore | n/a |
| Reach and equity (sex, age, municipality, class, representative-assisted) | User and request fields | Hospital social-service census |

Two distinctions stop common errors. First, **timestamps give elapsed time, not effort time**: staff minutes need observation. Second, **Training Hospital data supports only functionality and usability claims, never impact claims**, so `TRAIN` cases must be excluded from outcome metrics. Digitising a step does not automatically shorten the patient's journey. A Saudi time-and-motion study found no significant difference between EHR and paper clinics ([PMC7055816](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7055816/)), so MAPA's claim has to be measured, not assumed.

**The feasible designs are a historical-control comparison and a paired time-and-motion study.**

- **Historical control.** Abstract 30–60 paper cases from the social-service logbook and compare them with MAPA cases. Use the same start and end events, the same assistance types and the same bill ranges. Analyse with **Mann-Whitney U and a Hodges-Lehmann median difference with a 95% CI**.
- **Paired time-and-motion.** The same social workers process matched cases on paper and on MAPA in counterbalanced order. Analyse with **Wilcoxon signed-rank**, effect size r = Z/√N ([rstatix](https://search.r-project.org/CRAN/refmans/rstatix/html/wilcox_effsize.html); [Geyer, UMN](https://www.stat.umn.edu/geyer/5601/examp/signrank.html)).

For proportions, use Fisher's exact test with a risk difference. Durations are right-skewed, so report medians and IQRs. Pre-specify one primary outcome, such as median days from filing to the Guarantee Letter. An interrupted time series is the stronger design, but it needs about 12 points before and 12 after ([Wagner et al. 2002](https://library.alnap.org/system/files/content/resource/files/main/segmented-regression-wagner-2002.pdf)), so for a capstone it is future work. No independent before-and-after evaluation of Philippine hospital financial-assistance digitisation was found, only government claims. That gap is itself a contribution MAPA can claim.

## The Philippine capstone chapter can keep its shape and fix its statistics

CHED's operative standard for BSCS, BSIS and BSIT is still **CMO No. 25 s. 2015** ([CHED](https://legacy.ched.gov.ph/2015-ched-memorandum-orders/)). No CHED document found prescribes ISO 25010 or Likert scales: these are school conventions. The template panels expect has these parts:

- a descriptive or developmental design;
- IT experts and end users as respondents;
- an ISO 25010 questionnaire on a 5-point scale;
- a weighted mean per characteristic, read on 0.80-wide equal-interval bands (4.21–5.00 "Excellent").

The RUI capstone illustrates it ([Grepon et al.](https://arxiv.org/pdf/2307.00323)). It reports eight characteristic means whose simple average is about 4.33, yet states an overall mean of 4.21. That kind of opaque aggregation is something a panel can probe.

Three weaknesses should be fixed rather than copied:

- **Slovin's formula** is Cochran's formula for a *proportion* at 95% confidence with p = 0.5. Applied to a Likert mean, it "assumes an unreasonably small population variance" ([Tejada & Punzalan](https://mail.psai.ph/docs/publications/tps/tps_2012_61_1_9.pdf)), and it does not apply to purposive expert panels or usability tests at all.
- **Single Likert items are ordinal** ([Jamieson 2004](https://medicina.udd.cl/cde/files/2010/07/jamieson_ME_2486.pdf)), though multi-item composites are defensibly treated as interval ([Carifio & Perla](https://course.ccs.neu.edu/is4800/ssl/carifio.pdf); [Norman 2010](https://www.doi.org/10.1007/S10459-010-9222-Y)).
- **Verbal bands are conventions.** A mean of 4.20 and one of 4.21 are not meaningfully different.

The corrected statistics follow from these:

- characteristic scores with mean, SD and a **95% CI**;
- item distributions shown as diverging stacked bars;
- Mann-Whitney or Kruskal-Wallis tests with effect sizes for group comparisons;
- a sample size justified by purpose (problem discovery, precision or power), with n reported per role, never pooled.

Instrument validation is cheap and visible. Use content validity from three or more experts: I-CVI ≥ .78 is good, and S-CVI/Ave ≥ .80; with five or fewer experts, Lynn recommends that I-CVI be 1.00 ([Polit, Beck & Owen 2007](https://pubmed.ncbi.nlm.nih.gov/17654487/)). Add a pilot, Cronbach's α per characteristic with its small-n instability stated, and Filipino translation with back-translation for patient items. MAPA's existing manuscript instrument (`docs/manuscript/MAPA_Evaluation_Instrument.docx`) should be updated to the **2023 characteristics, including Safety**, which signals currency for a health-adjacent system ([arc42](https://quality.arc42.org/articles/iso-25010-update-2023)).

**Ethics clearance comes before any recruitment.** The 2022 PHREB NEGRIHP extends review to all research with human participants, health or not. Undergraduates must work under a supervising adviser, and only the research ethics committee (REC) can grant an exemption ([UPLB REB FAQ](https://reb.uplb.edu.ph/wp-content/uploads/2024/04/2024-04-Research-Ethics-FAQs-and-2022-NEGRIHP.docx.pdf); [2022 NEGRIHP](https://www.pchrd.dost.gov.ph/wp-content/uploads/2023/05/2022-NEGRIHP_Official-Gazatte_Ver-5-1.pdf)). Indigent, ill patients and staff evaluated inside their own workplace raise vulnerability and coercion concerns, so expect at least delegated review. Consent forms should be bilingual at a Grade 6–8 reading level, adapted from Appendix O. RA 10173 has **no blanket research exemption** ([UP Diliman privacy policy](https://privacy.upd.edu.ph/revised-privacy-policy-for-researchers-and-research-subjects)). Evaluation sessions should therefore use the Training Hospital and synthetic data. Logbook abstraction for the baseline needs hospital and DPO approval, and only de-identified data should be collected.

## The master evaluation matrix for MAPA

The table below is the framework in one view. Each row is a 25040 rating module: what is measured, how, with whom, how it is analysed, and the rating level declared in advance.

| Dimension (25010:2023 / other) | What to measure | Instrument / tool | Respondents / source | Analysis | Pre-declared rating level |
|---|---|---|---|---|---|
| Functional suitability | Requirements coverage, pass rate per level, defect density, DDP | RTM, 29119-tailored test cases, Vitest/RTL/rules/functions/Playwright | Test team; UAT signers | Ratios; per-level tables | 100% of must-have requirements covered; no open P1–P3 at UAT exit |
| Faultlessness / testability | Business-logic branch coverage; rules-expression coverage | Vitest v8; emulator `ruleCoverage` | Codebase | Coverage % per module | ≥ 75% on utils/shared/functions |
| Interaction capability | Task success, time, errors, SEQ; SUS or UMUX-Lite; heuristic severity | Task scripts, SEQ, UMUX-Lite (patients), SUS (staff), cognitive walkthrough, heuristic evaluation | ~5 + ~20 patients; 3–5 social workers; 3 agency staff; 3 expert evaluators | Adjusted completion CIs, SUS mean ± 95% CI, mean severity | SUS (equivalent) ≥ 68 per role; no severity-4 issues unfixed |
| Inclusivity / user assistance | WCAG 2.2 AA conformance per page | axe, Lighthouse, manual checklist, TalkBack | Key patient pages | Pass/fail per criterion | 0 AA failures on core patient flows |
| Acceptance (25019 acceptability) | Perceived usefulness, perceived ease of use, intention | TAM items (staff); short Filipino PU/PEOU (patients) | Role users | Descriptives, α, Spearman | Team-declared (e.g. median ≥ 4/5) |
| Performance efficiency | LCP / INP / CLS p75; bundle size; callable p95 | Lighthouse mobile preset, real low-end phone, `web-vitals` real-user monitoring, `npm run budget`, k6 | Key pages; staging project | Medians of runs; p75 field values | Good CWV thresholds; within budget |
| Reliability / capacity | Availability SLI, error budget, incidents, contention correctness | Uptime probe, Cloud Logging, concurrency scripts | Pilot window (4 weeks) | SLO burn, incident timelines | 99.5% monthly; zero double-commits |
| Security / resistance | ASVS 5.0 L2 (+ chosen L3) results; tenant matrix; CVSS findings | Rules tests, functions tests, SAST/SCA/secrets, ZAP, WSTG manual test, STRIDE | Emulator, staging, `TRAIN` tenant | Requirement-by-requirement table; CVSS-BTE | All matrix cells deny; no open High/Critical |
| Privacy / compliance | Obligations met; PIA residual risk | DPA/NPC checklist, 4×4 PIA register | Team + DPO/adviser | Counts per domain; L×I before and after treatment | No "Not compliant" in security or breach domains at go-live |
| Maintainability | Cognitive and cyclomatic complexity, MI, duplication, cycles, SQALE | ESLint, Sonar, jscpd, madge/dependency-cruiser | Codebase | Distributions, hotspots | MI ≥ 20, duplication ≤ 3%, 0 cycles, rating A |
| Data model (25012 lens) | Single-writer projections, transactional invariants, bounds, index headroom, hot spots | Firestore checklist (8 items) | Schema, rules, functions | Checklist ratios | All derived fields single-writer and tested |
| Safety | Gates and caps enforced server-side; overrides audited | Functions tests, audit-log completeness | Codebase, audit log | Ratios | 100% of money/eligibility overrides audited |
| Outcomes / impact | Cycle time, visits avoided, rework, staff minutes, reach | Firestore/audit-log extracts, time-and-motion, patient survey, logbook baseline | Real pilot cases (excluding `TRAIN`) | Mann-Whitney + Hodges-Lehmann CI; Wilcoxon; Fisher | Pre-specified primary outcome; % within a target number of days |

The results chapter should follow 25040's "conclude" step:

1. a rated scorecard per characteristic, showing the objective measure and the user-perceived score side by side;
2. a defect and risk list ranked by severity (CVSS, usability severity, PIA risk);
3. the outcome comparison with effect sizes and CIs;
4. an explicit limitations section, covering the small staff n, norms drawn from Western samples, pilot-stage claims, and requirements still pending (MFA stage 2, App Check enforcement, the DPO retention period).

## Conclusion

The core point is that **objective evidence and perceived evidence should check each other**, not substitute for each other. When a characteristic's Likert mean says "Excellent" but its 25023 ratio, its task-success rate or its ASVS result says otherwise, that disagreement is the finding, and it is the most credible thing a capstone can report. MAPA can produce this cross-check without inventing new infrastructure, because its rules matrix, audit-log timestamps, bundle budget and Training Hospital already map onto access controllability, cycle time, resource utilisation and safe test conditions. That is unusual for a capstone and worth stating as a methodological strength.

Two things change the evaluation from a defence exercise into decision-grade evidence for real deployment. The first is privacy: framing MAPA's privacy position as a PIC/PIP question with a scored PIA (where staff MFA being off is a measurable residual risk rather than a footnote) turns the evaluation into a go-live gate for the hospital's DPO. The second is impact: an honest paper-versus-MAPA baseline, reported as medians with confidence intervals and the share of cases within a target time, would be among the first measured evidence on hospital financial-assistance digitisation in the Philippines, where only targets and claims exist today.
