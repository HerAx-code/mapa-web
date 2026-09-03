// One-off: regenerate the PWA maskable icon so it is full-bleed pine instead
// of the pine logo floating on a BLUE square. Android uses the maskable icon
// for the home-screen icon + launch splash, so the blue padding showed as a
// border around the logo when opening the installed app. We composite the
// clean pine logo (pwa-512) over a solid pine 512 square; transparent corners
// fill with pine, so nothing blue remains and the OS mask only ever cuts pine.
const sharp = require('sharp')
const PINE = '#0F6E56' // brand-500, matches the logo's pine fill
const SIZE = 512

// Full-bleed: the logo fills the whole square, so there's no inner rounded
// card "sitting on" a background — just pine edge-to-edge with the mark
// centered. Any transparent corners fill with pine, so nothing blue remains
// and the round OS mask only ever cuts pine. The pin sits well within the
// centre, so it is not clipped.
sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: PINE } })
  .composite([{ input: 'public/pwa-512.png' }])
  .png()
  .toFile('public/pwa-maskable-512.png')
  .then(() => console.log('wrote public/pwa-maskable-512.png (full-bleed pine)'))
  .catch(err => { console.error(err); process.exit(1) })
