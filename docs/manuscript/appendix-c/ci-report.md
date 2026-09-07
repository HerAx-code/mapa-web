# Appendix C — Continuous Integration Report

Most recent successful GitHub Actions run on `main`, generated for the
manuscript. CI runs the build plus the automated test suites in parallel on
every push to `main` and every pull request; Vercel deploys independently, so
CI is a separate quality signal from deployment.

## Run summary

| Field | Value |
|---|---|
| Workflow | CI (`.github/workflows/ci.yml`) |
| Commit | `586432eb1` — *docs: 2026-09-06 review addendum across the docs (#196)* |
| Branch | `main` |
| Trigger | push |
| Started | 2026-09-05 23:51:15 UTC |
| Result | ✅ success (all jobs) |
| Wall-clock | 1 min 33 s |
| Run URL | https://github.com/HerAx-code/mapa-web/actions/runs/33999758954 |

## Jobs

| Job | Result | Duration | What it runs |
|---|---|---|---|
| Build + unit/component tests + i18n lint | ✅ success | ~1 min 30 s | `npm run build`, `npm test` (utils), `npm run test:components`, `npm run test:functions`, `npm run lint:i18n` |
| Firestore rules tests (emulator) | ✅ success | ~1 min 18 s | `npm run test:rules` against the Firestore emulator |
| E2E smoke (Playwright) | ✅ success | ~56 s | `npm run test:e2e` — builds the production bundle, serves it with `vite preview`, and runs the browser smoke pass |

All three jobs run concurrently, so the run completes in ~1½ minutes even though
the jobs sum to ~3½ minutes of work.

## Notes

- A separate deploy workflow (`.github/workflows/deploy-rules.yml`) tests and
  then deploys `firestore.rules` on merge to `main`, so the rules that pass the
  emulator suite above are the rules that reach production.
- The Appendix-D capture spec (`tests/e2e/capture-appendix-d.spec.js`) is
  excluded from the E2E job (`testIgnore` in `playwright.config.js`) because it
  logs into a live deployment with demo credentials, which CI's dummy Firebase
  config cannot do.
