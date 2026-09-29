# MAPA visual identity — index

*Compiled 2026-09-28. The brand source-of-truth for MAPA: what the identity is, how it
evolves, and the reusable brief that drives it. Companion to `docs/ux-research/`.*

MAPA had a mature **design system** (pine tokens, Inter + Bricolage, a full component
layer) but **no defined brand identity** — a placeholder raster logo with a generic
shield fallback, raster-only icons with no source, and no documentation. This set
**evolves the pine identity** into a defined, documented, implemented visual identity.

## Documents
1. **[01-current-identity-audit.md](01-current-identity-audit.md)** — the as-built
   identity from code (palette, type, components, the logo gap, assets, a11y).
2. **[02-benchmarks.md](02-benchmarks.md)** — how civic/health/trust brands build
   identity (GOV.UK/USWDS restraint, PH civic trust cues, low-literacy iconography).
3. **[03-identity-system.md](03-identity-system.md)** — **the spec**: the "care-pin"
   logomark direction, palette + WCAG table, type scale, iconography, motion, and
   applications. Read this before implementing.
4. **[04-research-prompt.md](04-research-prompt.md)** — the reusable **visual-identity
   research/brief prompt** (hand it to a designer or a design tool).

## Direction in one line
Evolve, don't replace: keep the **pine `#0F6E56`** + **Bricolage/Inter** + aurora
signature; add a real **"care-pin"** SVG logo system (map-pin + negative-space health
cross), a documented accessible palette, and regenerated SVG-sourced icon assets —
official + caring, legible at 16px, restrained per government-service norms.

## Implementation status
Tracked on branch `feat/visual-identity`. Phase A = these docs. Phase B = the SVG mark
(review checkpoint). Phase C = wire `Logo.jsx`, regenerate `public/` icons, update
`index.html` + `vite.config.js` manifest (incl. removing the stale `My Interview`
shortcut), light-touch token comments, and the Guarantee Letter letterhead. Purely
presentational — no data-model / rules / Cloud Function changes.
