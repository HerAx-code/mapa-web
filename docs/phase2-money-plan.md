# Phase 2 plan — money on the server (T8, then T3)

Status: **plan accepted 2026-11-22 (P2-A to P2-F, including esbuild as a devDependency); PR 2.1 merged and deployed (#413, #415); PR 2.2 merged and deployed (#416); PR 2.3 built on `feat/agency-decisions-on-server`.** Source: the MAPA process-logic gap map (themes T8 and T3, decisions D4, D5, D10). Phase 1 is shipped (docs/phase1-messages-accounts-plan.md).

## What Phase 2 fixes

| Gap | Summary |
|---|---|
| I2 | Agencies can approve out of order (from `endorsed`) or twice; a double approval counts the money twice |
| I3 | "Fully funded" is treated as finished, then reopens when a letter expires and takes over the patient's newer request |
| I6 | Daily slots are counted only in the browser; any hospital's staff can set any agency's shared slot count |
| M3 | Budget arithmetic differs between paths (`allocated > 0` checks, sweep vs browser, redeem not a transaction) |
| M8 | The endorse gate and the budget ceiling live only in the browser |
| M14 | Endorsing can reopen a case another staff member just closed |
| M15 | The second-person rule checks the first editor, by name |
| M17 | The DOH report counts expired, unused letters as assistance |
| N1, N2 | Slot return uses the browser's date; outpatient cap checked only against the browser's total |
| N9, N15, N16, N19 | Patient steps ignore the letter's state; "assessment" counted though never written; per-approval cap mislabelled; Funds ledger shows approved instead of billed |
| R1, R2, R3, R7, R9, R11 | Slot resets ×4, letter expiry ×3, funding totals in 5 browser paths, legacy fields, "active request" defined 6 times, "assistance given" counted differently in each report |

## Rules every change follows
1. **One definition, used everywhere.** Each business term (active request, finished case, letter state, committed, disbursed, assistance given) is defined once, in a pure module the web and the functions both use.
2. **The server decides money and capacity.** Endorse, approve, reject, redeem, expire and reverse run as Cloud Functions in one transaction each. The browser asks; the rules refuse a browser writing those fields directly.
3. **Every money action re-reads what it changes** (the request, the slice, the agency) inside its transaction, so two people acting at once can't double-count.
4. **Counts are always kept.** `budget.committed` and `disbursed` move on every approval and settlement, whether or not an allocation is set; "no allocation" only means "no ceiling".

---

## Decisions (all six accepted, 2026-11-22)

### P2-A. How the web and the functions share one definition
The functions deploy only the `functions/` folder (CommonJS); the shared logic lives in `src/` (ES modules) and today some of it imports browser-only settings (`ORG`, `import.meta.env`).

**Recommendation:** move the pure rules into `src/shared/` (no `ORG`, no `import.meta`, no Firebase imports) and **bundle them into `functions/src/generated/shared.cjs`** with esbuild, from a script run before every Functions deploy (`firebase.json` predeploy) and before `npm run test:functions`. The generated file is committed, and CI checks it's up to date. esbuild is already installed (Vite uses it); it would become an explicit `devDependency` — **needs your OK** (CLAUDE.md: ask before adding dependencies).

Why: the endorse gate alone pulls in ~800 lines (intake completeness, validation, verification policy). Hand-copied versions with parity tests (the `codeIssue.js` pattern) work for 10 lines, not for this — that is how the two `projectPublicAgency` copies drifted.

### P2-B. When a case counts as finished (D4)
**Recommendation: adopt D4.** "Fully funded" stays a funding status. A case is **finished** when it is closed or rejected, or when it is fully funded **and** every approved letter is redeemed or expired. Only a finished case frees the patient to file again (`activeRequestId`), purges the selfie and moves to "Past". The request carries `openLetters` (count), kept by `syncRequestFinancials`.

### P2-C. What "no allocation" means for an agency budget
**Recommendation:** keep today's meaning (no allocation = no ceiling on approvals) but **always** count `committed` and `disbursed`. This is what fixes the drift in M3; a hard block on agencies that never set an allocation would stop live agencies from approving.

### P2-D. Repairing budgets that already drifted
**Recommendation:** a one-off script, `scripts/reconcile-agency-budgets.mjs`, recomputes each agency's `committed` and `disbursed` from its slices and prints the differences. It runs in report-only mode first; you approve before it writes. Run once after PR 2.3 is live (it uses the service account key).

### P2-E. Which slice writes stay in the browser
**Recommendation:** only the non-money ones: the patient's Proceed (already rules-limited to `endorsed → reviewing`), agency notes, and the patient answering "Needs info". Everything that changes status toward money, amounts, letters, budgets or slots goes through a function.

### P2-F. The DOH report's amounts (M17)
**Recommendation:** a row per letter that was **not expired unused**, showing both the approved amount and, once redeemed, the billed amount — the same "assistance given" definition as Analytics and the guarantee-letter ledger. The report says which definition it uses in its header.

---

## PR 2.1 — Shared definitions (T8)
1. **`src/shared/caseState.js` (new, pure):**
   - request: `isRequestOpen`, `isRequestFinished` (P2-B), `requestPhase`;
   - slice and letter: `letterState` (none / valid / expiring / used / expired, from `glStatus` and `glExpiresAt`), `isSliceOpen`, `isSliceSettled`;
   - money: `committedOf`, `disbursedOf`, `assistanceGivenOf` (P2-F), `computeFunding` (moved from `utils/requests.js`), `openLettersOf`.
   - `GL_VALIDITY_DAYS` and the expiry maths move here from `utils/constants.js` (which re-exports them, so imports keep working).
2. **Everyone uses it:**
   - web: `RequestAssistance` / `TrackStatus` active and past (R9), `requestStage` terminal set, `journey`, the patient slice steps (N9), `queueBuckets` (drops `assessment`, N15), Analytics, the DOH report (M17, P2-F), the guarantee-letter ledger, Funds (billed amount; one expiry field, N19);
   - functions (through the bundle, P2-A): `onRequestWritten` (activeRequestId only when finished, I3), `purgeSelfieOnClose`, `syncRequestFinancials` (also writes `openLetters`), `glExpirySweep`.
3. **Existing data:** `scripts/backfill-open-letters.mjs` stamps `openLetters` on every request (report-only unless `--write`), so fully funded cases with an open letter count as active from deploy on.
4. **Tests:** utils tests for every definition (including a fully funded case with an open letter not being finished); functions tests for the I3 scenario reproduced in this session (an expired letter no longer steals `activeRequestId`); a CI check that the bundle is current.

## PR 2.2 — Endorse and close on the server (T3 part 1) — shipped
1. **`endorseRequest({ requestId, agencyIds, notes })`** (Hospital Admin / Staff Admin of the request's hospital). In one transaction it:
   - re-reads the request: open (M14), not already endorsed to those agencies;
   - re-checks the gate with the shared `deriveRequestStage` (documents read from `documents/`, not the request's copy), the verification-call reasons (hospital policy + duplicate flag) and the second-person rule **by uid** for the bill check, the call and the assessment — `completedBy` is now stamped with `completedByUid` only when the assessment completes (M15);
   - for each agency: enabled, partners with this hospital, a slot available today in this hospital's share (effectiveSlots on the server's Manila date) — and takes the slot (I6);
   - writes the slices (`amountRequested` from the re-read request), the request status, `users.agencyIds`, the documents' `agencyIds`, watchers, the audit entries and the notifications.
2. **`closeRequest({ requestId, outcome: 'closed' | 'rejected', reason })`** — closes every open slice, refuses `rejected` once money is committed, gives today's slot back when a slice was endorsed today.
3. **Rules:** hospital staff may no longer write `applications`, request `status` / `agencyIds` / `amountCommitted`, or any `agencies` slot field. The `isAdmin()` slot branch of the agencies rule is removed (I6).
4. **Pages:** the Endorse modal and Reject / Close call the functions. The Requests page's network-wide daily slot reset is removed (R1); `resetAgencySlots` also resets `hospitalSlots`.
5. **Tests:** functions tests for the gate, the race (request closed mid-endorse), slots per hospital, the second-person rule by uid; rules tests that a hospital can no longer create a slice or touch an agency's slots.

## PR 2.3 — Agency decisions and letters on the server (T3 part 2) — built
1. **`decideSlice({ sliceId, action, ... })`** — agency staff of the slice's agency; one transaction re-reading the slice, the request, the agency and the repeat-limit mark:
   - `request_info` / `resume` (reviewing ↔ awaiting_info);
   - `approve`: only from `reviewing` (I2); request open; partnership still current (M13); amount ≤ endorsed, ≤ the **maximum per approval** (renamed, D10), ≤ the budget headroom when an allocation is set (P2-C), and for outpatients ≤ the charge minus what other agencies cover (N2); repeat limit or a written override; writes the slice, the letter (`glStatus: issued`, `glExpiresAt`), the mark, `budget.committed`, the request totals, audit and notifications;
   - `reject`: from `reviewing` / `awaiting_info`; slot back only on the same Manila day (N1).
2. **`settleLetter({ sliceId, action, redeemedAmount? })`** — `mark_issued`, `redeem` (≤ approved; committed −approved, disbursed +billed), `undo_redeem`, `expire`, `reverse` (back to reviewing; committed −approved). Each re-reads `glStatus`, so the sweep and a person can't both release the same letter (M3).
3. **`glExpirySweep`** uses the same settlement code; the agency Dashboard's browser sweep is removed (R2). One field name for who expired a letter (`glExpiredBy`).
4. **Rules:** agency staff may write only notes on a slice; budget fields, `glStatus`, amounts and status come only from the functions. The agency coordinator's budget branch is removed.
5. **Pages:** ApplicationDetail, ApproveModal, GLViewer and the signed-letter upload call the functions; their browser transactions and the duplicate request-total writes are removed (R3). `approvedAmount` stops being written; `amountApproved` is the one field (R7).
6. **Tests:** functions tests for every action, including two approvals at once (only one succeeds, the budget counted once) and the sweep racing a redemption; rules tests that agencies can't write money fields.
7. **As built:** `functions/src/sliceActions.js`. The signed-letter upload still writes its own `certificates/` doc and the slice's `certificateUploaded` flag from the browser (no money; the rules allow agency staff only that flag and `caseNotes`). Also: the agency Dashboard's browser slot reset is gone (resetAgencySlots), the Agency Admin can no longer rewrite `committed` / `disbursed` (a new period may start disbursed at 0 once nothing is committed), and patients may move only a slice's status.

## PR 2.4 — Repair and cleanup
- The Super Admin's "disable agency and reject its open applications" (admin/AgencyDetail) writes slices from the browser, which the rules have refused since before Phase 2; move it to a function (reusing decideSlice's reject) or drop the cascade.
- `scripts/reconcile-agency-budgets.mjs` (P2-D): report, then write on your OK.
- Remove what PRs 2.2–2.3 left unused: the old cooldown path (`cooldownUntilAt` written on reversal, the rules branch letting agencies stamp cooldown fields on access codes), legacy statuses handled in lists (`pending`, `interview`).
- CLAUDE.md: "the endorse gates are client-side" becomes "server-checked"; the money section describes the functions.

## Deploy order (each PR)
1. Regenerate the bundle; deploy the functions.
2. Merge; Vercel deploys the pages that call them.
3. Deploy the rules — **after** the web change is live, or the old pages lose their writes mid-action.
4. After PR 2.3: run the budget reconcile (P2-D).

## Not in Phase 2
- Timers for cases that never finish and slices never proceeded on (T5, Phase 4) — they reuse `closeRequest` and `decideSlice`.
- Document versions, case-owned conversations and server audit for non-money actions (T4, Phase 3).
- Two-factor stage 2 (rules refusing staff without a second factor) — about two weeks after Phase 1 went live; it can land alongside PR 2.2's rules.
