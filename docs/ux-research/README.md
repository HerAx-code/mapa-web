# MAPA UX/UX Research — index & executive summary

*Compiled 2026-09-27. A deep, end-to-end study of every surface in the MAPA web
portal (patient, agency, admin), how comparable production systems solve the same
problems, and a prioritized plan to improve the experience. Grounded in a
first-hand read of the code — routes, pages, panels, and modals — not a
guess from screenshots.*

## The documents

1. **[01-current-state-inventory.md](01-current-state-inventory.md)** — every route,
   page, panel, and modal for all three user types, what each does, and its notable
   UX mechanics. The "as-built" map.
2. **[02-external-benchmarks.md](02-external-benchmarks.md)** — how GOV.UK, US gov
   (USWDS), healthcare financial-assistance portals, case-management/triage systems,
   and KYC vendors (Onfido/Persona/Stripe Identity) solve each part MAPA has to
   solve, with sources.
3. **[03-improvement-plan.md](03-improvement-plan.md)** — the intricate, phased,
   prioritized plan: what to change, why, the benchmark it draws on, effort, and
   risk. Sequenced so the highest-value / lowest-risk work lands first.
4. **[04-build-spec.md](04-build-spec.md)** — the **solidified, build-ready** version
   of the plan: verified ground truth (data model, component contracts, i18n keys,
   design tokens), exact per-file edits, back-compat rules, tests, a risk register, and
   acceptance criteria. **Read this before implementing** — 03 is the "why", 04 is the
   "exactly how, so it works the first time."
5. **[05-layout-spec.md](05-layout-spec.md)** — the **layout** companion: annotated
   wireframes (phone + desktop), the exact grids/widths/stack-order/sticky rules for
   every new or changed screen, and how to validate layout at 400/768/1280px. Read
   alongside 04 — 04 is the data/logic, 05 is where it all sits on the page.

## Method

- **Code-first inventory.** Read `src/App.jsx` (routes), `src/components/Layout.jsx`
  (shell IA + shared panels), and deep-read the core end-to-end flow: patient submit
  (`RequestAssistance`), patient status (`Dashboard`, `TrackStatus`), CRMC operations
  (`admin/Requests` + `VerifyDocsPanel` + `EndorseModal` + stage model), and the agency
  funding decision (`agency/Inbox`, `ApplicationModals`: Reject / Approve+GL / RequestInfo).
  Opened the verification modals (`SelfieCaptureModal`, and the reviewer's
  `CompareFacesModal` / `DocViewerModal` via their call sites). Inventoried the ~40
  secondary pages by route + heading + purpose.
- **Benchmark against production systems**, chosen for relevance to MAPA's actual
  problems: a government transactional service (status tracking, one-thing-per-page),
  an indigent/low-literacy mobile audience, a queue-driven human assessment, and a
  selfie+ID verification step.
- **Scope guardrails from `CLAUDE.md`:** patient-facing is bilingual + mobile-first;
  staff surfaces are English-only desktop by design; no PhilSys/biometrics engine
  (human-in-the-loop); no custom video; remote/async assessment (no booking). The plan
  respects all of these — it does not propose re-litigating settled decisions.

## The system in one paragraph

A patient (indigent, often on a phone, often low-literacy) submits **one request**
(a bill + the required documents + a live selfie). CRMC is the single gateway: a social
worker **verifies** documents (OCR/face-assisted, human-confirmed), does one **remote
async assessment** (messaging + on-demand Meet, completing the Unified Intake Sheet),
then **endorses** the request to one or more funding **agencies** as child "slices."
The patient **proceeds**, each agency runs its **funding decision** (amount capped by
budget / slice / per-applicant policy) and issues a **Guarantee Letter** the patient
claims off-system. Three roles, one case, many hand-offs.

## Top findings (the through-lines the plan is built on)

1. **The patient has 4–5 competing "where am I" representations.** JourneyStrip,
   the Dashboard `TimelineCard` (5 steps), the Dashboard "Application Steps" guide
   (5 steps, different content), the TrackStatus **request** stepper (6 stages), and a
   separate per-slice 4-stage stepper — plus multiple hero variants
   (`StatusHero` / `BalanceHero` / status card / rejected card / welcome hero /
   compact card). Each was added for a good local reason; together they fragment the
   single most important question the product answers. **This is finding #1 and the
   spine of the plan.** (Benchmark: progress-tracker best practice = *one* model, 3–7
   steps, consistent across surfaces.)

2. **Terminology drifts across the hand-off.** "request" (CRMC) vs "application" /
   "slice" (agency) vs "case" — the same real-world thing wears three names, and the
   patient sees all three. A shared vocabulary (and a shared "case" lens for staff)
   would cut confusion for everyone.

3. **Interview-removal left visible residue.** `TrackStatus` still carries a legacy
   6-stage "…→ Interview → …" path and note; the Dashboard steps guide still checks an
   `'interview'` status as "done"; the shell `ComposeModal` in `Layout.jsx` still
   fetches the full staff directory for a patient recipient picker that reply-only
   messaging made unreachable. Dead paths that should be pruned.

4. **Two messaging systems coexist.** The shell `ComposeModal` (full directory
   fetch, patient branch) and the page-level `admin/messages/*` (AdminComposeModal +
   ConversationThread). Post reply-only-hardening, the shell compose is inconsistent
   with the rules and should be aligned/removed for patients.

5. **The two staff queues don't share a spine.** The CRMC queue (QueueTabs + stage
   rail + 48h SLA + bulk verify) and the agency queue (filter tiles + days-waiting +
   GL-expiry chips + duplicate flag) each solve triage well but differently. A shared
   queue/triage pattern (and consistent SLA/aging language) would reduce operator
   ramp-up and code.

6. **Verification is a strong, honest foundation but a basic reviewer console.**
   On-device OCR + face-match + liveness (advisory, fail-null, human-confirmed) with a
   camera-only selfie and an oval framing guide is the right posture for RA-10173 and
   indigent phone users. The gaps vs KYC vendors are *capture assistance* (no
   auto-capture / frame-scoring / glare-blur pre-check on the ID) and a *thin reviewer
   surface* (side-by-side compare only). Both are improvable without adding biometrics
   or breaking the human-in-the-loop rule.

7. **Micro-inconsistencies add up.** Every page defines its own `peso()` formatter;
   status→label/color logic lives in ≥4 places (`APP_STATUS_CONFIG`, `STATUS_VISUAL`,
   `buildStages`, `JourneyStrip`); "days waiting" vs "SLA hours" are two different aging
   languages. None is a bug; collectively they're drift that a small shared layer fixes.

See **[03-improvement-plan.md](03-improvement-plan.md)** for what to do about each,
sequenced by value and risk.
