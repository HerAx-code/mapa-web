# MAPA — Defense cheat sheet

Created 2026-07-24. **Refreshed 2026-08-25.** Quick-glance, panel-facing
answers. Every claim cross-references a doc / test / file you can open live.

---

## One-sentence description

MAPA is a **CRMC-gateway co-funding platform**: a patient files **one**
request, CRMC verifies documents (on-device OCR + social-worker selfie
compare) and runs **one** assessment interview, then endorses the vetted
case to funding agencies as "slices" toward zero balance — each piece of
work happens **once**.

## Architecture in five lines

- React 18 + Vite + Tailwind PWA; Firebase (Firestore, Auth); Vercel
  hosting + one serverless route (`/api/send-email`).
- **Firestore Security Rules are the primary authorization gate** — ~865
  lines, verified by 138 rules tests.
- **Blaze plan.** Two Cloud Functions deployed: `verifyAccessCode`
  (access-code throttle) and `syncRequestFinancials` (server-derived
  request funding tally). Client-side fallbacks for slot reset / GL expiry
  remain as defense-in-depth.
- Five roles: patient, agency, agency_admin, staff_admin, super_admin.
- **286 automated tests** (utils 35 / components 64 / functions 49 /
  rules 138) + GitHub Actions CI + pre-commit hook.

## "How do the agencies coordinate?" — the 7-layer answer

CRMC is the **network broker**; agencies stay independent decision-makers.
1. **CRMC gateway broker** — one intake, one verification, one interview.
2. **Case Timeline (R33)** — cross-agency event feed per case. *Salesforce
   Public Sector / NHS shared-care record.*
3. **Watcher subscriptions (R34)** — real-time notify on sibling approve/
   reject. *ServiceNow watcher model.*
4. **Live over-commitment guard (R35)** — running co-funding total in the
   approve modal. *Optimistic-concurrency UX.*
5. **Structured referrals (R36)** — "Suggest another agency" → CRMC.
   *Bonterra warm-handoff.*
6. **Patient-visible audit trail (R37)** — `/patient/access-log`. *Estonia
   X-Road, RA 10173 §16(c).*
7. **Branded agency announcements (R38)** — programs on the Find Programs
   catalog.

Framing: Bardach (1998) "frame reflection", Klijn & Koppenjan (2016)
"network awareness" — structural coordination by the platform, relational
work by the social workers.

## Agency model (RA 11463) — likely to be probed

- A Malasakit Center is **legally a coordination hub, not a funder**
  (RA 11463 + JAO 2020-0001): a co-located one-stop shop where DOH, DSWD,
  PCSO, PhilHealth receive/process requests via the **Order of Charging**
  (PhilHealth → PCSO → DSWD → DOH → hospital/LGU).
- MAPA models the hub as the **CRMC gateway role itself**, and the funders
  as agencies: **DOH-MAIP, PhilHealth, PCSO MAP, DSWD AICS** + **AMBaG**
  (BARMM peer). Malasakit is retained but **disabled**.
- **Defensible line:** "MAPA's data model matches the statute — the
  Malasakit Center is the intake gateway, not a funding source."
- **Stated caveat:** PhilHealth's NHIF is drawn *first and reduces the
  bill*; its slice is a coverage figure, not a GL. Full trail:
  `docs/malasakit-center-research-2026-07-23.md`.

## Security — the incident-response narrative

- **2026-06-01:** 18 planted `auditLog` entries with fake "System /
  Migration Daemon" actors carrying shell-command payloads aimed at humans
  and AI agents reading the dashboard. Root cause: `auditLog.create` was
  `allow create: if isAuth()`.
- **Response:** three layered rule passes hardened auditLog, notifications,
  conversations, documents, certificates, messages; cleanup script purged
  the entries.
- **2026-07-24 sweep:** investigating leftover junk (~12k orphan
  `documentContents`, ~6.5k forged `reports` under the same attacker uid)
  found the same permissive-create pattern in more rules; a systematic
  sweep closed them all, each with a regression test replaying the attack,
  and added server-derived funding integrity via a Cloud Function.
- **One-liner:** "The system survived a prompt-injection attempt, and the
  post-incident sweep hardened every rule sharing the root cause —
  verified by 138 rules tests." (`docs/threat-model.md` T1–T10.)

## Compliance (RA 10173)

- **§16(f) portability** — "Download my data" → one `MAPA-RA10173-v1` JSON.
- **§16(e) erasure** — admin soft-delete gates login; super_admin cascade
  removes all Firestore data **and** now the Firebase Auth account, via the
  `deleteAuthUser` Cloud Function (deployed 2026-08-25). The old "Auth
  account can't be removed from the browser" residual is **closed** (the
  function falls back to a manual-removal prompt only if it errors).
- **§16(c) access** — the patient access-log (coordination layer 6).

## The public UI (redesigned 2026-08-25)

- **Two-column editorial landing hero** + illustrative application-journey
  card; honest proof points (no fabricated stats).
- **Emoji-free** — all colorful emoji replaced with Material Design line
  icons across patient + staff surfaces (civic/professional tone).
- **Animated "aurora" background** (CSS-only, reduced-motion-safe) on the
  landing hero and Login/Register; elevated auth cards.
- PWA install is the primary phone-install channel (safest — no sideload
  warning). `docs/mobile-app-apk.md` covers the real APK/TWA path.

## Live demo path (10 minutes)

`scripts/seed-demo-scenario.js` seeds one in-flight request. Walk: verify
docs → intake sheet + schedule interview → endorse to agencies (budget/
slots gate) → agency approves (over-commit guard) → GL issues → claim.
Pre-defense: `node scripts/check-demo-accounts.js` (5s health check).

## Honest limitations (see threat-model §A1–A8, thesis-doc §11.5/§12)

- No 2FA / session timeout (Firebase defaults).
- `documentContents` still base64-in-Firestore (~700 KiB cap); Storage
  migration written, not yet run — a Blaze follow-up.
- `applications.update` for own agency is still any-field (UI-gated) — the
  one remaining broad-write rule, next to tighten.
- Single hospital; multi-tenancy is v2. OCR advisory; social worker makes
  the final ID call **by design**.

## Numbers to have ready

| Thing | Value |
|---|---|
| Roles | 5 |
| Funding agencies | 5 (+ 1 disabled hub) |
| Firestore collections | ~16 |
| `firestore.rules` | ~865 lines |
| Automated tests | 286 (utils 35 / components 64 / functions 49 / rules 138) |
| Demo accounts | 15 |
| Cloud Functions deployed | 2 (`verifyAccessCode`, `syncRequestFinancials`) |
| Largest file (known debt) | `ApplicationDetail.jsx`, ~1,715 lines |
