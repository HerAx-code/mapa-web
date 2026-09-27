# 02 — External benchmarks: how other systems solve MAPA's parts

*How production systems solve each problem MAPA has to solve. Chosen for relevance to
MAPA's real constraints: a government transactional service, an indigent/low-literacy
mobile audience, a queue-driven human assessment, and a selfie+ID verification step.
Each section ends with the direct implication for MAPA. Sources at the bottom.*

---

## A. "Where's my application?" — status tracking & keeping people informed

**What the field does.** The UK's Government Digital Service treats **status tracking +
notifications** as a core "Government as a Platform" building block: tell people you've
*received* the application, when a *decision* is made, and *what happens next / when*.
The evidence is concrete — DWP's Carer's Allowance team **cut avoidable phone calls by
~40%** just by emailing "we've received your application." GOV.UK **confirmation pages**
always carry a reference number, clear next steps, contact info, and a way to save the
record. (Sources: GDS "where's my stuff", GOV.UK confirmation pattern.)

**Progress-tracker UX consensus.** A progress tracker shows *completed / current / ahead*
in a **user-driven** process; keep it to **3–7 steps** (past ~6, completion drops and
cognitive load rises); use **one** consistent model; **vertical** steppers suit longer
journeys with room for labels; let users review/expand without anxiety. A *tracker*
(guides action) is not the same as an *indicator* (system loading). (Sources: UXPin,
Eleken, PatternFly, Mobbin.)

> **Implication for MAPA.** The system already keeps people informed well (in-app +
> email + status banners). The gap is **coherence**: MAPA shows the patient 4–5
> different progress models. Consolidate to **one** canonical journey (the 6-stage
> request lifecycle), rendered at three fidelities (glance / summary / detail) from a
> **single source**, and make "received / decided / next + when" explicit at each stage.

---

## B. One-thing-per-page, task lists & linear journeys (government transactional design)

**What GOV.UK does.** For a *service* (a transaction), the guidance is: start from the
**outcome**, keep the journey **linear**, ask **one focused thing per page**, **preserve
entered work**, provide explicit **review/correction**, and make **completion + next
steps unambiguous**. **Step-by-step navigation** is for cross-content journeys; inside a
service you use the **task-list** pattern — and *only* after simplifying the service (a
task list is not a substitute for simplification). (Sources: GOV.UK step-by-step; "one
thing per page"; task-list pattern.)

> **Implication for MAPA.** The 4-step Request wizard already embodies one-thing-per-page
> and preserves work. The **Intake Sheet** (family/income/expenses/medical) is the
> natural home for a **task-list** pattern — a set of sections the patient completes in
> any order, each showing *Completed / In progress / Not started*, resumable across
> sessions on a weak connection. The active-request "home" (RequestAssistance active
> view) is effectively a task list already; make it one explicitly.

---

## C. Indigent / low-literacy / low-bandwidth mobile users

**What the research says.** Text-heavy interfaces are *unusable* for first-time
low-literacy users and error-prone for literate novices. Proven mitigations:
**minimize text**, lean on **icons + familiar imagery**, offer **local-language audio**
where possible, and prefer **linear over hierarchical** navigation (low-literacy users
make fewer errors and recover faster on linear flows). In low-infrastructure contexts,
**SMS** is often the most reliable channel. (Sources: Medhi et al., Microsoft Research /
ACM ToCHI; ACM "Actionable UI guidelines for low-literate users".)

> **Implication for MAPA.** MAPA already does much of this: bilingual FIL/EN, mobile-first,
> ≥44px targets, a PWA shell + offline banner, SMS via Semaphore for high-value alerts.
> The additions that pay off most for this audience: (1) reduce **text density** on the
> patient hero/steppers — lead with an icon + a one-line plain-language status; (2)
> keep the patient journey **strictly linear** (the multiple progress models work
> against this); (3) consider **short audio / iconographic** step explainers in the
> Guide; (4) ensure every image upload path degrades gracefully on 2G/3G (client-side
> compression before the base64 write; a clear "uploading…" state).

---

## D. Case-management / triage queues & SLAs (the staff side)

**What the field does.** Mature case systems (Salesforce, Zendesk, ServiceNow-style)
build queues on a **routing hierarchy** (segment/entitlement → priority → category →
channel → region/language) with a **fallback to triage** for missing data; **SLAs must
be measurable and tied to automation** (escalation, reminders); dashboards surface
**open vs overdue** counts and bring **aging** cases to the top. A social-work workspace
pattern shown in the field: a **board with stages** (Intake → Matching → Referred →
Touring → Placed) where **card color = urgency** so critical cases are obvious at a
glance. (Sources: FastSlowMotion Salesforce best practices; Supportbench queue strategy;
Torq/SlideTeam dashboards; FindABed social-worker workspace.)

> **Implication for MAPA.** Both staff queues are already good but **diverge**. Adopt a
> **shared queue spine**: one aging/SLA vocabulary (CRMC's 48h SLA and the agency's
> "days waiting" are the same idea), overdue-first triage sort, and a consistent
> row/urgency treatment. The CRMC verify→assess→endorse **stage rail** is exactly the
> "board with stages" pattern — consider a **board/kanban view** of the CRMC queue by
> stage as an option alongside the table, with urgency color. Keep assignment
> lightweight (MAPA has an `assignee` field already; make claiming a case a first-class
> action).

---

## E. Selfie + ID verification (KYC vendors: Onfido, Persona, Stripe Identity, Veriff)

**What vendors do on capture.** The bar for the *capture* step is: a
**conversion-optimized** flow, **automatic frame scoring** to pick the most readable
image, **on-device quality pre-checks** (glare/blur/crop/document-detected) *before*
escalating to heavier review, active **or** passive **liveness**, and clear retry
guidance. The explicit design principle: **pre-screen quality + extracted fields +
biometric-match signals on-device, escalate only high-risk cases to human review** —
reduce friction while keeping control. (Sources: Stripe Identity; Onfido; Persona;
Veriff comparisons.)

> **Implication for MAPA.** MAPA's posture is deliberately *advisory, on-device,
> human-confirmed* (RA-10173, indigent phone users, no biometric engine) — and that is
> the **right** call; do not adopt automated adverse decisions. But the *capture
> assistance* vendors use is exactly what helps a shaky-handed, low-end-phone patient
> get a usable image on the first try: (1) an **auto-capture / "hold steady"** cue and
> **glare/blur pre-check** on the **ID** photo (MAPA has the oval guide + liveness on the
> selfie, and a "not an ID" nudge, but no capture-quality assist on the ID itself);
> (2) a **retake-with-reason** hint ("too blurry — try again in better light"); (3) a
> stronger **reviewer console** — `CompareFacesModal` is side-by-side only; add the OCR
> field cross-check, the advisory scores, and a one-click verify/reject with reason in
> the same view, so the social worker decides fast without hunting.

---

## F. Multi-funder / co-funding coordination

There is no widely-documented consumer pattern for "one intake, many funders co-funding
one bill to zero balance" — MAPA's model is genuinely novel, closest in spirit to
**grant-stacking / braided funding** in the nonprofit world and to **split-tender**
checkout. The transferable principles: make the **running total against the goal**
unmissable to every funder (MAPA's `ApproveModal` co-funding total does this well);
prevent **over-commitment** with a visible cap and a soft warning (done); and give each
funder the **context of siblings** without letting them re-do each other's work (the
sibling-slice coverage view does this).

> **Implication for MAPA.** This is a **strength** — keep and surface it more. The one
> gap is the **patient's** mental model of "many agencies, one bill": the per-slice
> cards + coverage bar are good, but a single **"who's covering what toward ₱X"** visual
> (a stacked bar to zero balance, mirroring the CRMC `PathToZeroBalance`) on the patient
> status page would make co-funding legible to a low-literacy user at a glance.

---

## Sources

- GDS — "GOV.UK, where's my stuff?" <https://gds.blog.gov.uk/2015/08/26/gov-uk-wheres-my-stuff/>
- GOV.UK Design System — Confirmation pages <https://design-system.service.gov.uk/patterns/confirmation-pages/>
- GOV.UK Design System — Step by step navigation <https://design-system.service.gov.uk/patterns/step-by-step-navigation>
- GOV.UK — "One thing per page" <https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/>
- UXPin — Progress tracker design best practices <https://www.uxpin.com/studio/blog/design-progress-trackers/>
- Eleken — Progress indicator UX <https://www.eleken.co/blog-posts/progress-indicator-ux>
- PatternFly — Progress stepper design guidelines <https://www.patternfly.org/components/progress-stepper/design-guidelines/>
- Medhi et al. — Designing Mobile Interfaces for Novice and Low-Literacy Users (Microsoft Research / ACM ToCHI) <https://www.microsoft.com/en-us/research/publication/designing-mobile-interfaces-for-novice-and-low-literacy-users/>
- ACM — Actionable UI Design Guidelines for Smartphone Apps Inclusive of Low-Literate Users <https://dl.acm.org/doi/10.1145/3449210>
- FastSlowMotion — Salesforce case management best practices (queues/routing/SLAs) <https://www.fastslowmotion.com/salesforce-case-management-best-practices/>
- Supportbench — Support queue strategy (triage/routing/ownership) <https://www.supportbench.com/support-queue-strategy-triage-routing-ownership/>
- Stripe Identity <https://www.stripe.com/identity>
- Onfido / Persona / Veriff / Stripe Identity comparisons <https://kanopylabs.com/blog/stripe-identity-vs-onfido-vs-veriff>
- Healthcare patient-portal UX (accessibility, reduce friction) <https://ux.healthcare/designing-patient-portals/> · <https://know-the-ada.com/how-to-make-patient-portals-more-accessible/>
