# Appendix D — Sample Input / Output / Reports (capture instructions)

The 19 screenshots for Appendix D are produced by
`tests/e2e/capture-appendix-d.spec.js`, which is **excluded from CI** and must
be run by hand against a live, demo-seeded deployment (CI's dummy Firebase
config cannot log in). The PNGs land in this folder as `D-01-*.png … D-19-*.png`.

## Run it

```bash
# 1. Seed demo data so there is an in-flight request to photograph
node scripts/seed-demo-scenario.js

# 2. Capture against the live deployment (or set APPENDIX_BASE_URL to a preview)
APPENDIX_BASE_URL=https://mapa-web-six.vercel.app \
  npx playwright test --config=playwright.capture.config.js
```

Patient screens capture at 390×844 (phone); staff screens at 1440×900.

## PII check (RA 10173)

The spec uses **demo accounts and demo-seeded data only**. Before folding any
capture into the manuscript, eyeball each PNG: if a real name, address, contact
number, ID image, or selfie appears, delete that file and re-capture it against
clean demo data. The screens most likely to expose PII are the document
verification / selfie (D-10) and the intake sheet (D-11).

## Screen → route map

| # | Appendix D screen | How it's captured |
|---|---|---|
| D-01 | Landing / install | route `/` (+ `/install`) — reliable |
| D-02 | Registration | route `/register` — reliable |
| D-03 | Patient dashboard | route `/patient/dashboard` — reliable |
| D-04 | Request wizard | route `/patient/request` (step 1; later steps by hand) — reliable |
| D-05 | Household intake wizard | `/patient/request/:id/intake` — **best-effort** (needs seeded request id) |
| D-06 | Interview booking | route `/patient/interviews` — reliable |
| D-07 | Coverage plan | route `/patient/status` (coverage view) — reliable |
| D-08 | Request tracking | route `/patient/status` (tracking view) — reliable |
| D-09 | CRMC Requests + stepper | route `/admin/requests` — reliable |
| D-10 | Document verification + OCR | inside a request stepper — **best-effort / manual** |
| D-11 | Unified Intake Sheet | inside a request stepper — **manual** |
| D-12 | Endorse modal | inside a request — **manual** |
| D-13 | Agency inbox + detail + timeline | route `/agency/inbox` (+ first application) — reliable/best-effort |
| D-14 | Approve modal + over-commitment guard | inside application detail — **manual** |
| D-15 | Guarantee Letter (unsigned + signed) | `/agency/applications/:id/gl` — **manual** (needs a signed scan) |
| D-16 | Agency budget + audit | routes `/agency/allocation`, `/agency/audit` — reliable |
| D-17 | Admin audit + app logs + CSV | routes `/admin/auditlog`, `/admin/logs` — reliable |
| D-18 | Patient data export + access log | route `/patient/access-log` — reliable (export file captured by hand) |
| D-19 | Aggregate reports | routes `/admin/reports`, `/admin/analytics` — reliable |

Route-level screens capture automatically. Screens marked **best-effort** try to
click into the first seeded record and log `MANUAL:` if the selectors differ;
screens marked **manual** depend on a specific record state (a signed GL, an
open modal) and are captured by hand from the running app.
