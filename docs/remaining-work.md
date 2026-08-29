# Remaining Work & Gap Analysis

*Snapshot: 2026-08-28. Companion to `production-deployment-plan.md` (the
phased go-live checklist). This doc is the broader honest inventory of what
the system still lacks — including product/QA gaps beyond the go-live phases.*

Legend: ✅ done · 🟡 partial / thin · ⬜ not started · **(owner)** needs
CRMC/console access, not code · **(code)** fully doable in the repo.

---

## What's solid now (closed today)

- ✅ **All Cloud Functions deployed** (`asia-southeast1`) — money-truth
  enforcement (`syncRequestFinancials`) authoritative; GL expiry + slot reset
  on a real clock.
- ✅ **Email endpoint authenticated** (Firebase ID token, verified live).
- ✅ **Backups** — native Firestore scheduled backup enabled.
- ✅ **App Check** wired (site-key-gated) — bot/abuse protection.
- ✅ **Storage rules audited** — solid, no change needed.
- ✅ **Sentry error tracking** wired (DSN-gated).
- ✅ **Bundle chunking** (firebase/react split) + **OCR already lazy**.
- ✅ **Accessibility** — form labels associated across the core patient forms.
- ✅ **Security rules** — Firestore + Storage both rigorous, deny-by-default.

---

## Gaps by category

### 1. Security & abuse
- 🟡 **App Check activation** **(owner)** — code is wired; register a
  reCAPTCHA v3 provider, set `VITE_APPCHECK_SITE_KEY`, start monitoring, then
  enforce per service (Firestore/Storage/Auth/Functions).
- ✅ **Anonymous-token rejection on the email endpoint** — done (#60): the
  relay now refuses `firebase.sign_in_provider === 'anonymous'`.

### 2. Reliability & operations
- 🟡 **Error tracking activation** **(owner)** — Sentry wired; create a Sentry
  project and set `VITE_SENTRY_DSN` to turn it on.
- 🟡 **Uptime monitoring / alerting** **(owner + code)** — ✅ the
  `notificationErrors` collection is now surfaced as a delivery-health alert
  on the admin dashboard (#61). ⬜ Still add an external uptime pinger for the
  site + email route.
- 🟡 **Backups are thin** **(owner)** — weekly / 7-day retention keeps only
  ~1 restore point. Move to **daily**, and **test a restore** ("an untested
  backup isn't a backup").
- ⬜ **Functions error alerting** **(owner)** — they log to Cloud Logging, but
  nothing surfaces a failure. Optional `@sentry/node` in `functions/`.
- ⬜ **`syncRequestFinancials` drift check** **(code/owner)** — the deployed
  version may lag the repo; verify and redeploy if the funding maths changed.

### 3. Governance & compliance (the real hospital go-live gates)
- ⬜ **Project ownership + named maintenance owner** **(owner)** — still on a
  personal Google account; single point of failure after the thesis.
- ⬜ **RA 10173 / DPO sign-off + enforced retention policy** **(owner)** — how
  long selfies/IDs live, plus a scheduled purge. Non-negotiable for real PII.
- ⬜ **Budget alert on Blaze** **(owner)**.

### 4. Reachability & product
- 🟡 **Notification deliverability** **(owner)** — email rides one Gmail App
  Password (500/day, no SPF/DKIM → spam). Move to a transactional sender on a
  CRMC domain before scaling.
- 🟡 **Interview logistics are manual** **(by design, acceptable)** — Google
  Meet links pasted by hand; reminders email/in-app only.
- ⬜ **Patient self-service data access** **(code)** — admins can export; a
  patient can't download their own data (a DPA "right to access" nicety).

### 5. Quality assurance
- 🟡 **End-to-end tests** **(code)** — ✅ a Playwright smoke suite now runs in
  CI over the public pages (landing/login/register/install), catching
  white-screen/route regressions (#62). ⬜ Authenticated flows
  (patient → CRMC → agency) still need a seeded test account as CI secrets
  (owner-side).
- 🟡 **Accessibility is partial** **(code)** — form labels done (#52);
  **contrast fixed across the patient journey** (gray-400 → gray-500,
  WCAG 1.4.3): patient pages + patient components (#64) and the shared shell
  + auth entry pages (#65). ⬜ Still: a **live screen-reader pass** on a
  low-end phone, and optionally the staff-only admin/agency pages.
- 🟡 **Performance** **(code)** — chunking done, but Firebase is still ~659 KB
  and first paint on slow 3G is heavy; no performance budget or monitoring.

---

## Deliberately OUT OF SCOPE (design decisions, not gaps)

Documented in `CLAUDE.md`, mostly cost/scope-driven for the thesis pilot:
**SMS notifications**, **real money movement / payments**, **PhilSys /
biometric verification**, **embedded video calling** (Google Meet links
instead), **donor portal**, **fraud-detection engine**, **multi-hospital
support**, **real-time IHOMIS integration**.

> Note on reachability: with SMS out of scope, a patient with no reliable
> email and an offline phone is the weakest link in actually informing
> indigent patients. Future push notifications (free via FCM, once the mobile
> app ships) are the intended mitigation.

---

## Prioritized next steps

1. **Activate App Check + Sentry** *(owner — console + env vars)*.
2. **Uptime monitoring** + surface delivery failures *(owner + code)*.
3. **Ownership transfer + DPO sign-off + retention policy + budget alert**
   *(owner — the actual hospital go-live gates)*.
4. **Backups → daily + a tested restore** *(owner)*.
5. **E2E smoke test in CI** *(code)*.
6. **Contrast + screen-reader accessibility pass** *(code)*.

The core (money enforcement, security rules, auth, observability hooks) is in
place and verified. What remains is mostly **operational hardening** and
**institutional governance** — the distance from "works and is defensible" to
"a hospital can safely run this unattended for years."
