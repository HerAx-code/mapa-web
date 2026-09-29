/**
 * check-bundle-budget — fail the build if the production bundle grows past the
 * gzipped budgets in bundle-budget.json.
 *
 * Why: MAPA's users are indigent patients, often on slow phone connections, so
 * first-load weight is a real feature, not a vanity metric. This makes bundle
 * growth a deliberate, reviewed decision (bump the budget in the same PR) rather
 * than silent drift. No new dependency — measures with Node's built-in zlib.
 *
 * Usage: node scripts/check-bundle-budget.mjs   (run after `npm run build`)
 * Exit 1 if any budget is exceeded, or if dist is missing.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distAssets = path.join(root, 'dist', 'assets')
const budget = JSON.parse(fs.readFileSync(path.join(root, 'bundle-budget.json'), 'utf8'))

if (!fs.existsSync(distAssets)) {
  console.error('✗ dist/assets not found — run `npm run build` first.')
  process.exit(1)
}

const gzipKB = (file) => zlib.gzipSync(fs.readFileSync(path.join(distAssets, file))).length / 1024

const all = fs.readdirSync(distAssets)
const js  = all.filter(f => f.endsWith('.js'))
const css = all.filter(f => f.endsWith('.css'))

// A named chunk = every emitted file whose name is `<key>.js` or `<key>-<hash>.js`.
const chunkFiles = (key) => js.filter(f => f === `${key}.js` || f.startsWith(`${key}-`))
const sumKB = (files) => files.reduce((s, f) => s + gzipKB(f), 0)

const INITIAL_KEYS = ['index', 'vendor-firebase', 'vendor-react'] // eager boot path

const checks = []
checks.push(['initial JS (boot path)', sumKB(INITIAL_KEYS.flatMap(chunkFiles)), budget.initialJs])
checks.push(['total JS',              sumKB(js),                                budget.totalJs])
checks.push(['total CSS',            css.reduce((s, f) => s + gzipKB(f), 0),   budget.totalCss])
for (const [key, cap] of Object.entries(budget.chunks || {})) {
  const files = chunkFiles(key)
  if (files.length === 0) { console.warn(`⚠ no chunk matched "${key}" — skipping (renamed or removed?)`); continue }
  checks.push([`chunk ${key}`, sumKB(files), cap])
}

let failed = false
const pad = (s, n) => String(s).padEnd(n)
console.log(`\nBundle budget (gzipped KB)\n${'─'.repeat(52)}`)
console.log(`${pad('target', 26)}${pad('actual', 10)}${pad('budget', 10)}status`)
for (const [name, actual, cap] of checks) {
  const ok = actual <= cap
  if (!ok) failed = true
  console.log(
    `${pad(name, 26)}${pad(actual.toFixed(1), 10)}${pad(cap, 10)}${ok ? 'ok' : '✗ OVER'}`
  )
}
console.log('─'.repeat(52))

if (failed) {
  console.error(
    '\n✗ Bundle budget exceeded. If this growth is intended, raise the relevant\n' +
    '  number in bundle-budget.json (in this PR) and note why. Otherwise, trim\n' +
    '  the bundle — check for a heavy import pulled into an eager chunk.\n'
  )
  process.exit(1)
}
console.log('\n✓ All bundle budgets satisfied.\n')
