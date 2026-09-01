# MAPA Reskin & Relayout Plan

The goal, the method, and a **living tracker** for the reskin + relayout of every
page. The point of this file: **check it before touching any page** so we stop
rediscovering the same work. When a page is done, tick it here in the same PR.

Read `docs/design-workflow.md` first — it defines *how* (which skill/MCP does
what). This file defines *what's left* and *when a page counts as done*.

## Goal

Every MAPA page uses its space well and reads as one system:

- **Staff surfaces (admin + agency)** fill the width appropriately for their
  content archetype (below) — no narrow centered columns stranded in empty space.
- **Patient surfaces** stay mobile-first + bilingual + centered — the width
  treatment does **not** apply to them (applying it is a regression).
- No page gets re-touched without a reason recorded here.

## Non-goals

- No logic, data-model, or money-path changes during a reskin/relayout.
- No widening of pages whose archetype wants to stay contained (see below).
- No new dependencies without discussion.

## Method (skills + MCPs)

Per `docs/design-workflow.md`: **ui-ux-pro-max** looks patterns up,
**frontend-design** makes the calls, **dataviz** owns charts/meters,
**Magic Patterns** generates references to mine *only when a page is genuinely
far off* (and it has been flaky — if it stalls past ~10 min, build directly).
Everything ends with the user's visual check (Claude can't see staff renders).

## Archetypes → definition of done

| Archetype | Target layout | Done when |
| --- | --- | --- |
| **Index / table** (lists, logs, queues) | Centered `max-w-[1400px]`; table `w-full`, or a 2-col card grid for rich cards | Fills width, not edge-to-edge on ultrawide |
| **Detail / workspace** (one record + actions) | Full width, two-column: work/content + sticky context or 4-card row | Context/money pinned; content fills the rest |
| **Form** (create/edit) | `max-w-2xl`–`3xl` for a single form; **two-column** when it's really two forms in one | Side-by-side when long; contained when short |
| **Report / dashboard** (KPIs + charts) | `max-w-[1400px]` (dashboards) / `max-w-6xl` (reports); dataviz rules on charts | Grids fill width; charts follow dataviz |
| **Document** (printable) | Paper stays paper-shaped; actions in a sticky rail | Print output unchanged; rail carries actions |
| **Reading content** (guides) | Contained `max-w-3xl` — deliberately narrow for reading measure | Left as-is |
| **Patient** (any) | Mobile-first, bilingual, centered `sm:max-w-3xl…6xl` | Left as-is unless a specific complaint |

## Tracker

Legend: ✅ done · ⬜ to-do · ➖ correct as-is (with reason). "PR" is where it landed.

### Admin — ✅ complete
Dashboard ✅(#87/#90/#92) · Analytics ✅(#88/#89/#92) · Requests + detail workspace
✅(queue + #99/#101) · Agencies list ✅(#116) · Agency detail ✅(#111) · Add Agency
✅(#117) · Patients **facet sidebar** ✅(#129, sidebar + status list, kept table + slide-over) · Reports **redesigned** ✅(#127, facet sidebar + day-grouped card stream) ·
Accounts **redesigned** ✅(#126, facet sidebar + role-grouped roster + governance
readout) · Application Logs **redesigned** ✅(#125, facet sidebar + day-grouped
stream) · Document Types ✅(#113) · Assistance Types ✅(#113) · App Logs
✅ · Audit Log ✅ + actor filter (#110) + coverage fix (#108) · Access Codes
**redesigned** ✅(#128, facet sidebar + status-grouped stream) ·
Announcements split ✅(#115) · ⌘K command palette ✅(#109/#112) · Audit Log
**redesigned** ✅(#124) — facet sidebar + day-grouped stream (research: the
super-admin redesign artifact).
➖ Export (short form) · Export Preview (full-bleed preview) · Messages (chat).

### Agency — partly done
✅ Application detail (#105) · Inbox (#106) · Dashboard (#106) · Funds (#106) ·
Impact (#106) · GL Viewer workspace (#102) · Certificate Generator grid (#107) ·
Intake Sheet / Case Assessment (widen + snapshot, #99).

**⬜ Remaining — the active queue:**
- ✅ **Audit Log** (#119) — widened to `max-w-[1400px]` (entry list fills the card).
- ✅ **Application Logs** (#119) — centered to `max-w-[1400px]`.
- ✅ **Team** (#120) — widened to `max-w-[1400px]`; member list → 2-column card grid.
- ✅ **Agency Profile / Program** (#121) — 2-column: editable cards left, live patient-view preview pinned right (dropped the toggle).
- ✅ **Promotions / Announcements** (#122) — split layout (embedded compose form left, promotions feed right), same as admin #115.
- ✅ **Budget Allocation** (#123) — inspected: form + history → 2-column split (controls left, allocation history right).
- ✅ **Slot Management** (#123) — inspected: settings + history → 2-column split (controls left, adjustment history right).
- ➖ **User Guide** (`max-w-3xl`) — reading content, stays contained.

**Agency queue is clear — the reskin + relayout goal is met.** Any future page
change gets a row here first.

### Patient — ➖ correct as-is (do not widen)
Dashboard, Track Status, Request/Intake wizard, Medical Programs, Interviews,
More, Access Log, Guide — all mobile-first + bilingual + centered per
`[[feedback_patient_layout]]`. Touch only on a specific, stated complaint, and
then it's **craft, not width**.

## Execution order for the remaining ⬜

One PR per page (or per tight pair), each gated through CI, each ticked here in
the same PR. No batching unrelated pages.

1. Agency **Audit Log** + **Application Logs** (both log tables → width). Pair OK.
2. Agency **Team** (list → width / grid).
3. Agency **Agency Profile** (2-column).
4. Agency **Promotions** (split layout, reuse embedded form).
5. Agency **Budget Allocation** + **Slot Management** — inspect first; only change
   what the archetype calls for. Record the decision here even if "left as-is".

When this list is all ✅/➖, the reskin+relayout goal is met — and this file is
the proof so we don't start over.
