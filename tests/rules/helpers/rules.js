import fs from 'node:fs'
import path from 'node:path'

// The rules under test. Blank access codes (issued before patient-bound
// codes, 2026-11-15) are claimable only until a fixed cutoff written into
// firestore.rules. Most suites seed blank codes to test everything else about
// claiming, so by default the cutoff is moved far into the future — otherwise
// those suites would start failing on the cutoff date. Pass `{ cutoff:
// 'real' }` for the real date, or `{ cutoff: 'past' }` to test "expired".
const CUTOFF = 'timestamp.date(2026, 12, 14) + duration.value(16, \'h\')'

export function loadRules({ cutoff = 'future' } = {}) {
  const src = fs.readFileSync(path.resolve('firestore.rules'), 'utf8')
  if (!src.includes(CUTOFF)) throw new Error('blank-code cutoff not found in firestore.rules — update tests/rules/helpers/rules.js')
  if (cutoff === 'real') return src
  return src.replace(CUTOFF, cutoff === 'past' ? 'timestamp.date(2020, 1, 1)' : 'timestamp.date(2100, 1, 1)')
}
