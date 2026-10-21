# De-CRMC Genericization Plan — make MAPA fully client-agnostic

**Status:** approved, not started. Owner decisions locked **2026-10-21** (see §3).
**Principle:** one accurate, independently-shippable step at a time. Every phase is a
single PR that builds, passes `lint:i18n` + `npm run test:all`, and is verified on a
Vercel preview before merge. No phase depends on a later one. We optimize for *zero
regressions*, not speed.

> Context: the earlier de-CRMC refactor (`71aa53f`) already made the host org
> **configurable** (`src/config/org.js` + `functions/src/orgConfig.js`, `VITE_ORG_*`)
> and tokenized patient copy with `{{org}}` / `{{gateway}}` / `{{facility}}`. The live
> build already runs on neutral MAPA defaults. **What remains** is removing the CRMC
> traces that bypass that system: hardcoded strings, code identifiers, one stored
> field, comments, one seed record, and infra naming. This plan finishes the job.

---

## 1. Scope — what a "CRMC trace" is here

Measured against the current tree (code/config only, excluding `docs/`):

| Token | Files | Nature |
|---|---|---|
| `CRMC` / `crmc` | 76 | Mostly **comments**; some **code identifiers**; a few **strings** |
| `Malasakit` | 20 | Gateway-office name **and** a seeded partner agency (dual role) |
| `Cotabato` / `BARMM` / `Sinsuat` | 19 / 12 / 5 | **Real geography** — *kept* per D1/D2 |
| `mapa-crmc` | 1 | `package.json` `name` only (Firebase project id passed via `--project`) |

**In scope:** the literal `CRMC`/`crmc` everywhere (comments, identifiers, strings), the
dual-role "Malasakit Center" where it means the host gateway or the dropped agency, the
email `From` brand, and `package.json`'s name.
**Explicitly NOT a target** (owner decisions, §3): the Cotabato/Sinsuat **address**, the
PH **barangay/city location data**, the **Firebase project id**, and the **manuscript +
historical docs**.

---

## 2. The layers (inventory)

### Layer 1 — Comments (safe, cosmetic, ~190 lines across ~70 files)
Explanatory comments narrating "CRMC does X" (`// the CRMC social worker adds the
assessment`, `// Renders nothing when the ball is in CRMC's court`). **Zero runtime
risk.** Replace "CRMC" → "the gateway" / "the hosting org" to match the already-neutral
code around them.

### Layer 2 — User-facing & semi-user-facing strings
Seen by patients/partners, currently bypassing the ORG token system:
- **`src/i18n/locales/{en,fil}.json`** — hardcoded `"Malasakit Center"` (~lines 251,
  1061, 1258, 1304, 1398). Two sub-cases:
  - *Malasakit-as-gateway* ("report to the Malasakit Center", "your code from the
    Malasakit Center") → replace with the existing **`{{gateway}}`** token.
  - *Malasakit-as-funder* (in agency lists like "DSWD, PCSO, and the Malasakit Center")
    → **remove Malasakit from the list** (it's being dropped as a funder — D3), leaving
    the other agencies.
  - The **address** strings (Sinsuat/Cotabato/Maguindanao, ~lines 182, 288, 302) are
    **left as-is** (D1).
- **`api/send-email.js`** — SMTP `From` default `"MAPA CRMC <...>"` (lines 17, 25, 131).
  Appears in **email headers** → derive from `ORG` (e.g. `` `${ORG.name} <...>` ``).
- **`src/pages/admin/{AddAgency,Agencies}.jsx`** — form placeholder `"Malasakit Center"`
  (staff-facing) → neutral placeholder (e.g. `"Agency name"`). Also `AddAgency.jsx:351`
  example text `"CRMC Ground Floor"` → neutral example.

### Layer 3 — Code identifiers (small, mechanical refactors)
| Identifier | Refs / files | Rename to |
|---|---|---|
| `isCrmcAdminRole` | 4 / 2 | `isGatewayAdminRole` |
| `CRMC_GATEWAY_NAME` / `_INITIALS` / `_COLOR` | 1 each | `GATEWAY_NAME` / … (already re-exports of `ORG.*`) |
| `CRMC_STAGE_KEYS` | 2 / 1 | `GATEWAY_STAGE_KEYS` |
| `handleMessageCrmc` | 2 / 1 | `handleMessageGateway` |
Caught by build + tests if a reference is missed. One rename per commit. `src/utils/names.js`
reserved-username list contains `'crmc'` — keep it blocked (harmless) or drop; trivial.

### Layer 4 — Stored Firestore field `crmcNotes` (data migration — highest care)
Only **3 code refs**: written in `src/pages/admin/Requests.jsx:268`, read in
`src/components/agency/ApplicationModals.jsx:268,271`. It is a **field on existing
`applications` documents**, so renaming (→ `gatewayNotes`) needs a safe migration:
1. **Writers** set *both* `gatewayNotes` and `crmcNotes` (dual-write).
2. **Readers** prefer `gatewayNotes ?? crmcNotes` (dual-read).
3. **Backfill** existing docs with a one-off `scripts/` migration (copy `crmcNotes` →
   `gatewayNotes`).
4. After backfill verified in prod, **drop** the dual-write and the old field.
5. Check `firestore.rules` for any `crmcNotes` constraint before each step.

### Layer 5 — Drop the Malasakit agency seed (D3)
`src/data/agencies.seed.js` — **remove only the `malasakit` record** (the RA-11463
gateway-as-agency entry, already seeded disabled). **Keep** DOH-MAIP, PCSO, DSWD AICS,
AMBaG. Remove its mentions from the i18n funder lists (done in Layer 2). Re-seed/rules
tests must still pass.

### Layer 6 — Infrastructure & meta
- `package.json` `"name": "mapa-crmc"` → `"mapa-web"` (cosmetic; not published to npm).
- `public/philsys-public-keys.json` README text mentions CRMC (one line) → neutral
  "the deploying organization".
- `CLAUDE.md` — currently frames CRMC as "the reference deployment"; rewrite to
  neutral-MAPA framing once code is clean. Update `SETUP.md` if it names CRMC.
- Firebase project `mapa-crmc` **stays** (D4) — internal id, never user-visible.

---

## 3. Owner decisions (locked 2026-10-21)

| # | Decision | Outcome |
|---|---|---|
| D1 | Deployment address (Sinsuat/Cotabato/Maguindanao) | **Leave as-is** — geography stays; no `ORG.address` token, no Layer-2 address work. |
| D2 | PH barangay/province/city dropdown data | **Keep** — PH location reference data, not CRMC brand. |
| D3 | Seeded agency catalog | **Keep DSWD/PCSO/DOH/AMBaG; drop only the Malasakit Center seed.** |
| D4 | Firebase project `mapa-crmc` | **Keep the project id** — internal, not user-visible; no migration. |
| D5 | Manuscript + historical `docs/` (111 files) | **Out of scope** — documents the real CRMC capstone; clean only `CLAUDE.md` + active plan docs. |

---

## 4. Phased execution (each phase = one PR, verified, independently shippable)

Ordered **safest-first**. Verification gate for every phase: `npm run build` +
`npm run lint:i18n` (no new warnings on patient files) + `npm run test:all` + Vercel
preview eyeball. Bilingual (FIL/EN) preserved on patient surfaces; staff stays English.

- **Phase 0 — This plan + decisions.** *(Done — decisions locked §3.)*
- **Phase 1 — User-facing strings (Layer 2).** i18n Malasakit→`{{gateway}}` /
  remove-from-funder-lists; `api/send-email.js` From→`ORG`; admin placeholders + example
  text. **Highest user-visible value.** Needs no new config (existing tokens suffice).
  Bilingual review + grep the locale JSON directly (lint doesn't cover JSON values).
- **Phase 2 — Code identifiers (Layer 3).** The four renames, one commit each; build +
  tests green. Pure refactor, no behavior change.
- **Phase 3 — Comments sweep (Layer 1).** Mechanical "CRMC"→"the gateway" across
  comments, split into a few reviewable PRs by area (utils → components → pages →
  functions → scripts). Zero runtime risk.
- **Phase 4 — `crmcNotes` field migration (Layer 4).** Two PRs: (a) dual-write + dual-read
  + backfill script; (b) after backfill confirmed in prod, drop the old field.
  Rules-test coverage.
- **Phase 5 — Drop Malasakit agency seed (Layer 5, D3).** Remove the one seed record;
  re-seed/rules tests pass.
- **Phase 6 — Infra & meta (Layer 6).** `package.json` name; `public/philsys…` README;
  `names.js`; rewrite `CLAUDE.md` + `SETUP.md` to neutral framing. Firebase project stays.
- **Phase 7 — Final audit.** Re-run the §1 token greps; assert **0** `CRMC`/`crmc` outside
  the agreed out-of-scope docs; live smoke of the full patient + staff flows; set this
  doc's status to *done*.

---

## 5. Verification, rollback, guardrails

- **Per phase:** build, `lint:i18n`, `test:all`, Vercel preview. Patient surfaces stay
  bilingual + mobile-friendly; staff surfaces English-only.
- **Rollback:** each phase is one PR → revert is a single `git revert`. Phase 4's field
  drop ships only *after* backfill is confirmed, so no reader is ever orphaned.
- **Data safety:** Phase 4 is the only phase touching stored data; it never deletes the
  old field until the new one is fully populated and read-preferred in prod.
- **No scope creep:** money math, request/slice lifecycle, rules semantics, and the
  assessment workflow are **unchanged** throughout — a naming/branding cleanup only.
- **Definition of done:** the §1 token greps are clean (outside the agreed out-of-scope
  docs); Phase 7 proves it.

---

## 6. Open risks

- **i18n drift** — `lint:i18n` covers JSX, not JSON *values*; Phase 1 must grep the locale
  files directly to catch every hardcoded string.
- **Malasakit dual meaning** — don't conflate the *gateway reference* (→ `{{gateway}}`)
  with the *dropped agency record*; they are different edits in different files.
- **`crmcNotes` in-flight docs** — any `applications` written between the dual-write PR
  and the backfill must be caught; re-run the backfill just before the drop PR.
- **Comment sweep scale** — ~70 files; split by directory so each PR stays reviewable and
  a bad find/replace can't slip through in bulk.
