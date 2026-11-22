# Hand-off — where the process-logic remediation stands (2026-11-22)

Read this first in a new session, together with CLAUDE.md. Everything below was true at `main` after PR #430.

## Done
All five phases of the process-logic gap map are merged and deployed:
- docs/phase1-messages-accounts-plan.md (#407–#412)
- docs/phase2-money-plan.md (#413–#418)
- docs/phase3-evidence-codes-plan.md (#419–#423)
- docs/phase4-case-endings-plan.md (#424–#426)
- docs/phase5-cleanup-plan.md (#427–#430)

Each plan has its decisions and "As built" notes. 56 of the 58 gap-map items are fixed. Two small ones are left (below).

## Still to fix — one small PR

### 1. N14: the DOH report uses the patient's *current* address
**Problem.** `src/utils/dohReport.js` (around line 46) reads `city` / `province` from the patient's profile (`users/{uid}`), so a patient who moves changes past months' reports.

**Fix.**
- At filing, `src/pages/patient/RequestAssistance.jsx` (where it writes `patientAddress: user.address`, around line 866) also stores `patientCity: user.city ?? ''` and `patientProvince: user.province ?? ''` on the request.
- Check the requests create rule in `firestore.rules`: is it an allowlist of keys? If so, add the two keys there too, with a rules test.
- `dohReport.js` uses the request's (or slice's) `patientCity` / `patientProvince`, and falls back to the profile for older requests.
- Add a utils test for the fallback.

### 2. N16: rename "per-applicant cap" to "maximum per approval" in the UI (decision D10)
**Problem.** The server already says "maximum per approval" (`functions/src/sliceActions.js`), but the UI still says "per-applicant cap". The field `agencies.maxPerApplicant` is per approval, not per patient. **Labels only: don't rename the field.**

**Fix.** Change the label in:
- `src/components/agency/ApplicationModals.jsx`: lines 191, 349 and 363, and the comment at 137;
- `src/components/ProfileModals.jsx`: the help text at line 639;
- any "Max per applicant" label on the Agency Admin's Budget Allocation page — `grep -rn "per applicant\|per-applicant" src`.

Update any component test that matches the old text.

**Deploy:** none for N16. N14 needs a rules deploy only if the request-create rule changes; do it after the web change is live.

## Waiting on people, not code
- **Two-factor stage 2** is built and **switched off**. It goes on when both are true:
  1. `node scripts/report-staff-mfa.mjs` shows every active staff sign-in enrolled (0 of 21 on 2026-11-22);
  2. it is 2026-12-06 or later.

  To turn it on:
  - set `function enforceStaffMfa() { return true; }` in `firestore.rules`;
  - set `ENFORCE_STAFF_MFA = true` in `functions/src/mfaPolicy.js` (`tests/functions/mfaPolicy.test.js` fails if the two disagree);
  - deploy the rules **and** the staff callables (the list is in PR #430).

  Before that:
  - sign in as the Super Admin (`mapa.admin@mapa.gov.ph`): you should be sent straight to two-factor setup, and a re-run of the report should then show 1 enrolled;
  - CPCGHFI has two Hospital Admin accounts that look like one person ("Dr. Emil Caoagdan" admin2@ and "Dr. Emili S. Caoagdan" admin@); disable the duplicate;
  - enrol or disable the practice accounts (MAPA Training Funder ×2, the Training hospital admin).
- **D7:** the retention period for restricted patient records, to be confirmed by the hospital's data protection officer (DPO).
- **D10:** what DSWD, PCSO and the other agencies actually apply, per approval or per patient.
- **Held for the CRMC meeting:**
  - the real per-type document lists (the gate for `VITE_PER_TYPE_DOCS`);
  - the real Certificate of Eligibility form;
  - a hospital-side "applied to the bill" mark;
  - tracking agency repayments;
  - a bill that grows after endorsement.

## Housekeeping
- **Close PR #260 by hand.** It is from 2026-10-01 and edits `api/send-email.js` / `api/send-sms.js`, which Phase 1 removed, so it's superseded.
- **Dependabot PRs.** 10 are open. The major ones (`firebase-admin` 14, `firebase-functions` 7, `jsdom` 30) need a test run before merging.
- **`service-account.json`.** It is gitignored. Delete or revoke it after the last enrolment report.
- **Two Playwright files** in `tests/e2e/` (`capture-revisions*.spec.js`) are untracked and not part of this work. Keep or delete them.

## How this work was run (keep doing it this way)
**The owner's conventions:**
- Show the diff before committing when asked.
- Confirm before every deploy and before every production data write.
- Scripts that touch production run in report mode first, and write (`--write`) only on the owner's OK.
- Never turn on Auto-fix or auto-merge unasked.
- Never commit `functions/.env.mapa-crmc`, `service-account.json` or the owner's unrelated untracked files.
- Stage files by name, not `git add -A`.

**Deploy order for each PR:**
1. Deploy the functions:
   ```
   npx firebase deploy --only functions:<names> --project mapa-crmc
   ```
   Add `--force` only for a function with a retry policy (`assignPatientId`); it acknowledges the policy.
2. The owner merges. Vercel deploys the web app from `main`.
3. Deploy the rules only **after** Vercel production shows the merged commit:
   ```
   npx firebase deploy --only firestore:rules --project mapa-crmc
   ```

**Tests:**
- `npm test` (utils), `npm run test:components`, `npm run test:functions`.
- The rules tests on this Windows machine need a short Unix-socket folder for the Java emulator:
  ```powershell
  $env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$env:TEMP\uds"; mkdir $env:TEMP\uds -Force; npx firebase emulators:exec --only firestore --project mapa-rules-test "npx vitest run tests/rules"
  ```
- After changing `src/shared/`, run `npm run build:shared` and commit `functions/src/generated/shared.cjs`. CI runs `npm run check:shared`.

**Production scripts** use the service account:
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
```
