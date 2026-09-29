# 03 — MAPA visual identity system (evolved pine)

*The defined identity. Evolves the existing pine/Inter/Bricolage system — keeps all
equity, adds the missing logo system, palette rationale, and application specs. This
doc is the spec `Phase B` (the SVG mark) and `Phase C` (implementation) follow.*

---

## 1. Logomark & wordmark

### Recommended direction — "the care pin"
A geometric **map-pin** in pine with a **health cross carved as negative space** at
its center. Rationale, three meanings in one simple form:
- **Name:** *MAPA* echoes **"mapa" (map)** — a pin is the natural, instantly-readable
  mark, and it's a familiar PH/Filipino word, not an abstract logo that needs explaining
  (see low-literacy benchmark).
- **Mission:** a pin **points you to assistance** — "Portal Access."
- **Health:** the negative-space **cross** (or a soft heart variant) says medical care
  without a cold clinical read.

It also carries the current **shield/protection** cue implicitly (a pin's rounded
teardrop reads as sheltering), keeping the civic-legitimacy signal MAPA's fallback
shield had — but as MAPA's **own** mark, never an agency crest.

**Why it works technically:** one closed pine shape + a cut-out → **single-color,
flat, reversible, and legible at 16px** (favicon) and on the dark `card-hero`.

### The system (Phase B produces these as SVG)
- **Icon-only mark** — the care-pin. Used as favicon, PWA/app icon, sidebar mark,
  loading, and anywhere ≤32px.
- **Wordmark** — "MAPA" in **Bricolage Grotesque** (display), tight tracking, pine.
- **Primary lockup** — mark + "MAPA" wordmark + "CRMC" attribution (small, gray),
  matching the current sidebar treatment.
- **Variants:** primary (pine on light), **mono** (single ink — black or white),
  **reversed** (white/tint on pine, for `card-hero` / dark login column).
- **Clear space:** ≥ the pin's own width on all sides. **Min size:** 16px icon / 72px
  lockup. Never re-color outside the pine scale, stretch, add shadow, or place the
  light mark on a busy photo.

---

## 2. Color

Keep the pine scale (`tailwind.config.js`) — it's the brand. Documented roles:

| role | token / value |
|---|---|
| **Primary** (buttons, links, active, `theme-color`) | `brand-500 #0F6E56` |
| Primary hover / active | `brand-600 #085041` / `brand-700 #06402F` |
| Signature hero surface | `card-hero` gradient `brand-700→800→900` |
| Tints (active nav, badges, aurora) | `brand-50 #E1F5EE` … `brand-200` |
| Progress / accent-on-dark | `brand-300 #4BC399` / `brand-400 #1DAF77` |
| App ground / warm landing ground | `gray-50` / `#FBFAF8` |
| **Semantic** | green=money·success, amber=attention·current, red=error·reject, blue=info, **purple=endorsed**, gray=neutral |

### WCAG AA — pairs to keep honest (verify with a checker at build)
| foreground / background | use | verdict |
|---|---|---|
| white on `brand-500` | primary buttons | **AA pass** (~5.9:1) |
| white on `card-hero` (brand-700+) | hero text | **AA pass** (high) |
| `brand-700` on white | links/headings | **AA pass** |
| `amber-700` on `amber-50`, `green-700` on `green-50` | badges (xs) | pass — recheck at 11px |
| **`gray-400` on white** | `.eyebrow`, captions | **WATCH** — ~2.6:1, fails AA for small text; darken eyebrows to `gray-500`/`gray-600` where they carry meaning |

> The one real color a11y fix to fold in: **eyebrow/caption `gray-400` → `gray-500`**
> where it's informational (coordinate with the ux-research 5.3 a11y item).

---

## 3. Typography
- **Display:** Bricolage Grotesque — headlines, hero numbers, page titles
  (`font-display`). Weights 600/700/800.
- **Body/UI:** Inter (`font-sans`) — 400/500/600/700.
- **Numerics:** `tabular-nums` for money, counts, tables.
- **Scale (as used, keep):** hero ₱ 40–52px · h1 24–26px · section 18–20px · body 14px
  · caption 12px · eyebrow 11px uppercase. Body ≥14px on patient screens (never <12px).
- **Bilingual:** Filipino strings run ~15–20% longer — headings use `text-wrap:balance`;
  don't set fixed-width labels; the JourneyStrip's 6 labels already tuned for FIL length.

---

## 4. Iconography
- **System:** Material Symbols via `react-icons/md` (concrete, familiar — right for
  low-literacy users). Keep it; don't mix icon families.
- Icon-only buttons carry `aria-label`. Decorative icons `aria-hidden`.
- **Custom glyph** is warranted **only** for the logomark. Everything else is Material.

---

## 5. Imagery, illustration & motion
- **Imagery:** civic restraint — no stock photography in the app; the product's own
  data (journey, coverage) is the visual. A patient photo appears only as their own
  uploaded ID/selfie (functional, never decorative).
- **Illustration:** minimal; the mark + Material icons carry it.
- **Motion (keep the signature, restrained):** the pine **aurora** (`.hero-aurora` /
  `.brand-aurora`), `fadeIn` page transitions, `heroRise`/`heroStep` — all
  compositor-only and **reduced-motion-disabled**. One orchestrated moment per screen;
  nothing decorative animates on scroll.

---

## 6. Applications
- **App shell:** mark in the sidebar header + PWA bounce screen (`Logo` component).
- **Login / Landing:** reversed mark on the dark brand column / pine aurora hero.
- **Guarantee Letter** (`src/components/GuaranteeLetter.jsx`): the **highest-trust
  artifact** a patient receives — carries the primary lockup as letterhead + "CRMC"
  attribution + pine rule. This is where the identity most needs to read as official.
- **Icons:** favicon 16/32, `apple-touch-icon` 180, PWA 192/512, **maskable 512**
  (mark centered in the 80% safe zone on pine), all regenerated from the one SVG.
- **Social:** `og-image.png` 1200×630 — mark + wordmark + one line ("Medical
  Assistance Portal Access · CRMC") on the pine/warm ground.

---

## 7. Do / don't
**Do:** single pine accent · flat, single-color-capable mark · Material icons ·
generous space · reduced-motion safe · CRMC attribution on official artifacts.
**Don't:** imitate any real agency crest/colors-as-theirs · re-color/stretch/shadow the
mark · add stock photos or gradient decoration beyond the one aurora · drop below 14px
body on patient screens · ship heavy raster where an SVG works.
