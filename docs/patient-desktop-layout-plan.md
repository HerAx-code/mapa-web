# Patient Web — Desktop Layout Improvement Plan

*Written 2026-09-25. Goal: make the patient web look intentional on desktop
without abandoning the mobile-first design (the app/PWA is the primary patient
channel; the web is the zero-install fallback — see the "remove patient web?"
discussion, which we rejected in favour of fixing the layout).*

## The problem
Patient pages are **mobile-first and look right on a phone**, but **awkward in a
desktop browser** — stretched, lopsided, inconsistent from page to page.

Root cause (verified in code):
- The shell `<main>` in `src/components/Layout.jsx` has **no max-width** — it's
  `flex-1`, i.e. full width of the content area next to the sidebar.
- So width discipline is left to **each page**, and they disagree:
  `RequestAssistance` centers parts at `max-w-xl`, `Dashboard` / `TrackStatus`
  use only `px-*` and stretch edge-to-edge, `Programs` / `Messages` set nothing.
- Result: on a 1440–1920px screen, some pages are a narrow ribbon, others sprawl
  the full width — no shared rhythm.

There is already a recorded decision (memory: *patient layout*) to **center
patient content columns at consistent widths (3xl/xl/5xl); left-align was
rejected as lopsided**. It was applied to some redesigned pages (PRs #153–157)
but never made systematic — this plan finishes that.

## Principle
**Keep mobile-first; frame it on desktop.** A mobile-first page shouldn't become
a desktop app — on wide screens it should sit in a **centered, capped column** so
it reads as a deliberate design, exactly how banking/gov portals present a
phone-first flow on desktop. The web only needs to look clean and trustworthy,
not gain desktop-only features.

## Design — one shared, two-tier width system
A single source of truth for patient page width, with two variants:

| Variant | Max width | For | Why |
| --- | --- | --- | --- |
| **`narrow`** | ~`max-w-3xl` (≈768px) | forms, wizards, reading | comfortable line length + form focus |
| **`wide`** | ~`max-w-5xl` (≈1024px) | dashboards, grids, list+detail | room for cards/columns without sprawl |

Both: `mx-auto`, side gutter `px-4 sm:px-6`, consistent `padding-block`. Nothing
runs edge-to-edge; nothing is a lonely ribbon.

## Implementation
Add one small wrapper component — **`src/components/patient/PatientPage.jsx`**:

```jsx
// Centers + caps patient page content on desktop; full-bleed (with gutter) on
// phone. width: 'narrow' (forms/reading) | 'wide' (dashboards/grids).
export default function PatientPage({ width = 'narrow', className = '', children }) {
  const cap = width === 'wide' ? 'max-w-5xl' : 'max-w-3xl'
  return (
    <div className={`mx-auto w-full ${cap} px-4 sm:px-6 py-4 sm:py-6 ${className}`}>
      {children}
    </div>
  )
}
```

Then migrate each patient page to wrap its content in `<PatientPage width="…">`
and **remove the ad-hoc `max-w-*` / `mx-auto` / gutter classes** so there's one
rule. (Alternative considered: apply the cap in `Layout`'s `<main>` for the
patient role — rejected because pages need different widths, and a per-page
wrapper keeps the choice explicit and greppable.)

## Per-page width map
| Page | Width | Notes |
| --- | --- | --- |
| Dashboard | `wide` | hero + cards + timeline read better with room |
| Find Programs | `wide` | card grid (2–3 cols on desktop) |
| Messages | `wide` | list + thread two-pane on desktop |
| Request Assistance | `narrow` | wizard/form — focus + line length |
| Track Status | `narrow` | vertical stepper + status cards |
| Guide | `narrow` | long-form reading |
| More | `narrow` | simple settings list |

## Desktop niceties (small, optional)
- A subtle, dismissible **"MAPA works best on your phone / the app"** hint on
  desktop patient pages — never blocking, sets expectations that mobile is primary.
- Cap hero/image widths; ensure cards fill their column (no stretched single card
  alone in a wide row).
- Two-pane Messages on desktop (list left, thread right) instead of stacked.

## Phasing
1. **Wrapper + worst offenders** — add `PatientPage`, apply to Dashboard +
   TrackStatus (the most visibly stretched). Ship, eyeball at 1440px.
2. **Roll out** — Request, Programs, Guide, More, Messages; delete ad-hoc widths.
3. **Polish** — per-page component tweaks + the optional desktop hint + two-pane
   Messages.
4. **Verify** — 1280 / 1440 / 1920 widths; `npm run lint:i18n`; component tests.

## Out of scope
- Removing the patient web (rejected — it's the fallback channel; this fixes the
  layout instead).
- Desktop-only patient features. This is layout framing only; the data model and
  flows are unchanged, and the app/PWA remain the primary patient experience.

## Status — Phases 1 & 2 shipped (2026-09-29)
`src/components/patient/PatientPage.jsx` added as the single width source of truth
and rolled out. Per-page results:

| Page | Width | Done |
| --- | --- | --- |
| Dashboard | `wide` | ✅ (was `lg:max-w-6xl` sprawl → `max-w-5xl`) |
| Find Programs (MedicalPrograms) | `wide` | ✅ |
| Track Status | `narrow` | ✅ |
| Guide | `narrow` | ✅ |
| More | `narrow` | ✅ |
| Access Log · Account & security · Help · Privacy notice | `narrow` | ✅ (were already `max-w-3xl`; unified onto the wrapper) |

**Intentional exceptions (not migrated, with reason):**
- **Request Assistance + Intake Wizard** — ➖ keep their tighter `max-w-xl`
  (≈576px) form focus. It's already centered + capped + consistent across all
  three screens; widening a single-column wizard to `max-w-3xl` would hurt form
  line-length/focus. Tighter-than-`narrow` on purpose.
- **Messages** — shared component across all roles, not patient-only; the
  desktop two-pane (list + thread) treatment is deferred to a follow-up (Phase 3
  polish) so this PR stays a pure patient-width rollout.

**Deferred (Phase 3 polish, optional):** the dismissible "works best on your
phone" desktop hint, and two-pane Messages on desktop.

Verified: `npm run build` ✓ · component tests 90/90 ✓ · `lint:i18n` clean.
