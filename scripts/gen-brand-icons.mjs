/**
 * Regenerate the MAPA raster icon set from the "care-pin" mark.
 *
 * Single source of truth for the mark is public/brand/mapa-mark.svg (and the
 * inline copy in src/components/ui/Logo.jsx). This script rasterizes that mark
 * into every PNG slot the app ships (favicon, PWA icons, apple-touch, maskable,
 * logo, OG card) using `sharp` (already a dependency — no new install).
 *
 * Usage (from repo root):  node scripts/gen-brand-icons.mjs [outDir=public]
 *
 * Colour/placement conventions:
 *  - favicon / pwa-192 / pwa-512 / mapa-logo : pine mark, transparent bg
 *  - apple-touch-icon : pine mark on WHITE (iOS needs an opaque tile; it rounds
 *    corners itself, so we pad the mark generously)
 *  - pwa-maskable-512 : pine background full-bleed, WHITE mark inside the ~80%
 *    safe zone (Android applies its own mask/crop)
 *  - og-image : 1200×630 social card — white mark + wordmark on pine
 */
import sharp from 'sharp'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] ?? 'public')
const PINE = '#0F6E56'
const WHITE = '#FFFFFF'
// Keep in sync with public/brand/mapa-mark.svg + Logo.jsx MARK_D. viewBox 64×80.
const MARK = 'M32 3 C17 3 5 15 5 30 C5 48 32 77 32 77 C32 77 59 48 59 30 C59 15 47 3 32 3 Z M28 16 H36 V25 H45 V33 H36 V42 H28 V33 H19 V25 H28 Z'

// Square icon: optional bg rect + mark centered via a nested <svg> that scales
// the 64×80 viewBox into a content box `content` fraction of the canvas.
function squareIcon({ size, mark = PINE, bg = null, content = 0.78 }) {
  const box = size * content
  const off = (size - box) / 2
  const rect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    rect +
    `<svg x="${off}" y="${off}" width="${box}" height="${box}" viewBox="0 0 64 80" preserveAspectRatio="xMidYMid meet">` +
    `<path fill="${mark}" fill-rule="evenodd" d="${MARK}"/></svg></svg>`
  )
}

function ogImage() {
  const W = 1200, H = 630
  const markH = 300, markW = markH * 64 / 80
  const markX = 150, markY = (H - markH) / 2
  const textX = markX + markW + 70
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${PINE}"/>` +
    `<svg x="${markX}" y="${markY}" width="${markW}" height="${markH}" viewBox="0 0 64 80" preserveAspectRatio="xMidYMid meet">` +
    `<path fill="${WHITE}" fill-rule="evenodd" d="${MARK}"/></svg>` +
    `<text x="${textX}" y="300" font-family="Arial, Helvetica, sans-serif" font-size="130" font-weight="700" fill="${WHITE}" letter-spacing="2">MAPA</text>` +
    `<text x="${textX}" y="370" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="400" fill="#C3EBDd">Medical Assistance Portal Access</text>` +
    `</svg>`
  )
}

const jobs = [
  { file: 'favicon.png',          buf: squareIcon({ size: 48,  content: 0.86 }) },
  { file: 'pwa-192.png',          buf: squareIcon({ size: 192, content: 0.78 }) },
  { file: 'pwa-512.png',          buf: squareIcon({ size: 512, content: 0.78 }) },
  { file: 'mapa-logo.png',        buf: squareIcon({ size: 512, content: 0.90 }) },
  { file: 'apple-touch-icon.png', buf: squareIcon({ size: 180, bg: WHITE, content: 0.60 }) },
  { file: 'pwa-maskable-512.png', buf: squareIcon({ size: 512, bg: PINE, mark: WHITE, content: 0.56 }) },
]

for (const j of jobs) {
  await sharp(j.buf).png().toFile(path.join(OUT, j.file))
  console.log(`wrote ${j.file}`)
}
await sharp(ogImage()).png().toFile(path.join(OUT, 'og-image.png'))
console.log('wrote og-image.png (1200x630)')
