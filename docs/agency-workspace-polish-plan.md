# Agency Workspace — Professional Polish Plan

**Status:** proposed (plan only). **Date:** 2026-10-22.
**Scope:** the 18 agency staff surfaces (`src/pages/agency/**`). Presentational +
interaction craft only — **no money-path, data-model, or logic changes**.

> This is the **layer above** the reskin. The design-system reskin + relayout and a
> consistency pass are already **shipped** (`docs/agency-reskin-plan.md`,
> `docs/reskin-relayout-plan.md` — "agency queue is clear, the reskin goal is met").
> So the pages are *correctly laid out and on-brand*. What's missing is the jump from
> "clean thesis build" to **"professional operator tool you run all day"**: density,
> low-data craft, data-viz quality, triage affordances, and decision-flow focus.

---

## 1. Method

- **First-hand visual review** of the live workspace (DOH-MAIP coordinator session,
  1440×900): Dashboard, Application Inbox, the Approve+GL modal, and Impact.
- **Grounded in the existing research** — `docs/ux-research/02-external-benchmarks.md`
  §D (case-management / triage queues & SLAs) and §A (GOV.UK/USWDS density + reduce
  text) — plus production back-office references (Linear, Stripe, Mercury, Retool) for
  density, data-viz, and empty-state craft, and the design-intelligence DB (bullet
  charts for KPI-vs-target data; bulk actions; empty/loading-state rules).
- **Guardrails from CLAUDE.md:** staff surfaces are English-only, web/desktop-dense;
  tone stays civic-professional, **not flashy**; never touch the approval/GL
  transaction, budget math, slot logic, or the over-commit guard.

## 2. What I saw (findings, by surface)

**Dashboard** — strong dark Budget Hero anchor, but: the capacity bar reads *empty* at
low utilization (1% used → a flat line); below the fold is **sparse** ("No pending
applications" + large dead space); the quick-action tiles are flat (no counts/badges,
e.g. Inbox should show a pending count); stat-tile numbers are under-emphasized for an
at-a-glance surface.

**Application Inbox** — clean queue, but **low information density**: five *oversized*
filter cards (Total/For Funding/Needs Info/Approved/Rejected) eat a third of the screen;
rows are tall; the table floats with vast empty space under two rows. **Missing triage
signal**: no age/"days waiting"/SLA cue and **no amount/coverage column**, so the
operator can't prioritize or size a decision without opening each case. "Open" button
duplicates the row-click affordance.

**Approve + Issue GL modal** (the money decision) — the **one input that matters**
(Approved Amount) sits *below four stacked info cards*; the operator scrolls past
context to reach the action. No quick-fill (e.g. "cover the full ₱25,000"); the
co-funding running total doesn't visibly recompute as they type.

**Impact** — the "disbursed per month" **line chart with a single data point** is a
large near-empty box (looks broken at low volume); stat cards are over-padded; the
by-type bars are good. Low-data states aren't designed for.

> **Cross-cutting:** the workspace is *airy* where a professional operator tool is
> *dense and purposeful*; low-data/empty states are under-built; money figures aren't
> uniformly `tabular-nums`; there's little micro-feedback (hover, skeletons, counts).

## 3. Improvement themes → concrete changes

Ordered by value ÷ (effort × risk). Every item is presentational.

### A. Information density & rhythm — *highest value*
- **Inbox filter cards → a compact segmented filter bar** (pill row with inline counts:
  `All 2 · For Funding 0 · Needs Info 0 · Approved 2 · Rejected 0`). Reclaims the top
  third of the queue for actual rows. (Bench: GOV.UK/USWDS restraint; Linear/Stripe
  filter bars.)
- **Denser table rows** — tighten vertical padding + line-height; whole row clickable;
  demote the per-row "Open" to a hover affordance or keep one, not both.
- **Right-size over-padded stat cards** (Dashboard + Impact) to a tighter scale so more
  reads above the fold.

### B. Triage affordances in the queue — *high value, backs the research*
- **Add an "Age / waiting" cue** (days since submitted, amber→red past the SLA) and
  **overdue-first default sort** when any row is aging — the research's shared
  aging/SLA vocabulary (`utils/aging.js` already exists; reuse it).
- **Add an amount / coverage column** (amount needed, and coverage-so-far) so the
  operator can prioritize and pre-size decisions from the list.
- **Optional bulk select** for queue-wide actions later (design-DB: multi-select beats
  repeated per-row actions). Flag-gated, low priority.

### C. The core decision flow (Approve modal) — *high value, core workflow*
- **Lead with the action:** amount input near the top (or a sticky action footer),
  context cards collapsible/below. The operator's one job is the amount.
- **Quick-fill chips:** "Full balance ₱25,000", "Remaining ₱X" — one tap for the common
  case; still editable.
- **Live running total:** the co-funding bar + "would bring total to ₱Y of ₱Z needed"
  recomputes as they type (the over-commit soft-warning already exists — surface it
  live). *No math change — just bind the existing computed value to the input.*

### D. Data-visualization quality — *medium value, visible craft*
- **Budget capacity → a bullet chart** (value vs allocated target, with the committed
  marker) instead of a bar that looks empty at 1% — the design-DB's recommended form
  for KPI-vs-target. Same for Slots (used vs total).
- **Graceful low-data charts:** when a series has <2 points, render a labeled
  single-value callout or a sparkline-with-note ("One month of data so far"), not a
  giant empty axis. (Impact line chart.)
- Refine chart chrome: axis labels, `tabular-nums`, hover tooltips, consistent money
  formatting. Keep the current charting approach (custom SVG/CSS) — **no new dependency
  without asking.**

### E. Empty & low-data states — *medium value, cheap*
- Purposeful empty states with a one-line explanation + a next action (design-DB: never
  a blank area). Dashboard "No pending applications" → add "You're all caught up — new
  endorsements land here" + a link to Impact/this month. Short queues get a defined
  card min-height so the page doesn't collapse to a sliver of content over dead space.

### F. Micro-interactions & feedback — *medium value*
- **Nav + tile counts/badges** — Inbox shows its pending count in the sidebar and on the
  dashboard tile (operators navigate by "what needs me").
- **Loading skeletons** on the queue, charts, and detail panels (design-DB: match the
  wait, preserve layout) instead of bare spins/blank.
- Consistent hover/active states on rows, tiles, and action buttons; success toasts
  already exist — ensure every money action confirms crisply.

### G. Typographic & numeric refinement — *low effort, broad polish*
- **`tabular-nums` on every peso + count** app-wide in agency surfaces (amounts, slots,
  budgets) so columns align and numbers stop "wiggling".
- One number-emphasis scale (hero > stat-tile > inline) applied consistently; subtle
  `divide-y`/hairline dividers instead of gaps where lists need structure.

## 4. Phased delivery (each = one PR, presentational, verified)

Gate every PR on `npm run build` + `npm run test:all` + a Vercel-preview eyeball at
1280/1440px. No `lint:i18n` scope (agency is English-only).

- **Phase 1 — Inbox triage + density.** Themes A + B on the Inbox: segmented filter bar,
  denser rows, age/SLA cue + overdue sort, amount/coverage column. *Highest daily value.*
- **Phase 2 — Approve modal focus.** Theme C: action-first layout, quick-fill chips,
  live running total. Full smoke test of approve + reversal (money path untouched).
- **Phase 3 — Dashboard polish.** Themes A + E + F on the Dashboard: bullet-style budget
  + slots, tile counts/badges, a useful caught-up empty state, tighter stat scale.
- **Phase 4 — Data-viz pass.** Theme D across Impact + Funds. Shipped the graceful
  **low-data handling** (TrendArea single-month → labeled callout instead of a lone dot
  in an empty axis). On review the existing charts (BarList, TrendArea, BudgetHero/Funds
  bars) already carry `tabular-nums`, accessible labels, and tooltips, so chart-chrome
  work was minimal. **Bullet charts were dropped by decision** — see §6: committed and
  disbursed are distinct buckets that can't share one allocated axis without
  double-counting, so the single-measure bars stay.
- **Phase 5 — System polish.** Themes F + G everywhere: skeletons, `tabular-nums`,
  hover/dividers, nav badges. A broad, low-risk sweep.

## 5. Guardrails & non-goals
- **Never touch** the approval/GL transaction, budget math (`allocated/committed/
  remaining`), slot logic, or the over-commit guard — presentational only.
- **Don't re-litigate** settled decisions (English-only staff, web-dense, no shared
  queue rewrite — rejected in `03-improvement-plan.md` §3.2, no new deps).
- Keep it **civic-professional, not flashy** — denser and more refined, not decorative.

## 6. Verify (not polish — flag to owner)
- Dashboard Budget Hero shows **Disbursed ₱10,000 > Committed ₱5,000** — disbursed
  exceeding committed looks semantically off. Likely demo-data, but confirm the
  committed/disbursed derivation before the data-viz pass (Phase 4) relies on it.
  - **Resolved (Phase 4, 2026-10-25):** this is **not a bug** in the live app. The
    runtime treats `committed` = *issued-but-unredeemed* GLs and `disbursed` =
    *redeemed* GLs — redeeming a GL moves the amount from committed → disbursed
    (`ApplicationDetail.jsx performRedeemGL`), and the Funds page states exactly this.
    So once most GLs are redeemed, Disbursed > Committed is the **correct steady
    state**. The only real inconsistency is that `scripts/demo-data.mjs` seeds
    `committed` as the sum of *all* slices (not just unredeemed), so demo data can
    overstate committed vs the runtime convention — a **demo-seed fix**, money-adjacent
    and out of scope for this presentational track. Because committed/disbursed are
    distinct buckets (not summable against one allocated axis without double-counting),
    Phase 4 keeps the single-measure budget bars as-is and does **not** build a stacked
    "committed + disbursed" bullet chart.
