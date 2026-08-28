# Production Deployment Plan

> **The code is ready. The deployment isn't yet.**
>
> This is the plan to cross the specific gates between a pilot and a system
> CRMC can actually run for real patients.
>
> Shareable version (defense-ready): the "Clearance to Deploy" artifact.

> **⚠️ Live-state correction (2026-08-28).** This plan was first written from the
> repo docs, which were stale. Verified against the live project since:
> - The Firebase project is **already on the Blaze plan** (it uses Cloud
>   Storage, which requires Blaze) — so Phase 0's "upgrade to Blaze" is **done**.
> - **All five Cloud Functions are deployed** (`asia-southeast1`):
>   `syncRequestFinancials`, `deleteAuthUser`, `verifyAccessCode` were already
>   live; `glExpirySweep` + `resetAgencySlots` deployed 2026-08-28. So Phase 1's
>   "deploy the Cloud Functions" is **done**, and the money-truth enforcement is
>   authoritative in production.
> - The **email endpoint is authenticated** in production (`FIREBASE_PROJECT_ID`
>   set in Vercel, verified 401 on invalid token).
>
> Items below are struck through as they complete; the remaining real gaps are
> **backups**, **observability**, **RA 10173 sign-off**, **project ownership /
> handover**, and the **accessibility pass**.

**At a glance**

| | |
|---|---|
| Launch-blocking gates | **6** |
| Phases (ownership → go-live) | **6** |
| Realistic infra cost at pilot scale | **$5–20 / mo** |
| Focused build + institutional lead time | **~3–5 weeks** |

The work is roughly **70% operations and institutional sign-off, 30% code**.
Almost every code fix already exists in the repo — it needs *deploying*, not
writing. Nothing here is a rewrite.

---

## The honest read

Your instinct was half right. It wouldn't ship as-is — but not because the code
is sloppy. A deliberate cost decision (stay on Spark's free tier) left the
production-grade parts **designed but not turned on**.

- **As a thesis pilot for one Malasakit Center** — defensible today. The
  Firestore security rules alone are above typical student grade.
- **As a live system moving real assistance for real patients** — not yet. The
  gap is ownership, deployment, and compliance, not a rewrite.

---

## Readiness snapshot

A fair plan credits what's done. You are further along than "it won't pass"
suggests.

### Already production-grade ✓

- **Firestore security rules** that enumerate real attack scenarios
  (self-promotion to `super_admin`, forged funding slices, self-verified IDs,
  `storagePath` hijack) and close each one with reasoned field-locking.
- **Secrets gitignored** — `service-account.json` and `.env` never committed.
- **ErrorBoundary**, route-level code splitting, and **26 test files** (utils +
  components + emulator rules) running in CI on every PR.
- **Consent + Privacy Notice** flow already in registration.
- **Cloud Functions written & emulator-validated**, plus `runbook.md` and
  `threat-model.md`.

### Not switched on yet ▲

- ~~Money-truth enforcement is dormant~~ — **corrected: `syncRequestFinancials`
  is deployed and authoritative** (see the live-state note above).
- ~~Email endpoint is unauthenticated~~ — **corrected: authenticated in
  production** (Firebase ID token required, verified).
- **No backups** of the system of record, and **no error/uptime monitoring**.
- **No Data Privacy Act sign-off** for handling real patient PII (RA 10173).
- **Project lives on a personal account** — CRMC doesn't own it, and there's no
  handover owner.

---

## The plan — 6 phases

Phases are ordered by dependency: ownership before spending, correctness before
exposure, compliance before real patient data.

Severity legend: **[BLOCKER]** must not launch without · **[BEFORE GO-LIVE]**
required before full rollout · **[RECOMMENDED]** strongly advised.

### Phase 0 — Ownership & decisions
*Institutional gates — start these first; they have lead time.*

- **[BLOCKER] CRMC owns the Firebase project & billing account.**
  The system of record currently lives under a student's personal Google
  account. A hospital system cannot depend on a person who graduates. Transfer
  the Firebase project to a CRMC-owned Google Workspace account, with IT as
  owner and you as editor. *Single most important step for the system to
  outlive the thesis.*
  — Owner: CRMC IT + you · Effort: admin/meetings · Cost: ₱0

- **[BLOCKER] Upgrade to the Blaze (pay-as-you-go) plan + budget alert.**
  Every dormant server piece in Phase 1 **requires Blaze to deploy** — it's the
  gate that unlocks correctness. Blaze still includes the free quotas; at
  single-center scale you stay near-free. Set a budget alert at ~$20/mo.
  — Owner: CRMC IT (billing) · Effort: XS · Cost: ~$5–20/mo

- **[BEFORE GO-LIVE] Custom domain + managed SSL, and a named maintenance owner.**
  A CRMC-branded subdomain (e.g. `malasakit.crmc.*`) builds trust and lets CRMC
  control the address. Just as important: name who maintains this after the
  thesis so the system isn't a single point of failure.
  — Owner: CRMC IT + you · Effort: S · Cost: domain only

### Phase 1 — Correctness & security
*Must not launch without any of these.*

- **[BLOCKER] Deploy the Cloud Functions.**
  Makes the money authoritative. `syncRequestFinancials` recomputes committed
  funding from the real slices server-side; `glExpirySweep` retires expired
  Guarantee Letters hourly; `resetAgencySlots` resets daily. Today these run
  only when an agency user happens to open the dashboard — an opportunistic
  browser check is not an invariant for a financial system. The code is written
  and emulator-validated.
  — Where: `functions/` · `firebase deploy --only functions` · Effort: S

- **[BLOCKER] Authenticate the email endpoint.**
  `api/send-email.js` accepts unauthenticated POSTs with
  `Access-Control-Allow-Origin: *` — anyone can send mail *as CRMC* up to
  Gmail's daily cap. The file's own comment says to fix this: verify the
  Firebase ID token the client already holds, and lock CORS to the app origin.
  ~10 lines.
  — Where: `api/send-email.js` · Effort: S · Cost: ₱0

- **[BLOCKER] Automated Firestore backups.**
  There is currently no backup of the system of record. Schedule a daily managed
  export to a Cloud Storage bucket (Blaze enables this), and **test that a
  restore actually works** before go-live.
  — Where: Firestore scheduled export · Effort: S · Cost: ~$1/mo storage

- **[BEFORE GO-LIVE] Enable Firebase App Check + review Storage rules.**
  Self-registration and the public routes have no bot/abuse protection (the
  reCAPTCHA hook is stubbed but off). Turn on App Check to bind traffic to the
  real app. Separately, audit `storage.rules` for the ID photos, selfies, and GL
  scans — the most sensitive files, needing the same rigor as the Firestore
  rules.
  — Where: `src/firebase.js` · `storage.rules` · Effort: M

### Phase 2 — Reliability & observability
*So you find out before your patients do.*

- **[BEFORE GO-LIVE] Error tracking on web + functions.**
  Today a silently-denied write or a 500 in the email route is invisible until a
  patient complains. Add Sentry (free tier) to the React app and the functions.
  — Where: `src/main.jsx` · `functions/` · Effort: S · Cost: free tier

- **[RECOMMENDED] Uptime monitoring + surface delivery failures.**
  A free uptime pinger on the app and email route catches outages. You already
  write failed sends to a `notificationErrors` collection — surface it on the
  admin console so staff can see delivery health.
  — Where: admin dashboard · Effort: S · Cost: free tier

### Phase 3 — Data privacy & compliance
*Non-negotiable before touching real patient PII — RA 10173.*

- **[BLOCKER] Data Protection Officer sign-off.**
  You are processing medical + financial data of indigent patients. Under the
  Data Privacy Act of 2012 (RA 10173) — the same law already cited on the export
  page — CRMC's DPO must review and approve the processing before go-live.
  Engage the DPO early; real lead time.
  — Owner: CRMC DPO + you · Effort: institutional

- **[BLOCKER] Data retention & deletion policy.**
  Define how long patient documents, selfies, and records live, and how a
  patient's data is deleted on request. `deleteAuthUser` is a start — it needs a
  written policy behind it, DPO-reviewed, with the retention window enforced (a
  scheduled purge is a natural function).
  — Owner: DPO + you · Effort: M

- **[BEFORE GO-LIVE] DPO-reviewed consent copy + security assessment.**
  The Privacy Notice and consent checkbox exist — have the DPO confirm the
  wording matches what the system actually collects and does. Before real PII
  flows, get a basic security assessment (even a structured self-review against
  `threat-model.md`) signed off.
  — Where: Register · Privacy Notice · `threat-model.md` · Effort: M

### Phase 4 — Performance & accessibility
*For the exact users you designed this for.*

- **[BEFORE GO-LIVE] Trim the 1.3 MB bundle — lazy-load OCR.**
  The brief says indigent users on cheap phones and slow connections — yet the
  main bundle is 1.3 MB (342 KB gzip), dominated by `tesseract.js`. Load OCR only
  at the ID-capture step (most users hit it once) and split the Firebase imports.
  Biggest real-world speed win for the actual audience.
  — Where: ID capture flow · firebase imports · Effort: M

- **[BEFORE GO-LIVE] Accessibility pass on the patient flow.**
  A public government-adjacent service should be usable by everyone. Focused pass
  toward WCAG 2.1 AA on the patient journey — focus states, form labels,
  contrast, keyboard nav — tested on a real low-end Android over a throttled
  network.
  — Where: `src/pages/patient/**` · Effort: M

### Phase 5 — Operations & staged go-live
*Roll out to real patients gradually, not all at once.*

- **[RECOMMENDED] Restore drill + operations runbook.**
  Extend `runbook.md` with an incident path: who is called, how to roll back,
  how to restore from backup. Then actually run a restore drill — an untested
  backup is not a backup.
  — Where: `docs/runbook.md` · Effort: S

- **[RECOMMENDED] Staged rollout + staff training.**
  Go live in stages: CRMC staff internally → a small real patient cohort at the
  Malasakit Center → full rollout. Train the social workers and partner agencies
  first — the best system fails if the front desk doesn't trust it.
  — Owner: you + Malasakit Center · Effort: M

---

## The money question — what running this actually costs

Cost was the reason to stay on the free plan. Honest picture at single-center
pilot scale — the real cost is ownership and time, not infrastructure.

| Line item | Notes | Est. / mo |
|---|---|---:|
| Firestore reads/writes | One center's volume sits inside free quota | ~$0 |
| Cloud Functions | Financial sync + scheduled sweeps, low invocation count | ~$0–2 |
| Storage (docs, selfies, GL scans) | Grows slowly; backups add a little | ~$1–3 |
| Email (SMTP) | App Password within Gmail limits — see note | ~$0 |
| Web hosting (Vercel) | Free tier covers a pilot | ~$0 |
| Monitoring (Sentry / uptime) | Free tiers | ~$0 |
| **Total, with headroom** | **Set the budget alert here** | **$5–20** |

> **Email caveat:** a single Gmail App Password caps at ~500 messages/day and
> lands in spam without SPF/DKIM on a real domain. Fine for a pilot; before
> scaling, move to a proper transactional email sender on the CRMC domain.

---

## Definition of done — the go-live checklist

When every box is true, MAPA is a system CRMC can responsibly run for real
patients.

- [ ] Firebase project owned by CRMC, with a budget alert set *(Phase 0 — **Blaze already active**; ownership transfer + budget alert still pending)*
- [x] Cloud Functions deployed — funding tallies and GL expiry are server-authoritative *(Phase 1 — done 2026-08-28)*
- [x] Email endpoint authenticated; CORS locked to the app origin *(Phase 1 — done 2026-08-28)*
- [ ] Daily backups running, and a restore has been tested successfully *(Phase 1 + 5)*
- [ ] Error tracking + uptime monitoring live *(Phase 2)*
- [ ] DPO sign-off, retention policy, and reviewed consent in place *(Phase 3)*
- [ ] Bundle trimmed and patient flow tested on a low-end phone *(Phase 4)*
- [ ] Staff trained; rolling out in stages, not all at once *(Phase 5)*

---

*This plan builds on what MAPA already has — the functions, the rules, the
runbook, the consent flow. Most of the work is turning things on and getting
institutional sign-off, in the right order.*
