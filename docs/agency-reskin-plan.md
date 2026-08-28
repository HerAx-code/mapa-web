# Agency Workspace Reskin — Plan

**Status:** PROPOSED (plan only)
**Date:** 2026-08-28
**Owner:** Capstone Project Group

> Extends the patient-side design-system sweep (PRs #28–#34) to the **agency
> workspaces**. Same principle: adopt the design language, keep the real
> models + logic. The foundation primitives (`.card-hero`, `.stat-tile`,
> `.filter-pill`, `.eyebrow`, stronger `.nav-item`) already shipped in #28,
> so most of this is *applying* them, not building new CSS.

---

## 1. Ground rules (agency ≠ patient)

- **English-only.** Staff surfaces are English by design (CLAUDE.md); the
  `lint:i18n` linter does **not** cover `src/pages/agency/**`. So **no i18n
  keys** — hardcoded strings are correct here. This makes each page faster to
  reskin than a patient page.
- **Web-only / desktop-dense.** Agencies are web-only (multi-pane Inbox, Doc
  Review, AppLogs). Layouts can assume desktop; keep tables/panes, just polish
  them. Don't force a mobile-first single-column rewrite.
- **Never touch the money path.** Presentational only. The approval/GL
  transaction, budget math (`allocated`/`committed`/`remaining`), slot logic,
  and the over-commitment guard stay exactly as they are.
- **Reuse the shell.** The sidebar/topbar (Layout) is shared and already
  reskinned in #28 (active-state pill, section eyebrows). The bottom help card
  is patient-only; optional to add an agency variant later.

## 2. The signature move: an Agency Budget Hero

The agency Dashboard already computes `budget.allocated`, `budget.committed`,
`budget.remaining`, and `slots.total/remaining`. That is the **exact shape of
the patient `BalanceHero`** — a total, a committed portion, a remaining
portion, a segmented bar. So the centrepiece of the agency reskin is a dark
`.card-hero` **"Funding capacity"** panel:

> **Remaining budget ₱X** · of ₱allocated · ₱committed committed
> *(segmented bar: committed / remaining)* · Slots: N of M used today

This gives the agency dashboard the same striking anchor the patient dashboard
got, from data that already exists. (Consider a shared
`components/agency/BudgetHero.jsx`, mirroring `components/patient/BalanceHero.jsx`.)

## 3. Design-system mapping

| Element today | Reskin to |
|---|---|
| `page-title` headers | `.eyebrow` + bold title (every page) |
| Metric cards (`card p-4` + `text-2xl`) | `.stat-tile` / `.stat-num` / `.stat-label`, semantic accent for "attention" (pending / low budget) |
| Budget/slots summary | dark `.card-hero` Budget Hero |
| Inbox status-filter cards | `.stat-tile` (clickable) or a `.filter-pill` row |
| Ad-hoc status chips | shared `<StatusBadge>` (already used in places) |
| Tables | keep; polish header row, row hover, `tabular-nums` on amounts |

## 4. Page-by-page (16 pages, tiered)

### Tier 1 — work surfaces (highest visibility, do first)
- **Dashboard.jsx** (624) — eyebrow header ("{agency} Workspace"); **Budget
  Hero** centrepiece; metric grid → `.stat-tile` (pending = amber, approved =
  brand, GLs, slots); keep the GL-expiry sweep + low-balance logic untouched.
- **Inbox.jsx** (368) — eyebrow header; the status-filter summary cards →
  `.stat-tile` (clickable filters) or a `.filter-pill` row; search polish;
  table header/row polish + `tabular-nums`.
- **ApplicationDetail.jsx** (1715) — **highest-risk file** (the approval + GL
  money path, and the largest file in the repo). Presentational only: a
  **funding-decision hero** (the slice amount + the live over-commit guard as
  a hero band), section **eyebrows**, unify the cards. Do this one **last** in
  Tier 1, in small reviewed edits, with a full smoke test of approve /
  request-info / reject afterwards. Do **not** refactor the transaction.

### Tier 2 — management
- **Allocation.jsx** (701), **Funds.jsx** (456), **SlotManagement.jsx** (414),
  **Team.jsx** (532), **Program.jsx** (465) — eyebrow headers; money/slot
  summaries → `.stat-tile` or a small `.card-hero`; card + table polish. Funds
  and Allocation are budget-heavy → a Budget Hero fits there too.

### Tier 3 — records / light
- **Logs.jsx** (212), **AuditLog.jsx** (335), **Announcements.jsx** (288),
  **GLViewer.jsx** (302), **CertificateGenerator.jsx** (519),
  **IntakeSheet.jsx** (731), **Guide.jsx** (525) — mostly eyebrow headers +
  card/table consistency + `.filter-pill` where there are filters. IntakeSheet
  and CertificateGenerator are longer but structurally simple (forms /
  print) — header + section eyebrows.

## 5. Build order (each its own screenshot-verified PR)

1. **Dashboard** + the shared **BudgetHero** component (the signature; sets the
   tone the rest inherit).
2. **Inbox** (the daily work surface).
3. **Tier 2** management pages (Allocation/Funds/Slots/Team/Program) — can
   batch related ones.
4. **Tier 3** records/light pages — batchable header sweeps.
5. **ApplicationDetail** last — its own careful PR + a full approve/GL smoke
   test (login as agency, approve a slice, confirm GL issues, budget commits).

**Discipline:** build green after each; screenshot-verify (login as
`admin@doh.gov.ph` / `coordinator@doh.gov.ph`); no commit until reviewed.

## 6. Risks

1. **ApplicationDetail (1715 lines, money path).** The one real hazard.
   Presentational edits only; smoke-test the approve/GL/over-commit flow after.
   Verify the running co-funding total (over-commit guard) still renders live.
2. **Budget math display.** The Budget Hero only *reads* `budget.*` — never
   writes. Keep the GL-expiry sweep + low-balance notify logic on Dashboard
   exactly as-is (they run on mount).
3. **Screenshot data.** Some agency screens need in-flight applications to look
   real. The demo `doh`/`pcso`/`dswd`/`ambag` agencies exist; seed a scenario
   or use whatever slices exist so the reskin shows with real content.
4. **No i18n net.** Because staff pages aren't i18n-linted, a stray hardcoded
   string won't fail CI — fine (English is correct), but it also means the
   linter won't catch a typo'd JSX string; rely on the build + eyes.
5. **agency_admin vs agency.** Some pages/nav items are admin-only
   (Allocation, Team, Announcements, Audit). Reskin doesn't change gating, but
   screenshot both roles where it matters.

## 7. Out of scope
- No change to approval/GL/budget/slot **logic** or the co-funding model.
- No mobile-first rewrite (agencies are web-only).
- Admin (`src/pages/admin/**`) is a **separate** future sweep — same foundation,
  same approach, but not this plan.
