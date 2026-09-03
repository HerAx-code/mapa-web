# MAPA — Medical Assistance Portal Access

A web portal that digitises medical financial assistance for the
Cotabato Regional Medical Center (CRMC) Malasakit Center pilot.
Patients apply once; CRMC verifies + assesses; one or more partner
agencies co-fund the bill toward zero balance.

> Thesis project — solo student, 9 months. Government-adjacent system.
> Tone: civic, professional, trustworthy. Bilingual (Filipino + English)
> for patient-facing UI by design.

---

## Quick links

| What | Where |
|---|---|
| Live deploy | https://mapa-crmc.vercel.app |
| Source | https://github.com/HerAx-code/mapa-web |
| Firebase Console | https://console.firebase.google.com/project/mapa-crmc |
| GitHub Actions CI | https://github.com/HerAx-code/mapa-web/actions |
| Codebase + collaboration conventions | [CLAUDE.md](CLAUDE.md) |
| Operational handoff (post-AI-window) | [docs/handoff-2026-06-29.md](docs/handoff-2026-06-29.md) |
| Full architectural narrative | [docs/redesign-plan.md](docs/redesign-plan.md) |
| Recovery + hardening plan log | [docs/recovery-and-hardening-plan.md](docs/recovery-and-hardening-plan.md) |
| Per-R-number revision history | [docs/revision-list.md](docs/revision-list.md) |
| Threat model | [docs/threat-model.md](docs/threat-model.md) |

---

## What this system does

CRMC is the **single intake gateway**. A patient submits **one
assistance request** with a bill amount + required documents +
live selfie. CRMC verifies the documents (OCR-assisted), fills the
Unified Intake Sheet, conducts **one assessment interview** over
Google Meet, then **endorses** the request to one or more partner
agencies as child application "slices" that together fund the bill
to zero balance. Agencies don't re-review documents or re-interview
— they only approve their slice and issue a Guarantee Letter.

### Five user roles

| Role | What they do |
|---|---|
| `super_admin` | Full system access; CRMC IT |
| `staff_admin` | Operations: accounts, audit, announcements, coordinators |
| `agency_admin` | Manages own agency's coordinators + budget |
| `agency` | Reviews endorsed slices, approves + issues GLs |
| `patient` | Self-registers with Patient Access Code, applies, tracks status |

### Two patient surfaces

- **Web portal** (this codebase): used by agencies, admins, and patients who prefer browser access
- **Mobile app** (planned, separate project): primary patient experience; will share the same Firestore backend

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Auth | Firebase Authentication (email + password; anonymous for access-code verify) |
| Database | Cloud Firestore |
| File storage | Cloud Storage (Guarantee Letter scans, patient documents, profile photos) |
| Functions | Firebase Cloud Functions v2 (Blaze) — asia-southeast1 |
| Hosting | Vercel (NOT Firebase Hosting) |
| i18n | react-i18next (Filipino + English) |
| Testing | Vitest + React Testing Library + jsdom + @firebase/rules-unit-testing |
| OCR | tesseract.js (lazy-loaded on-device) |
| Linting | ESLint v9 + eslint-plugin-i18next (warn-level on patient surfaces) |
| Pre-commit | simple-git-hooks → utils tests |
| CI | GitHub Actions → build + 4 test suites in parallel |

### What this system deliberately does NOT do

- **No real money movement.** MAPA tracks intent (approved amounts, GL status); actual settlement happens off-system between agency and provider.
- **SMS: built, activation pending.** SMS via Semaphore (opt-in per message, PII-free, reserved for high-value alerts like interview-scheduled and approval) is implemented but not yet live — it turns on once the Semaphore sender name "MAPA" clears approval. In-app + email are the active channels today; FCM push is planned when the mobile app ships.
- **No embedded video calling.** Google Meet links (free, no API integration).
- **No PhilSys API integration.** OCR-assisted, social-worker-confirmed ID verification.
- **No donor portal, no fraud detection engine, no multi-hospital network, no real-time IHOMIS integration** — all out of scope for the thesis pilot.

---

## Getting started

```bash
# Install (--legacy-peer-deps required by the ESLint plugin tree)
npm install --legacy-peer-deps

# Set up your local .env (copy .env.example, fill in Firebase config)
# All values are public — see https://firebase.google.com/docs/projects/api-keys
cp .env.example .env

# Dev server
npm run dev

# Production build (same command Vercel runs)
npm run build
```

### Optional setup for full test coverage

| Need | Why |
|---|---|
| Java 21+ (Temurin) | The Firestore emulator (rules tests) is a Java binary |
| `firebase-tools` | `npm install -g firebase-tools@^13` |
| `service-account.json` | Only for running operational scripts under `scripts/` (seeding, migrations). Get from Firebase Console → Project Settings → Service Accounts. Never commit. |

---

## Testing & quality gates

| Suite | Command | What it does | Tests | Speed |
|---|---|---|---|---|
| **Utils** | `npm test` | Pure helper functions (no I/O) | 35 | ~15s |
| **Components** | `npm run test:components` | React component smoke tests (jsdom) | 64 | ~30s |
| **Functions** | `npm run test:functions` | Cloud Function pure handlers (mocked Firestore) | 34 | ~5s |
| **Rules** | `npm run test:rules` | Firestore security rules (boots emulator; needs Java 21+) | 75 | ~30s |
| **All** | `npm run test:all` | Chains all four | **208** | ~80s |

Pre-commit hook runs utils tests automatically (~15s); CI runs the
full suite on every push to main. The component tests use accessible
queries (`getByRole({ name: ... })`) so a regression in label
binding fails CI rather than silently breaking screen reader users.

### Other quality checks

```bash
npm run lint:i18n        # warn-level: catches hardcoded JSX strings on patient surfaces
npm run build            # production build (Vercel runs this too)
```

---

## Project layout

```
src/
  pages/                React Router page components
    patient/              Patient-facing surfaces (bilingual)
    agency/               Agency coordinator + agency_admin surfaces (English)
    admin/                CRMC super/staff admin surfaces (English)
    auth/                 Public-facing (Login, Register, Landing)
  components/             Shared React components
    ui/                     UI primitives (Field, PesoInput, StatusBadge, Logo)
    patient/                Patient-specific shared (PatientAccessLog)
    agency/                 Agency-specific shared (modal extractions)
  contexts/               React contexts (AuthContext, LiveDataContext)
  hooks/                  Custom React hooks (useModal)
  utils/                  Pure utility functions
  i18n/                   react-i18next config + en/fil locale files
functions/
  src/                    Cloud Function handlers (CommonJS, Node 20)
  index.js                Top-level exports (what firebase deploy picks up)
tests/
  utils/                  Pure utility tests
  components/             Component smoke tests
  functions/              Cloud Function handler tests
  rules/                  Firestore rules tests (run against emulator)
docs/
  redesign-plan.md        The frozen CRMC-gateway model + lifecycle
  intake-sheet-fields.md  Every field on CRMC's paper intake forms
  threat-model.md         Risk catalog with mitigations
  recovery-and-hardening-plan.md   Multi-phase execution log
  handoff-2026-06-29.md   Operational runbook for solo-testing window
  thesis-summary.md       Defense-facing summary
  thesis-documentation.md Manuscript-backing detail
  revision-list.md        Per-R-number change history
scripts/                  One-off ops scripts (seeding, migrations, repairs)
firestore.rules           Firestore security rules (deploy via firebase deploy --only firestore:rules)
firestore.indexes.json    Composite index registrations
storage.rules             Cloud Storage rules
firebase.json             Firebase CLI config
vite.config.js            Vite + PWA + esbuild config
vitest.config.js          Vitest config (single-fork; env-globs per folder)
eslint.config.js          Flat config (ESLint v9); narrow i18n scope
.github/workflows/        GitHub Actions (ci.yml + cleanup-orphans.yml)
```

---

## Security model

Three layers:

### Firestore rules (server-side, primary)
Every collection has explicit per-role read/write rules. Patient data
is scoped by `uid` matching, agency data by `agencyId`. Cross-agency
reads use a `get()` chain to verify membership in the parent request's
`agencyIds[]`. 75 unit tests pin every rule constraint.

See [firestore.rules](firestore.rules) for the full ruleset and
[tests/rules/README.md](tests/rules/README.md) for the test coverage.

### Cloud Function gates (server-side, supplementary)
`verifyAccessCode` enforces a **dual-layer throttle** on Patient Access
Code verification:
- **Per-uid:** 10 attempts/hour per authenticated uid (catches a single
  legitimate account spamming).
- **Per-IP:** 60 attempts/hour per hashed client IP (catches the bot
  bypass where an attacker rotates uids via `signInAnonymously()` in
  a loop — the IP layer still rejects).

Both must pass. IPs are SHA-256 hashed (16 hex chars) before storage so
rate-limit docs don't leak actual IPs to admins. Full enumeration of
the 30k 2026 code range would take ~500 hours per IP.

Code at [functions/src/verifyAccessCode.js](functions/src/verifyAccessCode.js).
Tests at [tests/functions/verifyAccessCode.test.js](tests/functions/verifyAccessCode.test.js)
include an explicit REGRESSION GUARD for the anon-uid-loop bypass attack.

### Client-side guards (UX only)
`PrivateRoute` checks roles for route access; `useAuth()` exposes user
context. These are UX layers, not security boundaries — every actual
write is gated by rules.

### Data privacy (RA 10173 alignment)
- `usedBy` patient names live in an auth-gated sub-collection
  (`hospitalIds/{id}/privateInfo/details`), not on the public-readable
  parent doc — closes the enumeration leak that the parent's
  `allow get: if true` would otherwise create
- Cross-agency document reads gated by per-document `agencyIds[]`
  membership
- Patient-visible audit trail (`/patient/access-log`) implements
  §16(c) right-to-access in plain language

---

## CI / deploy

| Trigger | What happens |
|---|---|
| `git push` to main | Vercel auto-deploys + GitHub Actions CI runs |
| Pull request to main | CI runs (no deploy) |
| Manual dispatch | CI runs on demand |
| Sunday 03:00 UTC | Scheduled orphan-cleanup workflow runs (dry-run) |

CI runs build + utils tests + component tests + function tests + rules
tests + i18n lint in two parallel jobs. Both must pass for the workflow
to go green. CI is separate from deploy — Vercel pushes regardless of
CI status. Failed CI is a flag for the operator to investigate.

---

## Contributing (operator notes)

This is a solo thesis project; the only "contributor" is the project
owner. The codebase + collaboration conventions doc at [CLAUDE.md](CLAUDE.md)
is the canonical source for how AI assistants and any future
collaborators should work on the codebase. Key items:

- All admin actions call `logAudit()`
- All notifications use `notify()` (Firestore write + email)
- Patient-facing strings use `t('key')` (lint-enforced)
- Components in `/src/components/`, pages in `/src/pages/`
- Firestore queries grouped in `/src/utils/`
- Touch targets ≥44px on patient-facing surfaces (mobile-first)

For the active improvement plan and what's deferred, see
[docs/recovery-and-hardening-plan.md](docs/recovery-and-hardening-plan.md).

---

## License

Not yet declared. Defense-pending — license decision will follow
project release.
