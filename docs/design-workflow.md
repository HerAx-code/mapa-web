# MAPA Web Design Workflow

How to combine the installed design skills + MCPs when reskinning or building
MAPA web UI. The point of "combining" them is **giving each one a single clear
job** in a repeatable pipeline — not firing all of them at every page. Most of
these skills overlap on "make it look good"; the table below resolves that so a
future session doesn't spin.

This is the working procedure the snapshot + request-hero craft pass (PR #99)
followed. Read it before any non-trivial UI work.

## Division of labor

| Skill / tool | Its one job | Fires when |
| --- | --- | --- |
| **ui-ux-pro-max** | Reference library — proven palettes, font pairings, UX guidelines, chart/style catalog. Data, not opinion. | Start of a page, to check patterns before inventing |
| **frontend-design** | Design-lead judgment — hierarchy, restraint, the signature element, self-critique. Makes the actual calls. | Every page |
| **dataviz** | Chart / meter / KPI / stat-tile construction rules | Dashboard, Analytics, and any stat tile or meter (e.g. the assessment snapshot meters) |
| **design-system** | Extending or documenting MAPA's *existing* tokens (`.card`, `.stat-tile`, brand-50..900, `.data-table`) | Only when adding a genuinely new reusable token/component |
| **brand** | Voice / tone check on copy | Copy review — MAPA's tone is fixed (civic), so it's a short checklist |
| **ui-styling** | Building net-new components (shadcn/Tailwind idioms) | Rare — most work is reskinning existing JSX |
| **Magic Patterns MCP** | Generate a full-page reference to **mine** (not paste) | Only when a page is genuinely *far* from where it should be — it costs the user's MP credits + 2–10 min |

Design system id (Base): `ds-9b80b54e-92b3-4b2f-8265-afe466ee8b75`

## The pipeline

1. **Frame** — name the page's one job and audience: civic staff (agency/admin,
   English-only) vs bilingual patient (mobile-first). *(frontend-design)*
2. **Look up** — check ui-ux-pro-max for the relevant pattern/guideline instead
   of guessing. *(ui-ux-pro-max)*
3. **Reference, only if far off** — one Magic Patterns generation, then **mine**
   the good ideas. Never paste MP output; it's a TSX prototype, not shipped
   code. *(MP MCP)*
4. **Translate to MAPA** — pine/neutral tokens → `brand`/`gray`, lucide →
   `react-icons/md`, TSX → JSX, drop framer-motion. **Keep all logic, data, and
   the money-path untouched.**
5. **Craft + cut** — apply hierarchy and weight to the page's thesis, then
   remove one accessory (self-critique / "Chanel's mirror"). *(frontend-design)*
6. **Charts + copy** — charts follow dataviz rules; copy gets the brand voice
   check (active voice, plain verbs, sentence case, from the user's side).
7. **Gate** — `npm run build`, the relevant tests, and `npm run lint:i18n`
   (patient pages only) → PR → **the user is the visual check** (Claude can't
   log into the admin/agency surfaces to see renders).

## MAPA guardrails (non-negotiable)

- **Patient surfaces**: bilingual (Filipino + English) and mobile-first —
  touch targets ≥44px, readable on slow phones. Enforced by `lint:i18n`.
- **Staff surfaces (agency/admin)**: English-only by design. Do **not** add
  `t()` wrapping there.
- **Civic tone**: government-adjacent, trustworthy, not flashy. No
  gradients-for-decoration, no bold aesthetic risks the frontend-design skill
  would take on a marketing brief. The brief's civic constraint always wins.
- **Blind-render reality**: Claude cannot see admin/agency renders, so every
  reskin ends with a user click-through. Say so in the PR.
- **MP credits**: one generation per genuinely-off page, never reflexively
  per page.
- **Depth varies**: a page far from target gets a full overhaul; a page already
  close gets a light consistency pass (container width, header, filter bar) —
  and that should be labelled honestly as such, not dressed up as a full reskin.

## When NOT to use a tool

- Don't force the auth-gated / disconnected MCPs (Canva, Calendar, Drive, 21st,
  Playwright) into design work they have nothing to do with — that's theater.
- Don't invent cosmetic diffs on a surface that's already on-brand just to show
  a commit. Re-audit, and if it's clean, say so.
