# 02 — Visual identity benchmarks

*How comparable civic / health / trust brands build visual identity, and what MAPA
should take from each. Chosen for MAPA's reality: a government-adjacent medical-aid
service for indigent Filipino patients on phones.*

## A. Government digital services — restraint as trust
**GOV.UK / US Web Design System (USWDS).** The house style of public digital services
is deliberately plain: **one primary accent**, a **system/near-system typeface**, high
contrast, generous spacing, and almost no decorative imagery. The brand *is* the
clarity and consistency, not ornament. Marks are simple, flat, single-color-capable,
and legible at favicon size.
> **For MAPA:** this validates the current direction — keep the single pine accent,
> keep the type restrained, avoid gradients-as-decoration except the one signature
> aurora. The logomark must work flat + single-color + at 16px.

## B. Philippine civic / health context — trust cues (reference, not to copy)
PH government and health-aid programs (DOH, PhilHealth, DSWD/AICS, PCSO, the Malasakit
program) read as **official and reassuring**: deep institutional colors (greens/blues),
a seal/shield or emblem motif, formal wordmarks, and prominent agency attribution.
Indigent applicants look for signals that a service is *legitimate and government-backed*.
> **For MAPA:** lean into the **shield/seal lineage** (legitimacy) and keep **"CRMC"**
> attribution visible in the lockup — but as MAPA's **own** mark. Do **not** replicate
> any real agency's crest, colors-as-theirs, or wordmark (impersonation + confusion).

## C. Nonprofit / patient-facing health — warmth within trust
Health-aid and patient brands balance institutional trust with **human warmth** — a
softer accent tint, rounded geometry, a "care/hand/heart" motif, and friendly (not
clinical) display type. MAPA already does this with Bricolage Grotesque + the warm
landing ground.
> **For MAPA:** the mark can carry a subtle **care/assistance** note (an upward/opening
> or sheltering form) so it isn't a cold bureaucratic shield. Bricolage stays for headlines.

## D. Low-literacy / low-bandwidth iconography
Research on low-literacy mobile users (Medhi/Microsoft Research; ACM guidelines, cited
in `docs/ux-research/02-external-benchmarks.md`): lean on **familiar, concrete icons**,
strong contrast, and simple forms; avoid abstract logos that need explaining. Assets
must be **tiny on the wire** (a pine SVG mark is ~1 KB vs a heavy PNG).
> **For MAPA:** the mark should be **instantly readable** and **geometric/simple**;
> icon system stays Material (`react-icons/md`) — concrete, familiar. Ship the mark as
> SVG so it's crisp and light on 2G/3G.

## E. Brand-system hygiene (any mature brand)
A usable identity ships: a **logo system** (primary / mono / reversed / icon-only,
clear space, min size), an **accessible palette** (documented WCAG pairs), a **type
scale**, **iconography rules**, **application specs** (app, certificate/letterhead,
app icons, OG), and **one source-of-truth doc**. MAPA has the tokens but none of the
documentation or the logo system.
> **For MAPA:** that list *is* the deliverable set of `03-identity-system.md` +
> the regenerated assets.

## Sources
- GOV.UK Design System · US Web Design System (design principles: restraint,
  one accent, system type) — see `docs/ux-research/02-external-benchmarks.md` for the
  cited GDS/USWDS links gathered this project.
- Low-literacy mobile UX: Medhi et al. (Microsoft Research / ACM ToCHI); ACM
  "Actionable UI Guidelines for Low-Literate Users" — same file.
- PH civic/health programs (DOH, PhilHealth, DSWD/AICS, PCSO, Malasakit) referenced as
  **trust-cue context only** — MAPA uses its own mark and never imitates theirs.
