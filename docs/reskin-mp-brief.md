# Magic Patterns brief — admin request-processing reskin

*The first MP export (`Downloads/admin request page`) covered the **queue** well
but mismatched MAPA's model (generic statuses, no interview, no co-funding
slices) and left the **deep processing surfaces** undesigned. This brief gives MP
the real MAPA model so the next exports fit. Paste the **Shared context** block
into every prompt, then the per-screen brief. When each export lands in
`Downloads/<name>/`, I run a keep/adapt/reject pass before building.*

> Tokens are **my** job, not MP's — design in whatever palette; I remap to MAPA
> (`#0F6E56` brand, Inter, `.card`/`.badge`/`.stat-tile`/`.filter-pill`),
> swap lucide → `react-icons/md`, and port TSX → JSX. Don't worry about matching
> our exact colors.

---

## Shared context (paste into EVERY prompt)

> This is MAPA, the medical financial-assistance portal for CRMC Malasakit
> Center (Cotabato City, Philippines). Government-adjacent tone: civic,
> professional, trustworthy — not flashy. Amounts in Philippine pesos (₱).
>
> **The model — CRMC is the single gateway; agencies only fund.** A patient
> submits ONE **request** (a hospital bill + amount needed). CRMC verifies it,
> then **endorses** it to one or more agencies as child **application "slices"**
> toward a zero balance (co-funding). Agencies do NOT re-review documents or
> re-interview — they only approve their slice and issue a Guarantee Letter.
>
> **CRMC processing is a 4-stage workflow:** ① Verify documents → ② Assess
> (Unified Intake Sheet + PhilHealth-first coverage) → ③ Interview (one online
> Google Meet, CRMC-conducted) → ④ Endorse (split the balance to agencies).
>
> **Request lifecycle:** submitted → under_review → assessment → endorsed →
> partially_funded → fully_funded (or closed / rejected).
> **Slice lifecycle:** endorsed → reviewing ("For Funding") → approved (GL
> issued) — or needs_info / rejected.
>
> **Constraints:** no SMS (email + in-app only); online interviews are Google
> Meet links (no embedded video); no real money movement (MAPA records
> commitments — approved amounts, budgets, Guarantee Letter status — settlement
> happens off-system). Staff screens are English-only and desktop-first.

---

## Screens to generate (one export each)

### 1. Case assessment — the Unified Intake Sheet
A structured social-worker assessment form CRMC fills during stage ②, saved
progressively (partial saves allowed). Group into sections:
- **Family composition** — editable table: name, relationship, age, occupation,
  monthly contribution; + household size.
- **Income & employment** — monthly household income (₱), employment type
  (employed / self-employed / unemployed / retired / other), employer, length,
  income source.
- **Monthly expenses** — food, utilities, rent, education, medicine, other (₱).
- **Medical** — diagnosis, attending physician, hospital case number (IHOMIS
  ref), date of admission, estimated total cost (₱).
- **Social worker assessment** — case-study narrative, **recommendation**,
  **means-test category** (indigent / marginalized / low_income /
  above_threshold).
- A **completeness meter**: 6 required fields (household size, monthly income,
  diagnosis, recommendation, means-test category, completed-by). Sheet is
  "Complete" only when all 6 are set — this unlocks the next stage.
Design for long forms: section nav, sticky save bar, "Complete / Incomplete"
status. It opens from the request detail (a panel or full sub-page).

### 2. Coverage — PhilHealth-first calculator
A small calculator inside stage ②. **Order of Charging (JAO 2020-0001):** the
bill is reduced first by **PhilHealth**, then by **other prior aid**, and the
**remaining balance** is what agencies co-fund. Inputs: total bill (₱),
PhilHealth covered (₱), other covered (₱) → computed **remaining to agencies**,
shown prominently. Read-only after endorsement (locked once slices exist).

### 3. Interview — schedule + self-booking + outcome
Stage ③, on the request (one interview, CRMC-conducted via Google Meet).
- A segmented control: **"Schedule myself"** (CRMC types date / time / Meet
  link) vs **"Let patient self-book"** (opens availability; patient picks).
- **Availability manager** (when self-book): publish slots from a weekly preset
  (weekdays, AM/PM windows, slot length, weeks ahead) → a week grid of
  open / booked slots.
- **Record outcome**: completed / no_show + assessment notes.
(Patient-facing booking mockups already exist — this is the CRMC side.)

### 4. Endorse — split the balance to agencies (co-funding)
A modal launched from stage ④. Shows **Needed / Secured / Endorsable headroom**
(₱). Lists candidate agencies with per-agency amount inputs; the sum cannot
exceed the remaining balance. Endorsing creates one slice per selected agency
(status "endorsed"). Below the action, an **endorsed-agencies list** with each
slice's status and a staleness note ("awaiting patient acceptance · Nd").
Endorse is **blocked** until docs verified + intake complete + interview outcome
recorded — show the exact remaining blockers as chips (not a vague warning).

### 5. Agency reviewing — "For Funding" slice review
The **agency** side (different persona from CRMC). An agency officer reviews a
slice endorsed to them — they do NOT re-verify documents or re-interview. Shows:
the CRMC-endorsed cap, patient + case summary (read-only), the intake sheet
(read-only), and the funding decision: **Approve** (capture approved amount,
purpose of assistance, payable-to → issues a **Guarantee Letter**),
**Request more info** (needs_info), or **Reject**. Plus a GL viewer / status and
a budget-remaining indicator for the agency's fund.

---

## Optional new concepts MP's first export introduced (decide before adopting)
These aren't in MAPA's data model yet — each is a schema decision, not free
styling. Tell MP to include or omit:
- **SLA** (e.g. 48-hour due / overdue banner) — needs an `slaDueAt` field.
- **Priority** (`urgent`) — no priority field today.
- **Officer assignment** ("Assign to me", assignee column) — requests aren't
  assigned to a named officer today.

---

## Mechanics
- Drop each export in its own `Downloads/<clear-name>/` (like `admin request page`).
- Name them so the surface is obvious (`intake sheet`, `endorse modal`,
  `agency funding review`, …).
- I run **keep / adapt / reject** on each against this model + MAPA's design
  system, flag anything that fights the model, then build additively — money-path
  untouched.
