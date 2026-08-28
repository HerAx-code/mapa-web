# Admin Console Reskin — Plan

**Status:** PROPOSED (plan only)
**Date:** 2026-08-28
**Owner:** Capstone Project Group

> Final surface in the design-system sweep, after the patient side (PRs #28–34)
> and the agency workspace (PRs #35–39). Same principle: adopt the design
> language, keep every real model + action. The foundation primitives
> (`.card-hero`, `.stat-tile`, `.filter-pill`, `.eyebrow`, the polished shell)
> already shipped in #28 — this is mostly *applying* them.

---

## 1. Ground rules (same as agency)

- **English-only.** Admin is a staff surface; `lint:i18n` does **not** cover
  `src/pages/admin/**`. No i18n keys — hardcoded strings are correct.
- **Web-only / desktop-dense.** Keep the multi-pane tables and dense layouts;
  polish, don't rewrite mobile-first.
- **Never touch the logic.** Presentational only. In particular: the CRMC
  **endorsement** transaction (Requests), account create/disable/delete,
  access-code issuance, audit writes (`logAudit`), and reports actions all stay
  exactly as they are.
- **Reuse the shell.** Sidebar/topbar already reskinned in #28 (active pill,
  `System Admin` / `Operations` section eyebrows).
- **Gating unchanged.** Some pages are super_admin-only (Accounts, Audit Log);
  the reskin doesn't change who sees what — screenshot both roles where it
  matters.

## 2. The signature: stat-tiles, not a single hero

Unlike the agency workspace (one dominant **budget** figure → BudgetHero),
admin has **no single headline number** — it's a control console of
system-wide metrics (patients, agencies, open requests, pending docs, approval
rate, GL backlog). So the admin signature is a **unified `.stat-tile` system**
on the Dashboard, not a forced hero. (A slim dark "system snapshot" strip is
*optional* — only add it if it reads naturally; do not force a hero where the
data doesn't warrant one.)

## 3. Design-system mapping

| Element today | Reskin to |
|---|---|
| `page-title` headers (≈16 pages) | `.eyebrow` + bold title |
| Dashboard metric cards + metrics row | `.stat-tile` / `.stat-num` / `.stat-label`, semantic accent for attention (pending docs, GL backlog) |
| Clickable summary/filter cards | `.stat-tile` (clickable) or `.filter-pill` |
| Ad-hoc status chips | shared `<StatusBadge>` |
| Tables | keep; polish header row, hover, `tabular-nums` on numbers/amounts |
| Quick-actions launcher grid (Dashboard) | tidy/group; keep as icon tiles or demote |

## 4. Page-by-page (17 pages, tiered)

### Tier 1 — work surfaces (do first)
- **Dashboard.jsx** (592) — eyebrow header; the 4 metric cards + the
  Approval-Rate / GL-Backlog metrics → `.stat-tile`; tidy the MANAGE/REVIEW
  quick-actions grid; keep the activity feed. No logic touched.
- **Requests.jsx** (1697) — the **CRMC gateway** work surface (verify docs →
  intake + interview → endorse). Largest admin file; the endorse transaction
  commits slots + creates slices, so treat it like agency ApplicationDetail:
  **presentational only** (eyebrow header + section eyebrows + the guided
  stepper polish), then a **functional endorse smoke test**. Do this one **last
  in Tier 1**, its own reviewed PR.

### Tier 2 — management (tables + detail)
- **Agencies.jsx** (764), **AgencyDetail.jsx** (897), **AddAgency.jsx** (503),
  **Patients.jsx** (689), **Accounts.jsx** (550), **HospitalIDs.jsx** (594) —
  eyebrow headers; any summary/metric cards → `.stat-tile`; table + form
  polish. AgencyDetail has budget data → the shared **agency BudgetHero** may
  fit there (read-only).

### Tier 3 — config / records / light
- **Announcements.jsx** (635), **AssistanceTypes.jsx** (596),
  **DocTypes.jsx** (594), **AppLogs.jsx** (227), **AuditLog.jsx** (425),
  **Reports.jsx** (464), **Messages.jsx** (566), **Export.jsx** (106),
  **ExportPreview.jsx** (594) — mostly eyebrow headers + card/table +
  `.filter-pill` where there are filters. Export/ExportPreview and the config
  pages (Assistance/DocTypes) are structurally simple.

## 5. Build order (each its own screenshot-verified PR)

1. **Dashboard** — the stat-tile signature; sets the tone.
2. **Tier 2** management pages — batch related ones (e.g. Agencies +
   AgencyDetail + AddAgency; Patients + Accounts + HospitalIDs).
3. **Tier 3** — batch the header sweeps.
4. **Requests** last — its own careful PR + a full endorse smoke test (verify
   docs → intake/interview → endorse to an agency; confirm the slice is created
   and slots decrement).

**Discipline:** build green after each; screenshot as `admin@crmc.gov.ph`
(super_admin) and, where gating differs, `staff@crmc.gov.ph`.

## 6. Risks

1. **Requests.jsx (1697 lines, endorsement).** The one real hazard — money-
   adjacent (slots + slices). Presentational only; endorse smoke test after.
2. **Sensitive admin actions.** Account disable/delete, access-code issuance,
   audit writes — never touched; but screenshot flows to confirm nothing broke.
3. **No i18n net.** Admin isn't i18n-linted, so a typo'd JSX string won't fail
   CI — rely on build + eyes.
4. **Data for screenshots.** Some pages (Requests, Patients, Reports) look
   empty without content; use existing demo data or seed briefly + revert
   (as done for the agency ApplicationDetail test).

## 7. Out of scope
- No change to any admin **logic** (endorsement, accounts, audit, reports,
  access codes, exports).
- No mobile-first rewrite (admin is web-only).
- This completes the app-wide sweep: patient (done), agency (done), admin
  (this plan). No further role surfaces remain.
