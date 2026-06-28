# Component smoke tests

React components under test with @testing-library/react + jsdom +
vitest. Scope is **smoke tests, not exhaustive coverage** — pin the
behaviors that, if regressed, would surface as user-visible bugs.

## Running

```bash
npm run test:components            # one-shot
npm run test:components:watch      # re-run on change
npm run test:all                   # utils + components + rules
```

## What's covered

| File | Pins |
|------|------|
| `AddressPicker.test.jsx`   | Cascade province → city → barangay state; "Other" fallback for non-BARMM addresses; `showBarangay={false}` agency-form variant; edit-flow hydration when value is a free-text Other; `joinAddress()` helper |
| `PatientAccessLog.test.jsx` | i18n heading rendering; loading skeleton; empty state; populated list rendering; unknown-action fallback label; snapshot-error unavailable state |

Total: ~15 assertions across 2 files.

## Pattern for new tests

1. **Mock the external surfaces** the component touches:
   - `vi.mock('firebase/firestore', () => ({ ... }))` — return functions
     that record their args / capture the snapshot callback
   - `vi.mock('../../src/firebase', () => ({ db: {} }))`
   - `vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: {...} }) }))`
2. **Wrap render in I18nextProvider** when the component uses t():
   ```js
   import { I18nextProvider } from 'react-i18next'
   import i18n from '../../src/i18n'
   render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
   ```
3. **Use data-* attributes for queries when labels aren't htmlFor-linked**:
   ```js
   document.querySelector('select[data-field="province"]')
   ```
   Many of our components use `data-field` for focus management; reuse
   it for tests.
4. **Capture async callbacks** (snapshot listeners, file readers) into
   module-scope variables so tests can drive them at will.

## What's NOT covered (and why)

| Surface | Why not |
|---------|---------|
| Register.jsx | Touches firebase/auth + firestore + i18n + router + draft sessionStorage. Mock surface is wide enough that test value drops. Rules tests + the orderBy regression caught earlier this session are the better safety net. |
| ApplicationDetail.jsx | Same — 1,715 lines of state + transactions + modals. Worth testing per-extracted-hook AFTER Phase 2.1's deeper handler extraction lands. |
| Messages.jsx + submodals | The 2.2 split already broke the file into testable units; future tests would target ConversationModal, PatientComposeModal, AdminComposeModal individually. |
| Anything with `runTransaction()` | Component tests can't reasonably simulate transaction outcomes. Cover those at the rules layer (tests/rules) or via manual E2E. |

## Why smoke tests, not E2E

A real E2E (Playwright + emulator) suite is half a sprint of infra
work and brittle in CI. For this codebase's stage (thesis pilot,
3-week defense window), smoke tests give 80% of the regression-
detection value at 10% of the maintenance cost. Promote to E2E
post-pilot if/when there's a real CI pipeline to host them.
