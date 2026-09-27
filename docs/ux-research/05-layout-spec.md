# 05 — Layout spec (wireframes, grids, responsive behavior)

*The spatial companion to [04-build-spec.md](04-build-spec.md). Where every element
sits, the grid it sits in, its stack order on a phone, and its behavior at each
breakpoint — for the screens Phase 0–3 change. Grounded in MAPA's existing layout
system (verified in the code), so nothing here fights the current shell.*

ASCII wireframes are schematic, not pixel-accurate. `▓` = filled/emphasis,
`░` = muted, `[ ]` = interactive.

---

## A. The layout system as-built (don't fight it)

**Breakpoints (Tailwind defaults, as used):** phone `<640` (base) · `sm ≥640` (tablet) ·
`lg ≥1024` (desktop). MAPA is **mobile-first**: base styles are the phone; `sm:`/`lg:`
widen. Patient work must be verified at **~400px** first.

**Verified container widths:**
| Surface | Wrapper |
|---|---|
| Patient TrackStatus / Request | `px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl overflow-x-clip` |
| Patient Dashboard | same, but `lg:max-w-6xl` + inner `grid gap-5 lg:grid-cols-12` (main `col-span-8`, aside `col-span-4`) |
| Admin RequestDetail | `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start` (work col + sticky 360px rail) |
| Agency Inbox / admin queues | `w-full p-4 sm:p-6 max-w-[1400px] mx-auto` (full-width tables) |

**Rules that stay:**
- Single side gutter (`px-3` phone / `p-6` desktop); vertical rhythm via `space-y-4`/`gap-5`.
- Patient columns **centered**, capped (`sm:max-w-3xl`); never left-aligned full-bleed
  (see `feedback_patient_layout` memory — left-align was rejected as lopsided).
- Touch targets `min-h-[44px]`; `overflow-x-clip` so nothing pushes the phone sideways.
- Desktop context/detail rails are `lg:sticky lg:top-[68px]` (below the 56px top bar).
- Cards: `.card` (rounded, bordered); heroes: `.card-hero` (dark teal).

**Stacking principle (mobile→desktop):** on the phone everything is **one column** in a
deliberate reading order (glance → status → action → detail → aside). On `lg` the aside
peels off to the right; the main column keeps its order. Define order once with grid
`order-*` where main/aside must swap between mobile and desktop.

---

## B. Patient Dashboard — layout

**Desktop (`lg`, `max-w-6xl`, 12-col):**
```
┌───────────────────────────────────────── max-w-6xl ─────────────────────────────────────────┐
│  Greeting line + one-line status                              (full width, col-span-12)        │
│  [ What's new feed card ]  (renders only if announcements)    (full width)                     │
│                                                                                                 │
│  ┌───────────── main · col-span-8 ─────────────┐   ┌──────── aside · col-span-4 ────────┐      │
│  │  ▓ PATIENT HERO (one component, §D.3)        │   │  Coverage / path-to-zero (funding) │      │
│  │    pre-funding → pine stage card             │   │  ┌────────────────────────────┐    │      │
│  │    funding     → money card + CoverageBar    │   │  │ CoverageBar (per-agency)   │    │      │
│  │    terminal    → outcome card                │   │  └────────────────────────────┘    │      │
│  │  ─────────────────────────────────────────  │   │                                    │      │
│  │  JourneyStrip  ● ● ● ○ ○ ○   (glance)        │   │  Documents (verified/pending)      │      │
│  │  ─────────────────────────────────────────  │   │  ┌────────────────────────────┐    │      │
│  │  [ Next-action card ] (only if patient-owed) │   │  │ ▢ Valid ID      ✓ verified │    │      │
│  │                                              │   │  │ ▢ Billing       ⧗ pending  │    │      │
│  │  (onboarding "how MAPA works" — ONLY when    │   │  └────────────────────────────┘    │      │
│  │   no request yet; else absent)               │   │  Messages preview (last 3)         │      │
│  └──────────────────────────────────────────────┘   └────────────────────────────────────┘      │
│  [ Install prompt ]  (self-managed visibility, full width, bottom)                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phone (base, single column, reading order):**
```
Greeting + one-line status
[ What's new ]  (if any)
▓ PATIENT HERO
JourneyStrip  ● ● ● ○ ○ ○
[ Next-action ]  (if patient-owed)
CoverageBar      (funding stage only)
Documents card   (only pre-approval)
Messages preview
[ Install prompt ]
```

**Layout changes vs today (Phase 1.2):**
- The **six hero branches collapse into one** `PatientHero` block — same slot, one card,
  no layout shift between states (all states occupy the hero position).
- **Delete `TimelineCard`** from the main column (its role is now covered by JourneyStrip
  glance + the detail stepper on TrackStatus). This *removes* a card, shortening the page.
- **"Application Steps" guide** leaves the main column; a short static "how MAPA works"
  appears **only when `!request`** (first-run onboarding), so a returning patient's
  dashboard is shorter and action-first.
- `CoverageBar` (new) sits in the **aside** on desktop, and **inline after the hero** on
  phone (funding stage only), because money legibility matters most where the balance is.

---

## C. Patient TrackStatus ("My Application") — layout

Single centered column (`sm:max-w-3xl`). Order = glance → money → detail → coverage → per-agency.
```
Eyebrow + "My Application" title + subtitle
[ In Progress (n) ] [ Past (n) ]         ← tabs (wrap on narrow)

── ACTIVE REQUEST (tab: In Progress) ──────────────────────────
┌ card ─────────────────────────────────────────────┐
│ JourneyStrip  ● ● ● ○ ○ ○            (glance)       │
└────────────────────────────────────────────────────┘
▓ PATIENT HERO / BalanceHero  (money-forward when funding)
┌ card ─────────────────────────────────────────────┐
│ CoverageBar — ₱X of ₱Y covered by N agencies       │
└────────────────────────────────────────────────────┘
┌ card ── JourneyStepper (DETAIL, vertical) ─────────┐
│ ✓ Submitted          — received; docs next          │
│ ✓ Under review       — CRMC checking documents      │
│ ◉ Assessment  [now]  — social worker may message    │
│ ○ Endorsed           — [Review coverage plan →]     │
│ ○ Funding            — agencies approving            │
│ ○ Complete           — fully covered                │
└────────────────────────────────────────────────────┘
┌ "Your agencies" (the per-slice coverage detail) ───┐
│ ▢ PCSO      ₱5,000   For funding                    │
│ ▢ DSWD      ₱3,000   Approved · GL ready [Download] │
└────────────────────────────────────────────────────┘
```
- The **detail vertical stepper** (`JourneyStepper`) replaces the current 6-stage request
  stepper, reading the same shared `utils/journey.js`. Each row: dot + label + one-line
  `now`/`next` note; the `endorsed` row carries the **Proceed** CTA.
- The per-slice cards are reframed under a **"Your agencies"** heading = the *coverage
  detail inside the funding stage*, not a competing journey. The 4-row slice sub-stepper
  stays inside each card (collapsed by default; "see all" expands — as today).
- **Past tab:** unchanged list layout (agency row + status + GL download / rejection reason).

---

## D. Patient active-request home (RequestAssistance active view) → task list (Phase 2.2)

Single column. A GOV.UK-style **task list**: one clear next action on top, then rows with
a state pill. Replaces the current mixed stack of intake/coverage/docs cards.
```
▓ BalanceHero (or stage hero)
┌ "What to do next" (only the single top action) ───┐
│  → Complete your Household Information Sheet        │
└────────────────────────────────────────────────────┘
┌ card — task list ─────────────────────────────────┐
│ 1  Household Information Sheet     [ In progress ] >│
│ 2  Required documents             [ Completed ]    │
│ 3  Review coverage plan           [ Action needed ]>│
│ 4  Confirm & proceed              [ Not started ]   │
└────────────────────────────────────────────────────┘
```
- Each row `min-h-[44px]`, whole-row tap target, right-aligned state pill using existing
  `.badge-*` (green=completed, amber=in progress, red/orange=action needed, gray=not started).
- Row states derived from existing data (intake complete? docs verified? slices present?
  proceed pending?) — no data-model change.

---

## E. Wireframe of the new components' internals

**PatientHero — pre-funding (pine `.card-hero` look):**
```
┌ card-hero (brand-600) ────────────────────────────┐
│ STEP 2 OF 6                                        │  ← eyebrow, brand-100
│ Assessment                          (font-display) │  ← current stage label
│ A social worker is assessing your case.            │  ← one-line `now`
│ ▓▓▓▓▓░░░░░░  (progress 33%)                         │
│ [  See my request            → ]  (white btn, 48px)│  ← single CTA (nextAction wins)
└────────────────────────────────────────────────────┘
```
**PatientHero — funding (money look) + CoverageBar underneath:**
```
┌ card-hero ─────────────────────────────────────────┐
│ REMAINING BALANCE            [ Endorsed ]  REQ-…-1  │
│ ₱12,000                                             │  ← 4xl/5xl tabular-nums
│ of ₱20,000 · ₱8,000 approved                        │
│ ▓▓▓▓▓▓░░░░  approved | in review | unfunded (legend)│
│ [ My Application → ]                                 │
└────────────────────────────────────────────────────┘
CoverageBar:  [PCSO ▓▓▓][DSWD ▓▓][ gap ░░░ ]  ₱8k of ₱20k · 2 agencies
```
**JourneyStrip (glance) — 6 evenly-spaced nodes, connectors between:**
```
 ●───●───◉···○···○···○
 Sub  Rev  Asmt End  Fund Done
```
`●` done (brand-500) · `◉` current (amber ring) · `○` upcoming (gray). Labels `text-[9px]`
so all six fit at 400px without wrapping (existing pattern).

---

## F. Staff queue board (Phase 3.2, optional CRMC view)

Table view stays default (full-width `max-w-[1400px]`). The **board** is an added toggle:
```
[ Table ] [ Board ]                                  Sort: [Overdue first ▾]

┌ Verify ────┐  ┌ Assess ────┐  ┌ Endorse ───┐
│ ▓ Juan  🔴 │  │ ░ Maria 🟡 │  │ ░ Pedro    │   ← card urgency color = aging state
│ ₱25k · 2d  │  │ ₱12k · 1d  │  │ ₱8k        │
│ ▢▢ docs    │  │ intake ⧗   │  │ 2 agencies │
├────────────┤  ├────────────┤  ├────────────┤
│ ▓ Ana   🟡 │  │ ░ Lito     │  │            │
└────────────┘  └────────────┘  └────────────┘
```
- Columns = `deriveRequestStage` stages (verify → assess → endorse). Card border/dot color
  = shared `aging` state (§04 F.3.1). Click a card → the existing RequestDetail workspace
  (unchanged). Read-only reorganization; no rules/data change.
- Responsive: below `lg`, board columns scroll horizontally in their own container
  (`overflow-x-auto`), or fall back to the table (default) — never wrap the page.

---

## G. Spacing, order & sticky rules (apply everywhere)
- **Vertical rhythm:** cards separated by `space-y-4` (phone) / `gap-5` (grids). Inside a
  card, `space-y-3`/`space-y-4`. Don't stack per-element margins (avoids collapse drift).
- **Stack order** is authored mobile-first; use `order-1/order-2` + `lg:order-*` only
  where main/aside must swap (as admin RequestDetail already does: rail `order-1` mobile,
  `lg:order-2` desktop). Patient Dashboard main stays `order-1`; aside `order-2` naturally.
- **Sticky:** desktop rails `lg:sticky lg:top-[68px]`; sub-headers `sticky top-0 bg-white z-30`
  (matches admin RequestDetail). Never sticky on phone (eats viewport).
- **No new max-widths** — reuse `sm:max-w-3xl` (patient reading) / `lg:max-w-6xl`
  (patient dashboard 2-col) / `max-w-[1400px]` (staff tables). Widening patient columns is
  out of scope and was previously rejected.

---

## H. What this does *not* redesign (deliberately)
The shell (top bar, sidebar, bottom tabs), the admin RequestDetail two-column workspace,
the agency ApplicationDetail, and all secondary pages keep their current layout. This spec
only lays out the **new/changed** surfaces (patient Dashboard hero region, TrackStatus
active view, the active-request task list, the new components, and the optional queue
board). Everything else inherits the existing, working layout.

---

## I. How to validate layout (per phase)
For every patient PR: capture screenshots at **400px**, **768px**, **1280px** on the
Vercel preview; confirm no horizontal scroll, all tap targets ≥44px, the reading order
matches §B/§C, and both FIL/EN render (Filipino labels are longer — check the JourneyStrip
6-label row and the tabs don't overflow). A visual mockup (Magic Patterns / an HTML
artifact) can be produced from these wireframes before coding if a stakeholder wants to
see it first — see `docs/design-workflow.md`.
