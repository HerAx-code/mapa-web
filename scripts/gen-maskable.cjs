// One-off: regenerate the PWA maskable icon so it is full-bleed pine instead
// of the pine logo floating on a BLUE square. Android uses the maskable icon
// for the home-screen icon + launch splash, so the blue padding showed as a
// border around the logo when opening the installed app. We composite the
// clean pine logo (pwa-512) over a solid pine 512 square; transparent corners
// fill with pine, so nothing blue remains and the OS mask only ever cuts pine.
const sharp = require('sharp')
const PINE = '#0F6E56' // brand-500, matches the logo's rounded-square fill
const SIZE = 512
const LOGO = 400 // ~78% — keeps the pin inside the maskable safe zone (inner
                 // 80% circle) so a round OS mask never clips its point.

sharp('public/pwa-512.png')
  .resize(LOGO, LOGO, { fit: 'contain', background: PINE })
  .toBuffer()
  .then(logo =>
    sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: PINE } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile('public/pwa-maskable-512.png'),
  )
  .then(() => console.log('wrote public/pwa-maskable-512.png (pine, safe-zone padded)'))
  .catch(err => { console.error(err); process.exit(1) })
