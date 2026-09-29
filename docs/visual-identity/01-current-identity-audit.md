# 01 — Current visual identity audit (as-built)

*What MAPA's visual identity actually is today, read from the code (2026-09-28).
The takeaway: there is a mature **design system** but no defined **brand identity**.*

## Color
Source: `tailwind.config.js` → `theme.extend.colors.brand` (the "pine" teal scale).

| token | hex | role today |
|---|---|---|
| brand-50 | `#E1F5EE` | tints: `nav-item.active` bg, badges, aurora |
| brand-100 | `#C3EBDd` | soft fills |
| brand-200 | `#87D7BB` | hero eyebrow text on dark |
| brand-300 | `#4BC399` | progress fills, hero legend |
| brand-400 | `#1DAF77` | focus ring, aurora light |
| **brand-500** | **`#0F6E56`** | **primary** — buttons, links, active, theme-color |
| brand-600 | `#085041` | hover, `card-hero` gradient start |
| brand-700 | `#06402F` | `card-hero` gradient |
| brand-800 | `#04301F` | `card-hero` gradient |
| brand-900 | `#02200F` | deepest / shadows |

- **Semantic colors** (Tailwind defaults, via `index.css` badges): green = money/success,
  amber = attention/current, red = error/reject, blue = info, **purple = endorsed**,
  gray = neutral. This mapping is consistent across app + the redesign work.
- **Grounds:** app `bg-gray-50`; landing warm ground `#FBFAF8` with `.lp-card` +
  pine-tinted shadows; `card-hero` = pine gradient `from-brand-700 via-800 to-900`.
- **Motion accents:** `.hero-aurora` / `.brand-aurora` — slow drifting pine-teal
  radial light (CSS-only, reduced-motion aware). This is a distinctive signature.
- `theme-color` `#0F6E56` (`index.html` + `vite.config.js` manifest); bg `#FFFFFF`.

## Typography
Source: `tailwind.config.js` → `fontFamily`.
- **Body:** `Inter` (`font-sans`), system fallback.
- **Display:** `Bricolage Grotesque` (`font-display`) — "warm humanist display for
  patient-facing headlines… reads as a companion, not an admin panel."
- Numerics: `tabular-nums` used for money/figures.

## Component / token layer
Source: `src/index.css` (`@layer components`). A real, reusable system:
`.btn-{primary,secondary,danger}` (≥44px), `.card` / `.card-hero`, `.lp-card` /
`.lp-chip` (landing), `.stat-tile` / `.stat-num` / `.stat-label`, `.badge-*`,
`.nav-item` / `.nav-icon-btn`, `.eyebrow`, `.filter-pill`, `.data-table`,
`.page-title` / `.page-sub`, responsive-grid utilities. Focus rings via
`:focus-visible` (`ring-brand-400`). Animations: `fadeIn`, `heroRise`, `heroStep`,
`mapaAurora`.

## Logo & brand assets — **the gap**
- `src/components/ui/Logo.jsx` renders **`public/mapa-logo.png`** (raster) and falls
  back to a **generic Material `MdShield`** icon in a pine rounded square. There is
  **no designed mark, no SVG source, no wordmark system.** `withWordmark` just sets
  "MAPA" + "CRMC" in Inter.
- `public/` icon assets are all **raster PNG** with no source of truth:
  `favicon.png`, `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`,
  `pwa-maskable-512.png`, `mapa-logo.png`. **No OG/social image.**

## Tone (from CLAUDE.md design principles)
Government-adjacent; **civic, professional, trustworthy — not flashy.** Bilingual
(FIL/EN) on patient surfaces; staff English-only. Mobile-first for indigent patients
on slow phones. Match CRMC's real workflow; don't invent.

## Accessibility posture (already decent)
Visible `:focus-visible` rings; ≥44px touch targets on buttons/inputs/nav;
reduced-motion honored on all animations; skeleton loaders. Not yet formally audited
for palette contrast (small amber/gray text is the likely weak spot).

## Gaps this refresh closes
1. **No real logo** — placeholder PNG + generic shield fallback; no SVG mark/wordmark.
2. **No brand source-of-truth doc** — palette/type/logo rules live only implicitly in
   code; no usage guidance, no contrast table.
3. **Raster-only assets** with no source; icons can't be regenerated cleanly; no OG image.
4. **Stale PWA `My Interview` shortcut** in `vite.config.js` (interview flow removed).
5. Palette + type are strong but **undocumented** — easy to drift.

## What's already good (preserve)
The **pine equity** (`#0F6E56`), the Inter + Bricolage pairing, the aurora motion
signature, the component token layer, and the a11y baseline. This refresh **evolves**
these — it does not replace them.
