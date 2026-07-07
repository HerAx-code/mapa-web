# Component smoke tests

React components under test with @testing-library/react + jsdom +
vitest. Scope is **smoke tests, not exhaustive coverage** — pin the
behaviors that, if regressed, would surface as user-visible bugs.

## Running

```bash
npm run test:components            # one-shot
npm run test:components:watch      # re-run on change
npm run test:all                   # utils + components + functions + rules
```

## What's covered (64 assertions across 9 files)

| File | Pins |
|------|------|
| `AddressPicker.test.jsx`             | Cascade province → city → barangay state; "Other" fallback for non-BARMM addresses; `showBarangay={false}` agency-form variant; edit-flow hydration when value is a free-text Other; `joinAddress()` helper. Uses accessible queries (`getByRole('combobox', { name: /province/i })`) — pins the a11y label binding as a regression guard |
| `PatientAccessLog.test.jsx`          | i18n heading rendering; loading skeleton; empty state; populated list rendering; unknown-action fallback label; snapshot-error unavailable state |
| `AnnouncementFeedCard.test.jsx`      | Empty items returns null; visible-limit + "Show N more" expander; agency badge for source:'agency' items; dismiss button on info-type; **REGRESSION GUARD**: no dismiss on warning-type |
| `CaseTimeline.test.jsx`              | Loading skeletons; empty state; most-recent-first order; known action labels; **REGRESSION GUARD**: unknown action → fallback label; System actor fallback; details text renders |
| `PesoInput.test.jsx`                 | ₱ glyph always rendered; type=number + inputMode=numeric; wrapperClassName + className pass-through; onChange fires; disabled prop; min prop default + override |
| `SuggestEndorsementModal.test.jsx`   | Header rendering; **REGRESSION GUARDs**: own agency + disabled agencies excluded from picker; Send button gated by reason ≥ 10 chars; addDoc payload self-attributes via fromAgencyId/fromUserId |
| `ConversationModal.test.jsx`         | Header rendering; loading skeletons; message bubbles post-snapshot; **REGRESSION GUARD**: pager hidden when 1 conversation; pager visible for multi; close button fires onClose; discard guard on unsaved reply |
| `ConversationThread.test.jsx`        | Header rendering; loading skeletons; message bubbles; empty state; setText prop wiring; **REGRESSION GUARD**: sendMessage called with conversation id |
| `composeModals.test.jsx`             | Patient compose: loading + error states, agency filter by patient's applications, string-convId contract; Admin compose: full user list minus self, **REGRESSION GUARD** for the `conv.id`→`convId` bug fixed in `d183535` |

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
3. **Prefer accessible queries.** Use `screen.getByRole('combobox', { name: /province/i })`
   or `screen.getByLabelText(...)`. If those don't work because a
   component's labels aren't bound via `htmlFor`, **fix the component
   first, then use the accessible query** — don't fall back to
   `document.querySelector('[data-field=...]')` unless the field is
   genuinely presentational (e.g. an error-focus anchor, not a labeled
   input). AddressPicker uses `useId()` + `htmlFor` for exactly this
   reason; screen readers announce field names properly, and the tests
   are regression guards for the binding.
4. **Capture async callbacks** (snapshot listeners, file readers) into
   module-scope variables so tests can drive them at will.
5. **REGRESSION GUARDs** — when a test pins the fix for a specific bug,
   label it that way in the test name so future maintainers know
   removing the assertion re-opens the vulnerability.

## What's NOT covered (and why)

| Surface | Why not |
|---------|---------|
| Register.jsx | Touches firebase/auth + firestore + i18n + router + draft sessionStorage + `verifyAccessCode` Cloud Function. Mock surface is wide enough that test value drops. Rules tests + the orderBy regression caught earlier this session are the better safety net. |
| ApplicationDetail.jsx | 1,715 lines of state + transactions + modals. Worth testing per-extracted-hook AFTER Phase 2.1's deeper handler extraction lands. |
| Layout.jsx | 1,285 lines; owns ProfileModals + notifications + install-prompt state. Too many concerns for a single component test; would need the Phase 4.1 refactor first. |
| Anything with `runTransaction()` | Component tests can't reasonably simulate transaction outcomes. Cover those at the rules layer (tests/rules) or via manual E2E. |

## Why smoke tests, not E2E

A real E2E (Playwright + emulator) suite is half a sprint of infra
work and brittle in CI. For this codebase's stage (thesis pilot,
3-week defense window), smoke tests give 80% of the regression-
detection value at 10% of the maintenance cost.

**What the 64 component tests actually catch:** props rendering, prop
callbacks firing, conditional branches, empty/loading/error states,
i18n key wiring, and 9 explicit REGRESSION GUARDs for previously-fixed
bugs. **What they don't catch:** rendered pixel bugs, Firestore
transaction contention, race conditions, and real network failures.
For those, run the app in a real browser or write a rules/functions
test.

Promote to E2E post-pilot if/when there's a real CI pipeline to host
them.
