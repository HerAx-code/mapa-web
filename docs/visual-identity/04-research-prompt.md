# 04 — MAPA visual identity research prompt (reusable brief)

*A structured brief you can hand to a designer, paste into a design tool (the
`ui-ux-pro-max` / `frontend-design` / `design-system` skills, Figma or Canva MCP), or
an image/logo generator to explore MAPA's visual identity. It encodes the decisions in
`03-identity-system.md` so any exploration stays on-brand. Copy the block below.*

---

> **Brief: MAPA visual identity (evolve the pine identity)**
>
> **What MAPA is.** MAPA (Medical Assistance Portal Access) is a production web + mobile
> service for **Cotabato Regional Medical Center (CRMC) Malasakit Center**, Philippines.
> Indigent patients apply online for medical financial assistance; CRMC verifies and
> assesses remotely, then endorses to funding agencies; approved patients get a
> Guarantee Letter to claim. It is **government-adjacent** and must read as **legitimate,
> official, and reassuring** to low-income users, many on cheap phones over slow networks.
>
> **Audience.** Primary: indigent Filipino patients, often **low-literacy**, on
> **small phones / 2G–3G**, bilingual (Filipino + English). Secondary: CRMC social
> workers and partner-agency staff (desktop).
>
> **Tone.** Civic, professional, trustworthy, warm-but-restrained. **Not flashy.**
> Think GOV.UK / US Web Design System restraint + a human, caring warmth.
>
> **Must keep (equity — do not replace):**
> - **Pine teal** primary `#0F6E56` (full scale 50–900). It's the app theme color,
>   PWA icon color, and accent everywhere.
> - **Typography:** Bricolage Grotesque (display/headlines) + Inter (body/UI).
> - The subtle pine **"aurora"** motion signature and the dark-teal `card-hero`.
>
> **Design the missing logo system:**
> - A single **logomark** — recommended concept: a **geometric map-pin** ("mapa" =
>   *map*; the pin points patients to help) with a **health cross (or soft heart) as
>   negative space** at its center; pine, closed single shape, no gradient.
> - Must be **flat, single-color-capable, reversible on pine, and legible at 16px**
>   (favicon) and on a dark hero.
> - Plus: **wordmark** ("MAPA" in Bricolage), **primary lockup** (mark + wordmark +
>   small "CRMC" attribution), and **mono / reversed** variants. Define clear space
>   (≥ mark width) and min sizes (16px icon / 72px lockup).
>
> **Hard constraints:**
> - **Do NOT imitate** any real Philippine agency's crest, seal, wordmark, or
>   colors-as-theirs (DOH, PhilHealth, DSWD/AICS, PCSO, Malasakit). MAPA uses its own mark.
> - Ship the mark as **SVG** (light on the wire). Icons are Material (`react-icons/md`);
>   don't introduce another icon family.
> - Accessibility: WCAG AA contrast; ≥44px touch targets; reduced-motion safe;
>   body text ≥14px on patient screens.
> - No stock photography or decorative gradients beyond the one aurora.
>
> **Deliverables:** icon-only mark, wordmark, primary lockup, mono + reversed variants;
> favicon (16/32), apple-touch (180), PWA (192/512) + **maskable 512** (mark in 80%
> safe zone), `og-image` (1200×630); a WCAG contrast table for the palette; letterhead
> treatment for the **Guarantee Letter** certificate.
>
> **Success test:** the mark is recognizable at 16px, reads as official + caring (not
> corporate, not clinical), works in one color and reversed on pine, and a first-time
> low-literacy patient would trust that this is a real government-backed health service.

---

## How to use this with the tools available
- **Hand-SVG (default, what this project does):** author the mark directly as SVG per
  the concept above — no tool needed, lightest result. See `03-identity-system.md` §1.
- **`ui-ux-pro-max` / `frontend-design` / `design:design-system` skills:** paste the
  brief to explore palette/type/logo systematically.
- **Figma MCP / Canva MCP:** generate + iterate logo concepts and application mockups
  (both need connector auth first). Optional — the implementation path here is hand-SVG.
